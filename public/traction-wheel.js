(function (global) {
  "use strict";

  const MODE_WHEEL_DIAMETER = "wheel-diameter";
  const MODE_TARGET_STRETCH = "target-stretch";

  const DEFAULTS = {
    mode: MODE_WHEEL_DIAMETER,
    oring_id_mm: 34.0,
    oring_cs_mm: 3.0,
    wheel_groove_diameter_mm: 36.0,
    target_stretch_percent: 6.0,
    groove_width_mm: 3.2,
    groove_depth_mm: 1.6
  };

  function numericValue(values, name) {
    const parsed = Number.parseFloat(values?.[name]);
    return Number.isFinite(parsed) ? parsed : DEFAULTS[name];
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    const places = digits ?? 2;
    const displayValue = Math.abs(value) < Math.pow(10, -places) / 2 ? 0 : value;
    return displayValue.toLocaleString("en-US", {
      maximumFractionDigits: places,
      minimumFractionDigits: places
    });
  }

  function solveCircularSectionDiameter(grooveDiameter, nominalCenterlineDiameter, nominalSectionDiameter) {
    const target = nominalSectionDiameter * nominalSectionDiameter * nominalCenterlineDiameter;
    let lo = 0.0;
    let hi = Math.max(nominalSectionDiameter, 0.1);

    function residual(sectionDiameter) {
      return sectionDiameter * sectionDiameter * (grooveDiameter + sectionDiameter) - target;
    }

    while (residual(hi) < 0) {
      hi *= 2;
    }

    for (let i = 0; i < 90; i += 1) {
      const mid = (lo + hi) / 2;
      if (residual(mid) <= 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }

  function solveGrooveHeight(grooveDiameter, grooveWidth, nominalArea, nominalCenterlineDiameter) {
    const target = nominalArea * nominalCenterlineDiameter / grooveWidth;
    return (-grooveDiameter + Math.sqrt(grooveDiameter * grooveDiameter + 4 * target)) / 2;
  }

  function validatePositive(errors, value, label) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${label} must be greater than zero.`);
    }
  }

  function calculationInput(values) {
    const mode = values?.mode === MODE_TARGET_STRETCH ? MODE_TARGET_STRETCH : MODE_WHEEL_DIAMETER;
    const input = {
      mode,
      oring_id_mm: numericValue(values, "oring_id_mm"),
      oring_cs_mm: numericValue(values, "oring_cs_mm"),
      wheel_groove_diameter_mm: numericValue(values, "wheel_groove_diameter_mm"),
      target_stretch_percent: numericValue(values, "target_stretch_percent"),
      groove_width_mm: numericValue(values, "groove_width_mm"),
      groove_depth_mm: numericValue(values, "groove_depth_mm")
    };

    if (mode === MODE_TARGET_STRETCH) {
      input.wheel_groove_diameter_mm = input.oring_id_mm * (1 + input.target_stretch_percent / 100);
    } else {
      input.target_stretch_percent = (
        input.wheel_groove_diameter_mm / input.oring_id_mm - 1
      ) * 100;
    }

    return input;
  }

  function calculate(values) {
    const input = calculationInput(values);
    const errors = [];

    validatePositive(errors, input.oring_id_mm, "O-ring inside diameter");
    validatePositive(errors, input.oring_cs_mm, "O-ring cross-section");
    validatePositive(errors, input.wheel_groove_diameter_mm, "Groove floor diameter");
    validatePositive(errors, input.groove_width_mm, "Groove width");
    validatePositive(errors, input.groove_depth_mm, "Groove depth");

    if (!Number.isFinite(input.target_stretch_percent)) {
      errors.push("Target stretch must be a finite number.");
    }

    if (errors.length) {
      return {
        valid: false,
        input,
        errors,
        warnings: [],
        metrics: {}
      };
    }

    const nominalSectionRadius = input.oring_cs_mm / 2;
    const nominalArea = Math.PI * nominalSectionRadius * nominalSectionRadius;
    const nominalCenterlineDiameter = input.oring_id_mm + input.oring_cs_mm;
    const nominalVolume = Math.PI * nominalCenterlineDiameter * nominalArea;

    const freeSectionDiameter = solveCircularSectionDiameter(
      input.wheel_groove_diameter_mm,
      nominalCenterlineDiameter,
      input.oring_cs_mm
    );
    const freeArea = Math.PI * Math.pow(freeSectionDiameter / 2, 2);
    const freeCenterlineDiameter = input.wheel_groove_diameter_mm + freeSectionDiameter;

    const installedHeight = solveGrooveHeight(
      input.wheel_groove_diameter_mm,
      input.groove_width_mm,
      nominalArea,
      nominalCenterlineDiameter
    );
    const installedArea = input.groove_width_mm * installedHeight;
    const installedCenterlineDiameter = input.wheel_groove_diameter_mm + installedHeight;
    const installedVolume = Math.PI * installedCenterlineDiameter * installedArea;
    const equivalentSectionDiameter = 2 * Math.sqrt(installedArea / Math.PI);
    const finalWheelOd = input.wheel_groove_diameter_mm + 2 * installedHeight;
    const rimOd = input.wheel_groove_diameter_mm + 2 * input.groove_depth_mm;
    const treadProtrusion = installedHeight - input.groove_depth_mm;
    const grooveFillPercent = installedArea / (input.groove_width_mm * input.groove_depth_mm) * 100;
    const innerStretchPercent = (input.wheel_groove_diameter_mm / input.oring_id_mm - 1) * 100;
    const centerlineStretchPercent = (installedCenterlineDiameter / nominalCenterlineDiameter - 1) * 100;
    const areaRatioPercent = installedArea / nominalArea * 100;
    const volumeError = installedVolume - nominalVolume;
    const freeVolumeError = Math.PI * freeCenterlineDiameter * freeArea - nominalVolume;

    const warnings = [];
    if (innerStretchPercent < 2) {
      warnings.push("Low inside stretch; the tire may slip on the wheel.");
    }
    if (innerStretchPercent > 8) {
      warnings.push("High inside stretch; check the o-ring material limit before printing the wheel.");
    }
    if (centerlineStretchPercent > 8) {
      warnings.push("High centerline stretch after volume correction.");
    }
    if (treadProtrusion <= 0) {
      warnings.push("Groove depth is at or above the conserved tire height; the tread will not protrude.");
    } else if (treadProtrusion < 0.25) {
      warnings.push("Tread protrusion is very small.");
    }
    if (input.groove_width_mm < freeSectionDiameter * 0.75) {
      warnings.push("Groove is narrow relative to the conserved free section; expect a tall crowned tire.");
    }
    if (input.groove_width_mm > freeSectionDiameter * 1.45) {
      warnings.push("Groove is wide relative to the conserved free section; the tire may sit low or move laterally.");
    }

    return {
      valid: true,
      input,
      errors: [],
      warnings,
      metrics: {
        nominalArea,
        nominalCenterlineDiameter,
        nominalVolume,
        freeSectionDiameter,
        freeArea,
        freeCenterlineDiameter,
        freeVolumeError,
        installedHeight,
        installedArea,
        installedCenterlineDiameter,
        installedVolume,
        equivalentSectionDiameter,
        finalWheelOd,
        rimOd,
        treadProtrusion,
        grooveFillPercent,
        innerStretchPercent,
        centerlineStretchPercent,
        areaRatioPercent,
        volumeError
      }
    };
  }

  function diagnosticsText(result) {
    if (!result.valid) {
      return ["Invalid inputs:"].concat(result.errors.map((error) => `- ${error}`)).join("\n");
    }

    const m = result.metrics;
    const checks = result.warnings.length
      ? result.warnings.map((warning) => `- ${warning}`)
      : ["- No warnings for the current inputs."];

    return [
      `Nominal torus volume: ${formatNumber(m.nominalVolume, 3)} mm^3`,
      `Installed volume error: ${formatNumber(m.volumeError, 6)} mm^3`,
      `Unconstrained circular volume error: ${formatNumber(m.freeVolumeError, 6)} mm^3`,
      `Inside stretch: ${formatNumber(m.innerStretchPercent, 2)}%`,
      `Centerline stretch: ${formatNumber(m.centerlineStretchPercent, 2)}%`,
      `Cross-section area after stretch: ${formatNumber(m.areaRatioPercent, 1)}% of nominal`,
      "",
      "Checks:",
      ...checks
    ].join("\n");
  }

  const api = {
    MODE_WHEEL_DIAMETER,
    MODE_TARGET_STRETCH,
    DEFAULTS,
    calculate,
    diagnosticsText,
    formatNumber
  };

  global.TractionWheel = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
