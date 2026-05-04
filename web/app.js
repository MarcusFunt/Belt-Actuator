(function (global) {
  "use strict";

  const BELT_PITCH_PRESETS = {
    MXL: 2.032,
    GT2: 2.0,
    GT3: 3.0,
    "HTD-3M": 3.0,
    "HTD-5M": 5.0
  };
  const CUSTOM_BELT_TYPE = "Custom";
  const BELT_BACK_TO_PITCH = 0.0;
  const NUMBER_INPUT_DEBOUNCE_MS = 150;
  const PLACEHOLDER_WARNING = "PLACEHOLDER - verify for your build.";
  const PLOT_LABEL_FONT_SIZE = 4;
  const DIMENSION_LABEL_FONT_SIZE = 3.45;
  const ERROR_LABEL_FONT_SIZE = 4.6;
  const CONTACT_ORDER = ["pulleyI", "idler2", "pulleyO", "idler1"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  const DEFAULTS = {
    belt_pitch_mm: 2.0,
    belt_length_mm: 264.0,
    pulleyI_teeth: 20,
    pulleyO_teeth: 60,
    idler_OD_mm: 22.0,
    belt_back_to_pitch_mm: BELT_BACK_TO_PITCH,
    center_IO_mm: 90.0,
    idler_x_offset_mm: 20.0,
    tension_slot_travel_mm: 6.0,
    tension_offset_mm: 0.0,
    belt_visual_thickness_mm: 1.5,
    minimum_clearance_mm: 1.5
  };

  const CONTROL_GROUPS = {
    driveControls: [
      ["belt_pitch_mm", "Belt pitch", "mm", 1.0, 8.0, 0.1],
      ["belt_length_mm", "Belt length", "mm", 80.0, 1000.0, 1.0],
      ["pulleyI_teeth", "Input pulley teeth", "teeth", 10, 80, 1],
      ["pulleyO_teeth", "Output pulley teeth", "teeth", 20, 240, 1],
      ["idler_OD_mm", "Idler OD", "mm", 6.0, 60.0, 0.5],
      ["belt_back_to_pitch_mm", "Belt back-to-pitch", "mm", 0.0, 5.0, 0.05],
      ["belt_visual_thickness_mm", "Belt visual thickness", "mm", 0.2, 8.0, 0.1]
    ],
    layoutControls: [
      ["center_IO_mm", "Input-output center", "mm", 20.0, 220.0, 0.5],
      ["idler_x_offset_mm", "Idler half-spacing", "mm", 1.0, 250.0, 0.5],
      ["tension_slot_travel_mm", "Tension slot travel", "mm", 0.0, 40.0, 0.5],
      ["tension_offset_mm", "Tension offset", "mm", -20.0, 20.0, 0.1],
      ["minimum_clearance_mm", "Minimum clearance", "mm", 0.0, 20.0, 0.1]
    ]
  };

  const SOLVER_INPUTS = new Set([
    "belt_pitch_mm",
    "belt_length_mm",
    "pulleyI_teeth",
    "pulleyO_teeth",
    "idler_OD_mm",
    "belt_back_to_pitch_mm",
    "center_IO_mm",
    "idler_x_offset_mm"
  ]);

  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
  }

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }

  function mul(a, k) {
    return [a[0] * k, a[1] * k];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }

  function norm(a) {
    return Math.hypot(a[0], a[1]);
  }

  function unit(a) {
    const length = norm(a);
    if (length <= 1e-12) {
      return [0.0, 0.0];
    }
    return [a[0] / length, a[1] / length];
  }

  function angleOf(point, center) {
    return Math.atan2(point[1] - center[1], point[0] - center[0]);
  }

  function unwrapToDirection(a0, a1, direction) {
    if (direction >= 0) {
      while (a1 < a0) {
        a1 += 2 * Math.PI;
      }
      return a1 - a0;
    }
    while (a1 > a0) {
      a1 -= 2 * Math.PI;
    }
    return a1 - a0;
  }

  function sampleArc(center, radius, a0, a1, direction, count) {
    const n = count || 48;
    const travel = unwrapToDirection(a0, a1, direction);
    const points = [];
    for (let i = 0; i < n; i += 1) {
      const t = a0 + travel * i / Math.max(1, n - 1);
      points.push([
        center[0] + radius * Math.cos(t),
        center[1] + radius * Math.sin(t)
      ]);
    }
    return points;
  }

  function tangentVector(center, point, direction) {
    const radial = unit(sub(point, center));
    if (direction >= 0) {
      return [-radial[1], radial[0]];
    }
    return [radial[1], -radial[0]];
  }

  function tangentOptions(c1, r1, c2, r2, internal) {
    const v = sub(c2, c1);
    const d = norm(v);
    if (d <= 1e-9) {
      return [];
    }

    const side = internal ? -1.0 : 1.0;
    const c = (r1 - side * r2) / d;
    if (Math.abs(c) > 1.0) {
      return [];
    }

    const vx = v[0] / d;
    const vy = v[1] / d;
    const h = Math.sqrt(Math.max(0.0, 1.0 - c * c));
    const out = [];
    [-1.0, 1.0].forEach((s) => {
      const nx = vx * c - s * h * vy;
      const ny = vy * c + s * h * vx;
      const n = [nx, ny];
      out.push([add(c1, mul(n, r1)), add(c2, mul(n, side * r2))]);
    });
    return out;
  }

  function segmentIntersection(a, b, c, d) {
    function orient(p, q, r) {
      return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    }

    function between(p, q, r) {
      return (
        Math.min(p[0], r[0]) - 1e-9 <= q[0] &&
        q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
        Math.min(p[1], r[1]) - 1e-9 <= q[1] &&
        q[1] <= Math.max(p[1], r[1]) + 1e-9
      );
    }

    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);

    if (o1 * o2 < 0 && o3 * o4 < 0) {
      return true;
    }
    if (Math.abs(o1) < 1e-9 && between(a, c, b)) {
      return true;
    }
    if (Math.abs(o2) < 1e-9 && between(a, d, b)) {
      return true;
    }
    if (Math.abs(o3) < 1e-9 && between(c, a, d)) {
      return true;
    }
    if (Math.abs(o4) < 1e-9 && between(c, b, d)) {
      return true;
    }
    return false;
  }

  function pointSegmentDistance(point, a, b) {
    const ab = sub(b, a);
    const denom = dot(ab, ab);
    if (denom <= 1e-18) {
      return norm(sub(point, a));
    }

    const t = Math.max(0.0, Math.min(1.0, dot(sub(point, a), ab) / denom));
    const q = add(a, mul(ab, t));
    return norm(sub(point, q));
  }

  function targetLength(params) {
    return Object.prototype.hasOwnProperty.call(params, "beltLength")
      ? params.beltLength
      : params.beltPitch * params.beltTeeth;
  }

  function circles(params) {
    const pitch = params.beltPitch;
    const rI = params.pulleyITeeth * pitch / Math.PI / 2;
    const rO = params.pulleyOTeeth * pitch / Math.PI / 2;
    const rId = params.idlerOD / 2 + (params.beltBackToPitch ?? BELT_BACK_TO_PITCH);
    const x = params.idlerX;
    const y = params.idlerY;
    const motorY = params.motorY;
    return [
      { name: "pulleyI", center: [0.0, motorY], radius: rI, kind: "pulley" },
      { name: "idler1", center: [-x, y], radius: rId, kind: "idler" },
      { name: "pulleyO", center: [0.0, 0.0], radius: rO, kind: "pulley" },
      { name: "idler2", center: [x, y], radius: rId, kind: "idler" }
    ];
  }

  function invalidSolution(reason) {
    return {
      length: Number.POSITIVE_INFINITY,
      lineLength: Number.POSITIVE_INFINITY,
      arcLength: Number.POSITIVE_INFINITY,
      tangentEdges: [],
      arcPoints: {},
      wrapDeg: {},
      valid: false,
      reason
    };
  }

  function enumerateOptions(optionLists, callback) {
    const current = [];

    function walk(index) {
      if (index === optionLists.length) {
        callback(current.slice());
        return;
      }
      optionLists[index].forEach((option) => {
        current[index] = option;
        walk(index + 1);
      });
    }

    walk(0);
  }

  function beltSolution(params) {
    const byName = {};
    circles(params).forEach((circle) => {
      byName[circle.name] = circle;
    });
    const ordered = CONTACT_ORDER.map((name) => byName[name]);
    const edgeOptions = [];
    const n = ordered.length;

    for (let i = 0; i < n; i += 1) {
      const a = ordered[i];
      const b = ordered[(i + 1) % n];
      const opts = tangentOptions(a.center, a.radius, b.center, b.radius, false).concat(
        tangentOptions(a.center, a.radius, b.center, b.radius, true)
      );
      if (!opts.length) {
        return invalidSolution("No tangent solution: circles overlap or are too close.");
      }
      edgeOptions.push(opts);
    }

    let best = null;

    enumerateOptions(edgeOptions, (edges) => {
      const dirs = {};
      let continuous = true;

      for (let k = 0; k < n; k += 1) {
        const circle = ordered[k];
        const incoming = edges[(k - 1 + n) % n];
        const outgoing = edges[k];
        const incomingVec = unit(sub(incoming[1], incoming[0]));
        const outgoingVec = unit(sub(outgoing[1], outgoing[0]));
        const matchingDirs = [1, -1].filter((direction) => (
          dot(incomingVec, tangentVector(circle.center, incoming[1], direction)) > 0.999 &&
          dot(outgoingVec, tangentVector(circle.center, outgoing[0], direction)) > 0.999
        ));
        if (!matchingDirs.length) {
          continuous = false;
          break;
        }
        dirs[circle.name] = matchingDirs[0];
      }

      if (!continuous) {
        return;
      }
      if (dirs.pulleyI !== dirs.pulleyO) {
        return;
      }
      if (dirs.idler1 !== -dirs.pulleyI || dirs.idler2 !== -dirs.pulleyI) {
        return;
      }

      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          if (segmentIntersection(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) {
            return;
          }
        }
      }

      for (let i = 0; i < n; i += 1) {
        const endpointNames = new Set([ordered[i].name, ordered[(i + 1) % n].name]);
        for (let j = 0; j < n; j += 1) {
          const other = ordered[j];
          if (
            !endpointNames.has(other.name) &&
            pointSegmentDistance(other.center, edges[i][0], edges[i][1]) < other.radius - 1e-9
          ) {
            return;
          }
        }
      }

      const lineLength = edges.reduce((total, edge) => total + norm(sub(edge[1], edge[0])), 0.0);
      let arcLength = 0.0;
      const arcPoints = {};
      const wrapDeg = {};

      for (let k = 0; k < n; k += 1) {
        const circle = ordered[k];
        const incomingPoint = edges[(k - 1 + n) % n][1];
        const outgoingPoint = edges[k][0];
        const a0 = angleOf(incomingPoint, circle.center);
        const a1 = angleOf(outgoingPoint, circle.center);
        const travel = unwrapToDirection(a0, a1, dirs[circle.name]);
        arcLength += Math.abs(travel) * circle.radius;
        wrapDeg[circle.name] = Math.abs(travel * 180 / Math.PI);
        arcPoints[circle.name] = sampleArc(circle.center, circle.radius, a0, a1, dirs[circle.name]);
      }

      const solution = {
        length: lineLength + arcLength,
        lineLength,
        arcLength,
        tangentEdges: edges.map((edge) => [edge[0].slice(), edge[1].slice()]),
        arcPoints,
        wrapDeg,
        valid: true,
        reason: "OK"
      };
      const score = (
        wrapDeg.pulleyO +
        wrapDeg.pulleyI +
        0.25 * (wrapDeg.idler1 + wrapDeg.idler2)
      );
      if (best === null || score > best.score) {
        best = { score, solution };
      }
    });

    if (best === null) {
      return invalidSolution("No valid backside-idler belt path found without span crossings or unintended pulley/idler contact.");
    }
    return best.solution;
  }

  function solveIdlerY(params, yMin, yMax) {
    const target = targetLength(params);
    const centerY = params.motorY;
    const idlerX = params.idlerX;
    const maxRadius = Math.max(
      params.pulleyITeeth * params.beltPitch / Math.PI / 2,
      params.pulleyOTeeth * params.beltPitch / Math.PI / 2,
      params.idlerOD / 2 + (params.beltBackToPitch ?? BELT_BACK_TO_PITCH)
    );
    const span = Math.max(target / 2, Math.abs(centerY), Math.abs(idlerX), maxRadius) + 50.0;
    const loLimit = yMin === undefined || yMin === null ? Math.min(0.0, centerY) - span : yMin;
    const hiLimit = yMax === undefined || yMax === null ? Math.max(0.0, centerY) + span : yMax;

    function residual(y) {
      const p = Object.assign({}, params, { idlerY: y });
      return beltSolution(p).length - target;
    }

    function finiteResidual(y) {
      const f = residual(y);
      return Number.isFinite(f) ? f : null;
    }

    function refine(a, b, fA) {
      let lo = a;
      let hi = b;
      let flo = fA;
      for (let i = 0; i < 80; i += 1) {
        const mid = (lo + hi) / 2;
        const fmid = finiteResidual(mid);
        if (fmid === null) {
          return null;
        }
        if (Math.abs(fmid) < 1e-9) {
          return mid;
        }
        if (flo * fmid <= 0) {
          hi = mid;
        } else {
          lo = mid;
          flo = fmid;
        }
      }
      return (lo + hi) / 2;
    }

    const samples = 300;
    const roots = [];
    let prevY = null;
    let prevF = null;
    let minValid = null;
    let maxValid = null;

    for (let i = 0; i <= samples; i += 1) {
      const y = loLimit + (hiLimit - loLimit) * i / samples;
      const f = finiteResidual(y);
      if (f === null) {
        prevY = null;
        prevF = null;
        continue;
      }

      const length = f + target;
      if (minValid === null || length < minValid.length) {
        minValid = { y, length };
      }
      if (maxValid === null || length > maxValid.length) {
        maxValid = { y, length };
      }

      if (Math.abs(f) < 1e-9) {
        roots.push(y);
      } else if (prevY !== null && prevF !== null && prevF * f <= 0) {
        const root = refine(prevY, y, prevF);
        if (root !== null) {
          roots.push(root);
        }
      }
      prevY = y;
      prevF = f;
    }

    const deduped = [];
    roots.sort((a, b) => a - b).forEach((y) => {
      if (!deduped.length || Math.abs(y - deduped[deduped.length - 1]) > 1e-5) {
        deduped.push(y);
      }
    });

    if (!deduped.length) {
      if (minValid === null || maxValid === null) {
        return { y: null, candidates: [], message: "No valid backside-idler belt path exists for this geometry." };
      }
      if (target < minValid.length) {
        return {
          y: null,
          candidates: [],
          message: `Selected belt is too short. Shortest valid path found is ${minValid.length.toFixed(3)} mm at idlerY ${minValid.y.toFixed(3)} mm.`
        };
      }
      if (target > maxValid.length) {
        return {
          y: null,
          candidates: [],
          message: `Selected belt is too long. Longest valid path found is ${maxValid.length.toFixed(3)} mm at idlerY ${maxValid.y.toFixed(3)} mm.`
        };
      }
      return {
        y: null,
        candidates: [],
        message: "Could not solve idlerY for this belt length without crossing, unintended contact, or wrong-side idler wrap."
      };
    }

    function score(y) {
      const p = Object.assign({}, params, { idlerY: y });
      const sol = beltSolution(p);
      const midpoint = centerY / 2;
      const lower = Math.min(0.0, centerY);
      const upper = Math.max(0.0, centerY);
      const outside = Math.max(lower - y, 0.0, y - upper);
      const wrapScore = (
        (sol.wrapDeg.pulleyI || 0.0) +
        (sol.wrapDeg.pulleyO || 0.0) +
        0.25 * (sol.wrapDeg.idler1 || 0.0) +
        0.25 * (sol.wrapDeg.idler2 || 0.0)
      );
      const compactPenalty = Math.abs(y - midpoint);
      return wrapScore - 0.2 * compactPenalty - 4.0 * outside;
    }

    const chosen = deduped.reduce((bestY, y) => (score(y) > score(bestY) ? y : bestY), deduped[0]);
    if (deduped.length === 1) {
      return { y: chosen, candidates: deduped, message: "OK" };
    }
    return {
      y: chosen,
      candidates: deduped,
      message: `OK; found ${deduped.length} valid idlerY candidates and chose the best-scored one.`
    };
  }

  function solveIdlerX(params, xMin, xMax) {
    const target = targetLength(params);
    const loLimit = Math.max(xMin === undefined ? 1.0 : xMin, 0.1);
    const hiLimit = Math.max(xMax === undefined ? 250.0 : xMax, loLimit + 1.0);
    const samples = 1000;

    function residual(x) {
      const p = Object.assign({}, params, { idlerX: x });
      return beltSolution(p).length - target;
    }

    let bracket = null;
    let prevX = null;
    let prevF = null;
    let minValid = null;
    let maxValid = null;

    for (let i = 0; i <= samples; i += 1) {
      const x = loLimit + (hiLimit - loLimit) * i / samples;
      const p = Object.assign({}, params, { idlerX: x });
      const sol = beltSolution(p);
      if (!Number.isFinite(sol.length)) {
        prevX = null;
        prevF = null;
        continue;
      }

      if (minValid === null || sol.length < minValid.length) {
        minValid = { x, length: sol.length };
      }
      if (maxValid === null || sol.length > maxValid.length) {
        maxValid = { x, length: sol.length };
      }

      const f = sol.length - target;
      if (Math.abs(f) < 1e-9) {
        return { x, message: "OK" };
      }
      if (prevX !== null && prevF !== null && prevF * f <= 0) {
        bracket = [prevX, x];
        break;
      }
      prevX = x;
      prevF = f;
    }

    if (bracket === null) {
      if (minValid === null || maxValid === null) {
        return { x: null, message: "No valid backside-idler belt path exists for this geometry." };
      }
      if (target < minValid.length) {
        return {
          x: null,
          message: `Selected belt is too short. Shortest valid path found is ${minValid.length.toFixed(3)} mm at idlerX ${minValid.x.toFixed(3)} mm.`
        };
      }
      if (target > maxValid.length) {
        return {
          x: null,
          message: `Selected belt is too long. Longest valid path found is ${maxValid.length.toFixed(3)} mm at idlerX ${maxValid.x.toFixed(3)} mm.`
        };
      }
      return {
        x: null,
        message: "Could not solve idlerX for this belt length without crossing, unintended contact, or wrong-side idler wrap. Change belt length, belt type, motorY, idlerY, or pulley/idler sizes."
      };
    }

    let lo = bracket[0];
    let hi = bracket[1];
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      const fMid = residual(mid);
      const fLo = residual(lo);
      if (fLo * fMid <= 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return { x: (lo + hi) / 2, message: "OK" };
  }

  function modelParams(inputParams, idlerY) {
    return {
      beltPitch: inputParams.belt_pitch_mm,
      beltLength: inputParams.belt_length_mm,
      pulleyITeeth: inputParams.pulleyI_teeth,
      pulleyOTeeth: inputParams.pulleyO_teeth,
      idlerOD: inputParams.idler_OD_mm,
      beltBackToPitch: inputParams.belt_back_to_pitch_mm ?? BELT_BACK_TO_PITCH,
      motorY: inputParams.center_IO_mm,
      idlerX: inputParams.idler_x_offset_mm,
      idlerY
    };
  }

  function clearanceWarnings(modelP, minimumClearance) {
    const items = circles(modelP);
    const warnings = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const clearance = norm(sub(a.center, b.center)) - a.radius - b.radius;
        if (clearance < minimumClearance) {
          warnings.push({
            names: [a.name, b.name],
            clearance,
            text: `${a.name}-${b.name}: ${clearance.toFixed(3)} mm`
          });
        }
      }
    }
    return warnings;
  }

  function derived(inputParams, modelP, sol, nominalY) {
    const pitch = inputParams.belt_pitch_mm;
    const beltBackToPitch = inputParams.belt_back_to_pitch_mm ?? BELT_BACK_TO_PITCH;
    const beltTeethExact = pitch ? inputParams.belt_length_mm / pitch : Number.POSITIVE_INFINITY;
    const actualY = modelP.idlerY;
    return {
      beltPitchLength: inputParams.belt_length_mm,
      beltTeethExact,
      beltTeethRounded: Number.isFinite(beltTeethExact) ? Math.round(beltTeethExact) : Number.POSITIVE_INFINITY,
      beltTeethError: Number.isFinite(beltTeethExact) ? beltTeethExact - Math.round(beltTeethExact) : Number.POSITIVE_INFINITY,
      pulleyIPitchDia: inputParams.pulleyI_teeth * pitch / Math.PI,
      pulleyOPitchDia: inputParams.pulleyO_teeth * pitch / Math.PI,
      pulleyIPitchR: inputParams.pulleyI_teeth * pitch / Math.PI / 2,
      pulleyOPitchR: inputParams.pulleyO_teeth * pitch / Math.PI / 2,
      idlerR: inputParams.idler_OD_mm / 2,
      beltBackToPitch,
      idlerEffR: inputParams.idler_OD_mm / 2 + beltBackToPitch,
      ratio: inputParams.pulleyO_teeth / inputParams.pulleyI_teeth,
      centerIO: inputParams.center_IO_mm,
      centerIIdler: Math.hypot(inputParams.idler_x_offset_mm, inputParams.center_IO_mm - actualY),
      centerOIdler: Math.hypot(inputParams.idler_x_offset_mm, actualY),
      idlerSpan: 2 * inputParams.idler_x_offset_mm,
      idlerYNominal: nominalY,
      idlerYActual: actualY,
      modelBeltLength: sol.length,
      beltResidual: sol.length - inputParams.belt_length_mm,
      lineLength: sol.lineLength,
      arcLength: sol.arcLength,
      clearanceWarnings: clearanceWarnings(modelP, inputParams.minimum_clearance_mm)
    };
  }

  function formatNumber(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : "inf";
  }

  function placeholderComment(text) {
    return `${PLACEHOLDER_WARNING} ${text}`;
  }

  function fusionRows(inputParams, beltType, nominalY) {
    if (nominalY === null || nominalY === undefined) {
      throw new Error("Cannot export Fusion CSV before the solver finds a neutral idler Y.");
    }
    const resolvedNominalY = nominalY;
    const modelP = modelParams(inputParams, resolvedNominalY + inputParams.tension_offset_mm);
    const sol = beltSolution(modelP);
    const d = derived(inputParams, modelP, sol, resolvedNominalY);

    function mm(value) {
      return `${value.toFixed(4)} mm`;
    }

    const beltTypeCodes = { GT2: 1, GT3: 2, "HTD-3M": 3, "HTD-5M": 4, MXL: 5 };
    const beltTypeCode = beltTypeCodes[beltType] || 0;
    const beltTypeComment = `Belt profile: ${beltType}. 0=Custom, 1=GT2, 2=GT3, 3=HTD-3M, 4=HTD-5M, 5=MXL.`;

    const rows = [
      ["belt_profile_code", "No Units", String(beltTypeCode), beltTypeComment],
      ["belt_pitch_mm", "mm", mm(inputParams.belt_pitch_mm), "Timing belt tooth pitch."],
      ["belt_length_mm", "mm", mm(inputParams.belt_length_mm), "Closed-loop belt pitch length."],
      ["belt_teeth_exact", "No Units", "belt_length_mm/belt_pitch_mm", "Implied closed belt tooth count; should be an integer for real belts."],
      ["pulleyI_teeth", "No Units", String(Math.round(inputParams.pulleyI_teeth)), "Input/motor timing pulley tooth count."],
      ["pulleyO_teeth", "No Units", String(Math.round(inputParams.pulleyO_teeth)), "Output timing pulley tooth count."],
      ["ratio", "No Units", "pulleyO_teeth/pulleyI_teeth", "Reduction ratio."],
      ["pulleyI_pitch_dia_mm", "mm", "pulleyI_teeth*belt_pitch_mm/PI", "Input pulley pitch diameter."],
      ["pulleyO_pitch_dia_mm", "mm", "pulleyO_teeth*belt_pitch_mm/PI", "Output pulley pitch diameter."],
      ["pulleyI_pitch_r_mm", "mm", "pulleyI_pitch_dia_mm/2", "Input pulley pitch radius."],
      ["pulleyO_pitch_r_mm", "mm", "pulleyO_pitch_dia_mm/2", "Output pulley pitch radius."],
      ["idler_OD_mm", "mm", mm(inputParams.idler_OD_mm), "Smooth backside idler outside diameter."],
      ["idler_r_mm", "mm", "idler_OD_mm/2", "Smooth idler physical radius."],
      ["belt_back_to_pitch_mm", "mm", mm(inputParams.belt_back_to_pitch_mm ?? BELT_BACK_TO_PITCH), "Offset from belt back surface to pitch line; affects backside idler pitch radius."],
      ["center_IO_mm", "mm", mm(inputParams.center_IO_mm), "Vertical center distance between output and input pulley."],
      ["idler_x_offset_mm", "mm", mm(inputParams.idler_x_offset_mm), "Horizontal half-spacing from centerline to either idler."],
      ["tension_slot_travel_mm", "mm", mm(inputParams.tension_slot_travel_mm), "Total travel range of the shared idler pod."],
      ["tension_offset_mm", "mm", mm(inputParams.tension_offset_mm), "Current idler-pod displacement from the solved neutral position."],
      ["belt_visual_thickness_mm", "mm", mm(inputParams.belt_visual_thickness_mm), "Visual belt thickness in the 2D drawing only."],
      ["minimum_clearance_mm", "mm", mm(inputParams.minimum_clearance_mm), "Clearance warning threshold between 2D circular parts."],
      ["output_x_mm", "mm", "0 mm", "Output pulley center X. Layout origin."],
      ["output_y_mm", "mm", "0 mm", "Output pulley center Y. Layout origin."],
      ["input_x_mm", "mm", "0 mm", "Input pulley center X. Symmetry centerline."],
      ["input_y_mm", "mm", "center_IO_mm", "Input pulley center Y above output."],
      ["idler_y_nominal_mm", "mm", mm(d.idlerYNominal), "Solved idler Y at zero tension offset."],
      ["idler_y_mm", "mm", "idler_y_nominal_mm+tension_offset_mm", "Current shared idler Y coordinate."],
      ["idler1_x_mm", "mm", "-idler_x_offset_mm", "Left idler center X."],
      ["idler1_y_mm", "mm", "idler_y_mm", "Left idler center Y."],
      ["idler2_x_mm", "mm", "idler_x_offset_mm", "Right idler center X."],
      ["idler2_y_mm", "mm", "idler_y_mm", "Right idler center Y."],
      ["center_I_idler_mm", "mm", mm(d.centerIIdler), "Computed center distance from input pulley to either idler at current offset."],
      ["center_O_idler_mm", "mm", mm(d.centerOIdler), "Computed center distance from output pulley to either idler at current offset."],
      ["idler_span_mm", "mm", "2*idler_x_offset_mm", "Distance between the two idler centers."],
      ["motor_mount_hole_spacing_mm", "mm", "31 mm", placeholderComment("NEMA17 mounting hole spacing.")],
      ["motor_screw_clearance_dia_mm", "mm", "3.4 mm", placeholderComment("M3 clearance hole.")],
      ["motor_pilot_clearance_dia_mm", "mm", "23 mm", placeholderComment("Typical NEMA17 pilot clearance.")],
      ["output_shaft_dia_mm", "mm", "8 mm", placeholderComment("Output shaft diameter.")],
      ["output_bearing_OD_mm", "mm", "16 mm", placeholderComment("Output bearing OD, e.g. 688 bearing.")],
      ["output_bearing_width_mm", "mm", "5 mm", placeholderComment("Output bearing width.")],
      ["idler_bolt_dia_mm", "mm", "5 mm", placeholderComment("Idler bearing mounting bolt diameter.")],
      ["idler_bolt_clearance_dia_mm", "mm", "idler_bolt_dia_mm+0.4 mm", placeholderComment("Idler bolt clearance hole.")],
      ["slot_length_mm", "mm", "tension_slot_travel_mm+idler_bolt_dia_mm", placeholderComment("Idler tension slot length.")],
      ["slot_width_mm", "mm", "idler_bolt_clearance_dia_mm", placeholderComment("Idler tension slot width.")],
      ["wall_thickness_mm", "mm", "3 mm", placeholderComment("General structural wall thickness.")]
    ];
    return rows.map(([name, unit, expression, comment]) => [name, unit, expression, "", comment, "false"]);
  }

  function diagnosticsText(inputParams, beltType, state, modelP, sol, d) {
    const target = d.beltPitchLength;
    const teethError = d.beltTeethError;
    let toothLine = `Implied belt teeth: ${formatNumber(d.beltTeethExact, 3)}`;
    if (Number.isFinite(teethError) && Math.abs(teethError) < 1e-6) {
      toothLine += ` (${Math.round(d.beltTeethRounded)}T)`;
    } else {
      toothLine += " (not an integer tooth count)";
    }

    const travelHalf = inputParams.tension_slot_travel_mm / 2;
    const offsetWarning = inputParams.tension_slot_travel_mm >= 0 &&
      Math.abs(inputParams.tension_offset_mm) > travelHalf + 1e-9;
    const lines = [
      `Belt profile: ${beltType}`,
      `Belt pitch: ${formatNumber(inputParams.belt_pitch_mm, 3)} mm`,
      `Belt pitch length: ${formatNumber(target, 3)} mm`,
      toothLine,
      "",
      `Ratio: ${formatNumber(d.ratio, 3)}:1`,
      `Input pitch dia: ${formatNumber(d.pulleyIPitchDia, 3)} mm`,
      `Output pitch dia: ${formatNumber(d.pulleyOPitchDia, 3)} mm`,
      `Idler OD: ${formatNumber(inputParams.idler_OD_mm, 3)} mm`,
      `Belt back-to-pitch: ${formatNumber(d.beltBackToPitch, 3)} mm`,
      `Idler pitch radius: ${formatNumber(d.idlerEffR, 3)} mm`,
      "",
      d.idlerYNominal !== null && d.idlerYNominal !== undefined
        ? `Neutral idler Y: ${formatNumber(d.idlerYNominal, 3)} mm`
        : "Neutral idler Y: unsolved",
      `Current idler Y: ${formatNumber(d.idlerYActual, 3)} mm`,
      `Tension offset: ${inputParams.tension_offset_mm >= 0 ? "+" : ""}${formatNumber(inputParams.tension_offset_mm, 3)} mm of +/-${formatNumber(travelHalf, 3)} mm`,
      `Model belt length at current offset: ${formatNumber(d.modelBeltLength, 3)} mm`,
      `Length residual at current offset: ${d.beltResidual >= 0 ? "+" : ""}${formatNumber(d.beltResidual, 3)} mm`,
      `Line length: ${formatNumber(d.lineLength, 3)} mm`,
      `Arc length: ${formatNumber(d.arcLength, 3)} mm`,
      "",
      `Center I-O: ${formatNumber(d.centerIO, 3)} mm`,
      `Center I-idler: ${formatNumber(d.centerIIdler, 3)} mm`,
      `Center O-idler: ${formatNumber(d.centerOIdler, 3)} mm`,
      `Idler span: ${formatNumber(d.idlerSpan, 3)} mm`,
      `Solve candidates: ${state.idlerYCandidates.length}`,
      ""
    ];

    const warnings = [];
    if (Number.isFinite(teethError) && Math.abs(teethError) >= 1e-6) {
      warnings.push("Belt length is not an integer multiple of belt pitch.");
    }
    if (offsetWarning) {
      warnings.push("Tension offset is outside half of the configured slot travel.");
    }
    if (state.solvedIdlerYNominal === null) {
      warnings.push("Fusion CSV export is disabled until the solver finds a neutral idler Y.");
    }
    if (d.clearanceWarnings.length) {
      warnings.push(`Clearance below minimum: ${d.clearanceWarnings.map((warning) => warning.text).join("; ")}`);
    }
    if (warnings.length) {
      lines.push("Warnings:");
      warnings.forEach((warning) => lines.push(`  ${warning}`));
      lines.push("");
    }

    if (state.layoutError !== null) {
      lines.push("Invalid selected belt:", state.layoutError);
    } else if (sol.valid) {
      lines.push("Wrap angles:");
      Object.keys(sol.wrapDeg).forEach((key) => {
        lines.push(`  ${key}: ${formatNumber(sol.wrapDeg[key], 1)} deg`);
      });
    } else {
      lines.push(`Invalid: ${sol.reason}`);
    }
    return lines.join("\n");
  }

  function makeSvgElement(name, attrs) {
    const element = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach((key) => {
      element.setAttribute(key, attrs[key]);
    });
    return element;
  }

  function appendLine(parent, a, b, className, extraAttrs) {
    parent.appendChild(makeSvgElement("line", Object.assign({
      x1: a[0],
      y1: a[1],
      x2: b[0],
      y2: b[1],
      class: className
    }, extraAttrs || {})));
  }

  function appendText(svg, text, x, y, className, anchor) {
    const node = makeSvgElement("text", {
      x,
      y: -y,
      class: className,
      "text-anchor": anchor || "middle",
      "dominant-baseline": "middle"
    });
    node.textContent = text;
    svg.appendChild(node);
  }

  function appendPillText(svg, text, x, y, className, fontSize, anchor) {
    const textAnchor = anchor || "middle";
    const width = Math.max(fontSize * 2.4, text.length * fontSize * 0.58 + fontSize * 1.1);
    const height = fontSize * 1.85;
    const left = textAnchor === "middle" ? x - width / 2 : x - fontSize * 0.55;
    const top = -y - height / 2;
    svg.appendChild(makeSvgElement("rect", {
      x: left,
      y: top,
      width,
      height,
      rx: fontSize * 0.55,
      ry: fontSize * 0.55,
      class: `annotation-pill ${className}-pill`
    }));
    appendText(svg, text, x, y, className, textAnchor);
  }

  function summarizePlotError(message) {
    if (/too short/i.test(message)) {
      return "Belt too short";
    }
    if (/too long/i.test(message)) {
      return "Belt too long";
    }
    if (/No valid/i.test(message)) {
      return "No valid path";
    }
    return "Invalid layout";
  }

  function pointsToPath(points) {
    if (!points.length) {
      return "";
    }
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
  }

  function drawGrid(svg, minX, maxX, minY, maxY) {
    const grid = makeSvgElement("g", { transform: "scale(1 -1)" });
    const spacing = 10;
    const xStart = Math.ceil(minX / spacing) * spacing;
    const yStart = Math.ceil(minY / spacing) * spacing;
    for (let x = xStart; x <= maxX; x += spacing) {
      appendLine(grid, [x, minY], [x, maxY], "plot-grid");
    }
    for (let y = yStart; y <= maxY; y += spacing) {
      appendLine(grid, [minX, y], [maxX, y], "plot-grid");
    }
    svg.appendChild(grid);
  }

  function dimLine(svg, geometryGroup, p1, p2, text, offset, labelOffset) {
    const a = [p1[0] + offset[0], p1[1] + offset[1]];
    const b = [p2[0] + offset[0], p2[1] + offset[1]];
    const labelShift = labelOffset || [0, 0];
    appendLine(geometryGroup, a, b, "dimension-line", {
      "marker-start": "url(#arrow)",
      "marker-end": "url(#arrow)"
    });
    appendLine(geometryGroup, p1, a, "extension-line");
    appendLine(geometryGroup, p2, b, "extension-line");
    appendPillText(
      svg,
      text,
      (a[0] + b[0]) / 2 + labelShift[0],
      (a[1] + b[1]) / 2 + labelShift[1],
      "dimension-label",
      DIMENSION_LABEL_FONT_SIZE
    );
  }

  function makeBounds() {
    return {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    };
  }

  function includePoint(bounds, point, pad) {
    const extra = pad || 0;
    bounds.minX = Math.min(bounds.minX, point[0] - extra);
    bounds.maxX = Math.max(bounds.maxX, point[0] + extra);
    bounds.minY = Math.min(bounds.minY, point[1] - extra);
    bounds.maxY = Math.max(bounds.maxY, point[1] + extra);
  }

  function includeCircle(bounds, center, radius, pad) {
    includePoint(bounds, center, radius + (pad || 0));
  }

  function includeText(bounds, text, x, y, fontSize, pad) {
    const extra = pad || 0;
    const halfWidth = Math.max(fontSize, text.length * fontSize * 0.3) + extra;
    const halfHeight = fontSize * 0.65 + extra;
    includePoint(bounds, [x - halfWidth, y - halfHeight]);
    includePoint(bounds, [x + halfWidth, y + halfHeight]);
  }

  function includeDimension(bounds, dimension) {
    const offset = dimension.offset;
    const labelOffset = dimension.labelOffset || [0, 0];
    const a = [dimension.p1[0] + offset[0], dimension.p1[1] + offset[1]];
    const b = [dimension.p2[0] + offset[0], dimension.p2[1] + offset[1]];
    includePoint(bounds, dimension.p1);
    includePoint(bounds, dimension.p2);
    includePoint(bounds, a, 1);
    includePoint(bounds, b, 1);
    includeText(
      bounds,
      dimension.text,
      (a[0] + b[0]) / 2 + labelOffset[0],
      (a[1] + b[1]) / 2 + labelOffset[1],
      DIMENSION_LABEL_FONT_SIZE,
      1.6
    );
  }

  function drawLayout(svg, inputParams, modelP, sol, d, state) {
    svg.replaceChildren();

    const defs = makeSvgElement("defs");
    const marker = makeSvgElement("marker", {
      id: "arrow",
      viewBox: "-5 -5 10 10",
      refX: "0",
      refY: "0",
      markerWidth: "5",
      markerHeight: "5",
      orient: "auto-start-reverse"
    });
    marker.appendChild(makeSvgElement("path", {
      d: "M -4 -3 L 3 0 L -4 3 z",
      fill: "#5f685c"
    }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const items = circles(modelP);
    const slotYMin = state.solvedIdlerYNominal !== null
      ? state.solvedIdlerYNominal - inputParams.tension_slot_travel_mm / 2
      : modelP.idlerY;
    const slotYMax = state.solvedIdlerYNominal !== null
      ? state.solvedIdlerYNominal + inputParams.tension_slot_travel_mm / 2
      : modelP.idlerY;

    const idlerSpanDimOffset = [0, 23];
    const idlerSpanLabelOffset = [0, 3];
    const outputIdlerDimOffset = [8, -8];
    const outputIdlerLabelOffset = [7, -1];
    const inputIdlerDimOffset = [8, 8];
    const inputIdlerLabelOffset = [8, 0];
    const centerIoDimOffset = [
      modelP.idlerX +
        Math.max(d.pulleyOPitchR, d.pulleyIPitchR, d.idlerEffR) +
        Math.abs(idlerSpanDimOffset[1]) +
        Math.abs(idlerSpanLabelOffset[1]),
      0
    ];
    const dimensions = [
      {
        p1: [0, 0],
        p2: [0, modelP.motorY],
        text: `center_IO ${modelP.motorY.toFixed(1)}`,
        offset: centerIoDimOffset
      },
      {
        p1: [-modelP.idlerX, modelP.idlerY],
        p2: [modelP.idlerX, modelP.idlerY],
        text: `idler span ${(2 * modelP.idlerX).toFixed(1)}`,
        offset: idlerSpanDimOffset,
        labelOffset: idlerSpanLabelOffset
      },
      {
        p1: [0, 0],
        p2: [modelP.idlerX, modelP.idlerY],
        text: `O-idler ${d.centerOIdler.toFixed(1)}`,
        offset: outputIdlerDimOffset,
        labelOffset: outputIdlerLabelOffset
      },
      {
        p1: [0, modelP.motorY],
        p2: [modelP.idlerX, modelP.idlerY],
        text: `I-idler ${d.centerIIdler.toFixed(1)}`,
        offset: inputIdlerDimOffset,
        labelOffset: inputIdlerLabelOffset
      }
    ];

    const bounds = makeBounds();
    const beltStrokePad = sol.valid && state.layoutError === null
      ? Math.max(0.6, inputParams.belt_visual_thickness_mm * 1.1)
      : 0;

    items.forEach((item) => {
      includeCircle(bounds, item.center, item.radius, 2);
      const label = {
        pulleyI: "input",
        pulleyO: "output",
        idler1: "idler L",
        idler2: "idler R"
      }[item.name] || item.name;
      const labelY = item.name === "pulleyO"
        ? item.center[1] - item.radius - 5
        : item.center[1] + item.radius + 3;
      includeText(bounds, label, item.center[0], labelY, PLOT_LABEL_FONT_SIZE, 1.2);
    });
    includePoint(bounds, [0, 0]);
    includePoint(bounds, [0, modelP.motorY]);
    includePoint(bounds, [-modelP.idlerX, modelP.idlerY]);
    includePoint(bounds, [modelP.idlerX, modelP.idlerY]);
    includePoint(bounds, [-modelP.idlerX, slotYMin], 1.5);
    includePoint(bounds, [-modelP.idlerX, slotYMax], 1.5);
    includePoint(bounds, [modelP.idlerX, slotYMin], 1.5);
    includePoint(bounds, [modelP.idlerX, slotYMax], 1.5);
    if (sol.valid && state.layoutError === null) {
      sol.tangentEdges.forEach((edge) => {
        includePoint(bounds, edge[0], beltStrokePad);
        includePoint(bounds, edge[1], beltStrokePad);
      });
      Object.keys(sol.arcPoints).forEach((key) => {
        sol.arcPoints[key].forEach((point) => includePoint(bounds, point, beltStrokePad));
      });
    }
    dimensions.forEach((dimension) => includeDimension(bounds, dimension));

    const viewPadding = Math.max(6, inputParams.belt_visual_thickness_mm * 2);
    const minX = bounds.minX - viewPadding;
    const maxX = bounds.maxX + viewPadding;
    const minY = bounds.minY - viewPadding;
    const maxY = bounds.maxY + viewPadding;

    svg.setAttribute("viewBox", `${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    drawGrid(svg, minX, maxX, minY, maxY);

    const geometry = makeSvgElement("g", { transform: "scale(1 -1)" });
    svg.appendChild(geometry);

    if (sol.valid && state.layoutError === null) {
      const beltWidth = Math.max(1.2, inputParams.belt_visual_thickness_mm * 2.2);
      sol.tangentEdges.forEach((edge) => {
        appendLine(geometry, edge[0], edge[1], "belt-shadow", { "stroke-width": beltWidth + 1.4 });
      });
      Object.keys(sol.arcPoints).forEach((key) => {
        geometry.appendChild(makeSvgElement("path", {
          d: pointsToPath(sol.arcPoints[key]),
          class: "belt-shadow",
          "stroke-width": beltWidth + 1.4
        }));
      });
      sol.tangentEdges.forEach((edge) => {
        appendLine(geometry, edge[0], edge[1], "belt-line", { "stroke-width": beltWidth });
      });
      Object.keys(sol.arcPoints).forEach((key) => {
        geometry.appendChild(makeSvgElement("path", {
          d: pointsToPath(sol.arcPoints[key]),
          class: "belt-line",
          "stroke-width": beltWidth
        }));
      });
    } else {
      appendPillText(
        svg,
        summarizePlotError(state.layoutError || sol.reason),
        (minX + maxX) / 2,
        maxY - viewPadding - ERROR_LABEL_FONT_SIZE,
        "error-label",
        ERROR_LABEL_FONT_SIZE
      );
    }

    if (state.solvedIdlerYNominal !== null && inputParams.tension_slot_travel_mm > 0) {
      const slotHalf = inputParams.tension_slot_travel_mm / 2;
      [-modelP.idlerX, modelP.idlerX].forEach((x) => {
        appendLine(
          geometry,
          [x, state.solvedIdlerYNominal - slotHalf],
          [x, state.solvedIdlerYNominal + slotHalf],
          "slot-line"
        );
      });
    }

    appendLine(geometry, [0, 0], [0, modelP.motorY], "axis-line");
    appendLine(geometry, [-modelP.idlerX, modelP.idlerY], [modelP.idlerX, modelP.idlerY], "axis-line");

    const warningNames = new Set();
    d.clearanceWarnings.forEach((warning) => {
      warning.names.forEach((name) => warningNames.add(name));
    });

    items.forEach((item) => {
      geometry.appendChild(makeSvgElement("circle", {
        cx: item.center[0],
        cy: item.center[1],
        r: item.radius,
        class: [
          "circle-line",
          item.kind === "pulley" ? "circle-pulley" : "circle-idler",
          warningNames.has(item.name) ? "circle-warning" : ""
        ].filter(Boolean).join(" ")
      }));
      appendLine(geometry, [item.center[0] - 1.8, item.center[1]], [item.center[0] + 1.8, item.center[1]], "center-mark");
      appendLine(geometry, [item.center[0], item.center[1] - 1.8], [item.center[0], item.center[1] + 1.8], "center-mark");
      const label = {
        pulleyI: "input",
        pulleyO: "output",
        idler1: "idler L",
        idler2: "idler R"
      }[item.name] || item.name;
      const labelY = item.name === "pulleyO"
        ? item.center[1] - item.radius - 5
        : item.center[1] + item.radius + 3;
      appendPillText(svg, label, item.center[0], labelY, "plot-label", PLOT_LABEL_FONT_SIZE);
    });

    dimensions.forEach((dimension) => {
      dimLine(svg, geometry, dimension.p1, dimension.p2, dimension.text, dimension.offset, dimension.labelOffset);
    });
  }

  function csvEscape(value) {
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function rowsToCsv(rows) {
    return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  }

  function initApp() {
    const controls = new Map();
    const state = {
      beltType: "GT2",
      solvedIdlerYNominal: null,
      idlerYCandidates: [],
      layoutError: null,
      lastSolveMessage: "Not solved"
    };

    const status = document.getElementById("status");
    const diagnostics = document.getElementById("diagnostics");
    const metricsBar = document.getElementById("metricsBar");
    const svg = document.getElementById("layoutSvg");
    const beltType = document.getElementById("beltType");
    const solveButton = document.getElementById("solveButton");
    const exportButton = document.getElementById("exportButton");

    function inputParams() {
      const out = {};
      controls.forEach((control, name) => {
        const value = Number.parseFloat(control.number.value);
        out[name] = Number.isFinite(value) ? value : DEFAULTS[name];
      });
      return out;
    }

    function setControlValue(name, value) {
      const control = controls.get(name);
      if (!control) {
        return;
      }
      control.range.value = value;
      control.number.value = value;
      updateRangeProgress(control.range);
    }

    function updateRangeProgress(range) {
      const min = Number.parseFloat(range.min);
      const max = Number.parseFloat(range.max);
      const value = Number.parseFloat(range.value);
      const percent = Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(value) && max > min
        ? Math.min(100, Math.max(0, (value - min) / (max - min) * 100))
        : 0;
      range.style.setProperty("--range-progress", `${percent}%`);
    }

    function appendMetric(label, value, tone) {
      const item = document.createElement("span");
      item.className = tone ? `metric ${tone}` : "metric";

      const labelNode = document.createElement("span");
      labelNode.className = "metric-label";
      labelNode.textContent = label;

      const valueNode = document.createElement("span");
      valueNode.className = "metric-value";
      valueNode.textContent = value;

      item.append(labelNode, valueNode);
      metricsBar.appendChild(item);
    }

    function renderMetrics(p, state, sol, d) {
      if (!metricsBar) {
        return;
      }
      metricsBar.replaceChildren();

      const toothError = Number.isFinite(d.beltTeethError) ? Math.abs(d.beltTeethError) : Number.POSITIVE_INFINITY;
      const teeth = toothError < 1e-6
        ? `${Math.round(d.beltTeethRounded)}T`
        : `${formatNumber(d.beltTeethExact, 1)}T`;
      const travelHalf = p.tension_slot_travel_mm / 2;
      const offsetTone = p.tension_slot_travel_mm >= 0 && Math.abs(p.tension_offset_mm) > travelHalf + 1e-9
        ? "warning"
        : "";
      const residualTone = Math.abs(d.beltResidual) > 0.05 ? "warning" : "";
      const clearanceTone = d.clearanceWarnings.length ? "danger" : "";

      appendMetric("Drive Ratio", `${formatNumber(d.ratio, 2)}:1`);
      appendMetric("Belt Teeth", teeth, toothError < 1e-6 ? "" : "warning");
      appendMetric(
        "Neutral Y",
        state.solvedIdlerYNominal === null ? "unsolved" : `${formatNumber(state.solvedIdlerYNominal, 2)} mm`,
        state.solvedIdlerYNominal === null ? "danger" : "primary"
      );
      appendMetric("Offset", `${p.tension_offset_mm >= 0 ? "+" : ""}${formatNumber(p.tension_offset_mm, 1)} mm`, offsetTone);
      appendMetric("Residual", `${d.beltResidual >= 0 ? "+" : ""}${formatNumber(d.beltResidual, 3)} mm`, residualTone);
      appendMetric("Clearance", d.clearanceWarnings.length ? `${d.clearanceWarnings.length} warning` : "OK", clearanceTone);
      if (!sol.valid || state.layoutError !== null) {
        appendMetric("Layout", "invalid", "danger");
      }
    }

    function render() {
      const p = inputParams();
      const nominalY = state.solvedIdlerYNominal === null ? p.center_IO_mm / 2 : state.solvedIdlerYNominal;
      const actualY = nominalY + p.tension_offset_mm;
      const modelP = modelParams(p, actualY);
      const sol = beltSolution(modelP);
      const d = derived(p, modelP, sol, state.solvedIdlerYNominal);
      const canExport = state.solvedIdlerYNominal !== null;
      status.textContent = state.lastSolveMessage;
      status.classList.toggle("danger", !canExport);
      exportButton.disabled = !canExport;
      exportButton.title = canExport
        ? "Export Fusion 360 Parameter I/O CSV"
        : "CSV export disabled until the solver finds a neutral idler Y";
      diagnostics.textContent = diagnosticsText(p, state.beltType, state, modelP, sol, d);
      renderMetrics(p, state, sol, d);
      drawLayout(svg, p, modelP, sol, d, state);
    }

    function solveAndRender() {
      const p = inputParams();
      const baseModel = modelParams(p, 0.0);
      const result = solveIdlerY(baseModel);
      state.idlerYCandidates = result.candidates;
      state.lastSolveMessage = result.message;
      if (result.y === null) {
        state.solvedIdlerYNominal = null;
        state.layoutError = result.message;
      } else {
        state.solvedIdlerYNominal = result.y;
        state.layoutError = null;
        const suffix = result.candidates.length === 1 ? "" : ` (${result.candidates.length} candidates)`;
        state.lastSolveMessage = `Solved neutral idler Y = ${result.y.toFixed(3)} mm${suffix}`;
      }
      render();
    }

    function applyBeltType(shouldSolve) {
      state.beltType = beltType.value;
      const pitch = controls.get("belt_pitch_mm");
      if (state.beltType === CUSTOM_BELT_TYPE) {
        pitch.range.disabled = false;
        pitch.number.disabled = false;
      } else {
        setControlValue("belt_pitch_mm", BELT_PITCH_PRESETS[state.beltType]);
        pitch.range.disabled = true;
        pitch.number.disabled = true;
      }
      if (shouldSolve) {
        solveAndRender();
      }
    }

    function onControlChanged(name, source) {
      const control = controls.get(name);
      if (!control) {
        return;
      }
      const parsed = Number.parseFloat(source.value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      control.range.value = parsed;
      control.number.value = parsed;
      updateRangeProgress(control.range);
      if (SOLVER_INPUTS.has(name)) {
        solveAndRender();
      } else {
        render();
      }
    }

    function scheduleNumberControlChanged(name, source) {
      const control = controls.get(name);
      if (!control) {
        return;
      }
      if (control.debounceTimer !== null) {
        global.clearTimeout(control.debounceTimer);
      }
      control.debounceTimer = global.setTimeout(() => {
        control.debounceTimer = null;
        onControlChanged(name, source);
      }, NUMBER_INPUT_DEBOUNCE_MS);
    }

    function cancelPendingControlChange(name) {
      const control = controls.get(name);
      if (control && control.debounceTimer !== null) {
        global.clearTimeout(control.debounceTimer);
        control.debounceTimer = null;
      }
    }

    function createControl(containerId, spec) {
      const [name, label, unit, min, max, step] = spec;
      const field = document.createElement("label");
      field.className = "field";
      field.htmlFor = `${name}-number`;

      const labelNode = document.createElement("span");
      labelNode.textContent = label;

      const number = document.createElement("input");
      number.id = `${name}-number`;
      number.type = "number";
      number.min = String(min);
      number.max = String(max);
      number.step = String(step);
      number.value = DEFAULTS[name];

      const unitNode = document.createElement("span");
      unitNode.className = "unit";
      unitNode.textContent = unit;

      const range = document.createElement("input");
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = DEFAULTS[name];
      range.setAttribute("aria-label", label);
      updateRangeProgress(range);

      field.append(labelNode, number, unitNode, range);
      document.getElementById(containerId).appendChild(field);

      controls.set(name, { range, number, debounceTimer: null });
      range.addEventListener("input", () => {
        cancelPendingControlChange(name);
        onControlChanged(name, range);
      });
      number.addEventListener("input", () => scheduleNumberControlChanged(name, number));
      number.addEventListener("change", () => {
        cancelPendingControlChange(name);
        onControlChanged(name, number);
      });
    }

    Object.keys(CONTROL_GROUPS).forEach((containerId) => {
      CONTROL_GROUPS[containerId].forEach((spec) => createControl(containerId, spec));
    });

    beltType.addEventListener("change", () => applyBeltType(true));
    solveButton.addEventListener("click", solveAndRender);
    document.getElementById("resetButton").addEventListener("click", () => {
      state.beltType = "GT2";
      beltType.value = "GT2";
      Object.keys(DEFAULTS).forEach((name) => setControlValue(name, DEFAULTS[name]));
      applyBeltType(false);
      solveAndRender();
    });
    exportButton.addEventListener("click", () => {
      if (state.solvedIdlerYNominal === null) {
        status.textContent = "Cannot export CSV until the solver finds a neutral idler Y.";
        status.classList.add("danger");
        exportButton.disabled = true;
        return;
      }
      const p = inputParams();
      const rows = [["Name", "Unit", "Expression", "Value", "Comments", "Favorite"]].concat(
        fusionRows(p, state.beltType, state.solvedIdlerYNominal)
      );
      const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "belt_actuator_fusion_parameters.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });

    applyBeltType(false);
    solveAndRender();
  }

  const api = {
    BELT_PITCH_PRESETS,
    CUSTOM_BELT_TYPE,
    BELT_BACK_TO_PITCH,
    DEFAULTS,
    CONTROL_GROUPS,
    SOLVER_INPUTS,
    modelParams,
    circles,
    beltSolution,
    solveIdlerY,
    solveIdlerX,
    derived,
    formatNumber,
    diagnosticsText,
    drawLayout,
    fusionRows,
    rowsToCsv
  };

  global.BeltActuator = api;
  if (global.document) {
    global.addEventListener("DOMContentLoaded", () => {
      if (!global.document.getElementById("root")) {
        initApp();
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
