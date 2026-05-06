import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const api = window.BeltActuator;
const customizer = window.BeltCustomizer;

if (!api) {
  throw new Error("BeltActuator API script did not load.");
}
if (!customizer) {
  throw new Error("BeltCustomizer helper script did not load.");
}

const SOLVER_INPUT_NAMES = Array.from(api.SOLVER_INPUTS);
const BELT_TYPES = Object.keys(api.BELT_PITCH_PRESETS).concat(api.CUSTOM_BELT_TYPE);

function defaultControlValues() {
  return Object.fromEntries(
    Object.entries(api.DEFAULTS).map(([name, value]) => [name, String(value)])
  );
}

function numericValue(values, name) {
  const parsed = Number.parseFloat(values[name]);
  return Number.isFinite(parsed) ? parsed : api.DEFAULTS[name];
}

function inputParamsFromValues(values) {
  return Object.fromEntries(
    Object.keys(api.DEFAULTS).map((name) => [name, numericValue(values, name)])
  );
}

function rangeProgress(value, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || max <= min) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((parsed - min) / (max - min)) * 100));
}

function solveNeutralIdlerY(inputParams) {
  const baseModel = api.modelParams(inputParams, 0.0);
  const result = api.solveIdlerY(baseModel);

  if (result.y === null) {
    return {
      solvedIdlerYNominal: null,
      idlerYCandidates: result.candidates,
      layoutError: result.message,
      lastSolveMessage: result.message
    };
  }

  const suffix = result.candidates.length === 1 ? "" : ` (${result.candidates.length} candidates)`;
  return {
    solvedIdlerYNominal: result.y,
    idlerYCandidates: result.candidates,
    layoutError: null,
    lastSolveMessage: `Solved neutral idler Y = ${result.y.toFixed(3)} mm${suffix}`
  };
}

function ControlField({ spec, value, disabled, onValueChange }) {
  const [name, label, unit, min, max, step] = spec;
  const inputId = `${name}-number`;
  const rangeValue = Number.isFinite(Number.parseFloat(value)) ? value : String(api.DEFAULTS[name]);
  const progress = rangeProgress(rangeValue, min, max);

  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        id={inputId}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(name, event.target.value)}
      />
      <span className="unit">{unit}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={rangeValue}
        disabled={disabled}
        aria-label={label}
        style={{ "--range-progress": `${progress}%` }}
        onChange={(event) => onValueChange(name, event.target.value)}
      />
    </label>
  );
}

function ControlGroup({ groupId, values, pitchLocked, onValueChange }) {
  return (
    <div id={groupId} className="control-list">
      {api.CONTROL_GROUPS[groupId].map((spec) => (
        <ControlField
          key={spec[0]}
          spec={spec}
          value={values[spec[0]]}
          disabled={pitchLocked && spec[0] === "belt_pitch_mm"}
          onValueChange={onValueChange}
        />
      ))}
    </div>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <span className={tone ? `metric ${tone}` : "metric"}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </span>
  );
}

function MetricsBar({ inputParams, solveState, solution, derived }) {
  const toothError = Number.isFinite(derived.beltTeethError)
    ? Math.abs(derived.beltTeethError)
    : Number.POSITIVE_INFINITY;
  const teeth = toothError < 1e-6
    ? `${Math.round(derived.beltTeethRounded)}T`
    : `${api.formatNumber(derived.beltTeethExact, 1)}T`;
  const travelHalf = inputParams.tension_slot_travel_mm / 2;
  const offsetTone = inputParams.tension_slot_travel_mm >= 0 &&
    Math.abs(inputParams.tension_offset_mm) > travelHalf + 1e-9
    ? "warning"
    : "";
  const residualTone = Math.abs(derived.beltResidual) > 0.05 ? "warning" : "";
  const clearanceTone = derived.clearanceWarnings.length ? "danger" : "";

  return (
    <div id="metricsBar" className="metrics-bar" aria-label="Solved layout summary">
      <Metric label="Drive Ratio" value={`${api.formatNumber(derived.ratio, 2)}:1`} />
      <Metric label="Belt Teeth" value={teeth} tone={toothError < 1e-6 ? "" : "warning"} />
      <Metric
        label="Neutral Y"
        value={
          solveState.solvedIdlerYNominal === null
            ? "unsolved"
            : `${api.formatNumber(solveState.solvedIdlerYNominal, 2)} mm`
        }
        tone={solveState.solvedIdlerYNominal === null ? "danger" : "primary"}
      />
      <Metric
        label="Offset"
        value={`${inputParams.tension_offset_mm >= 0 ? "+" : ""}${api.formatNumber(inputParams.tension_offset_mm, 1)} mm`}
        tone={offsetTone}
      />
      <Metric
        label="Residual"
        value={`${derived.beltResidual >= 0 ? "+" : ""}${api.formatNumber(derived.beltResidual, 3)} mm`}
        tone={residualTone}
      />
      <Metric
        label="Clearance"
        value={derived.clearanceWarnings.length ? `${derived.clearanceWarnings.length} warning` : "OK"}
        tone={clearanceTone}
      />
      {(!solution.valid || solveState.layoutError !== null) && (
        <Metric label="Layout" value="invalid" tone="danger" />
      )}
    </div>
  );
}

function LayoutSvg({ inputParams, modelParams, solution, derived, solveState }) {
  const svgRef = useRef(null);

  useLayoutEffect(() => {
    if (svgRef.current) {
      api.drawLayout(svgRef.current, inputParams, modelParams, solution, derived, solveState);
    }
  }, [derived, inputParams, modelParams, solution, solveState]);

  return <svg id="layoutSvg" ref={svgRef} role="img" aria-label="Belt actuator layout" />;
}

export default function BeltActuatorPage() {
  const [beltType, setBeltType] = useState("GT2");
  const [values, setValues] = useState(defaultControlValues);
  const [solveNonce, setSolveNonce] = useState(0);

  const inputParams = useMemo(() => inputParamsFromValues(values), [values]);
  const solverDependency = SOLVER_INPUT_NAMES.map((name) => inputParams[name]).join("|");
  const solveState = useMemo(
    () => solveNeutralIdlerY(inputParams),
    [solverDependency, solveNonce]
  );
  const nominalY = solveState.solvedIdlerYNominal === null
    ? inputParams.center_IO_mm / 2
    : solveState.solvedIdlerYNominal;
  const actualY = nominalY + inputParams.tension_offset_mm;
  const modelParams = useMemo(
    () => api.modelParams(inputParams, actualY),
    [actualY, inputParams]
  );
  const solution = useMemo(() => api.beltSolution(modelParams), [modelParams]);
  const derived = useMemo(
    () => api.derived(inputParams, modelParams, solution, solveState.solvedIdlerYNominal),
    [inputParams, modelParams, solution, solveState.solvedIdlerYNominal]
  );
  const canExport = solveState.solvedIdlerYNominal !== null;
  const pitchLocked = beltType !== api.CUSTOM_BELT_TYPE;
  const diagnosticsText = useMemo(
    () => api.diagnosticsText(inputParams, beltType, solveState, modelParams, solution, derived),
    [beltType, derived, inputParams, modelParams, solution, solveState]
  );

  const handleValueChange = useCallback((name, nextValue) => {
    setValues((current) => ({ ...current, [name]: nextValue }));
  }, []);

  const handleBeltTypeChange = useCallback((event) => {
    const nextBeltType = event.target.value;
    setBeltType(nextBeltType);
    if (nextBeltType !== api.CUSTOM_BELT_TYPE) {
      setValues((current) => ({
        ...current,
        belt_pitch_mm: String(api.BELT_PITCH_PRESETS[nextBeltType])
      }));
    }
  }, []);

  const handleReset = useCallback(() => {
    setBeltType("GT2");
    setValues(defaultControlValues());
    setSolveNonce((current) => current + 1);
  }, []);

  const handleExport = useCallback(() => {
    if (!canExport) {
      return;
    }
    const rows = [["Name", "Unit", "Expression", "Value", "Comments", "Favorite"]].concat(
      api.fusionRows(inputParams, beltType, solveState.solvedIdlerYNominal)
    );
    const blob = new Blob([api.rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "belt_actuator_fusion_parameters.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [beltType, canExport, inputParams, solveState.solvedIdlerYNominal]);

  const handleOpenCustomizer = useCallback(() => {
    const url = new URL(window.location.href);
    url.hash = customizer.buildCustomizerHash({
      beltType,
      beltPitch: inputParams.belt_pitch_mm,
      inputTeeth: inputParams.pulleyI_teeth,
      outputTeeth: inputParams.pulleyO_teeth,
      model: "input-pulley"
    });
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }, [beltType, inputParams]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Belt Actuator Solver</h1>
          <p>Symmetric four-wheel NEMA17 belt layout</p>
        </div>
        <nav className="topbar-nav" aria-label="Page navigation">
          <a href="#/dashboard">Dashboard</a>
          <a href="#/traction-wheel">O-ring Wheels</a>
        </nav>
        <output
          id="status"
          className={canExport ? "status" : "status danger"}
          aria-live="polite"
        >
          {solveState.lastSolveMessage}
        </output>
      </header>

      <section className="workspace" aria-label="Belt actuator layout solver">
        <aside className="control-pane" aria-label="Input parameters">
          <div className="toolbar solver-toolbar" aria-label="Actions">
            <button
              id="solveButton"
              type="button"
              title="Re-run solver using current inputs"
              onClick={() => setSolveNonce((current) => current + 1)}
            >
              Re-run
            </button>
            <button
              id="exportButton"
              type="button"
              title={
                canExport
                  ? "Export Fusion 360 Parameter I/O CSV"
                  : "CSV export disabled until the solver finds a neutral idler Y"
              }
              disabled={!canExport}
              onClick={handleExport}
            >
              Export CSV
            </button>
            <button
              id="customizerButton"
              type="button"
              title="Open pulley OpenSCAD customizer in a new tab"
              onClick={handleOpenCustomizer}
            >
              Get 3D files
            </button>
            <button
              id="resetButton"
              type="button"
              title="Reset to the default GT2 example"
              onClick={handleReset}
            >
              Reset
            </button>
          </div>

          <section className="panel">
            <h2>Belt and Drive</h2>
            <label className="field compact" htmlFor="beltType">
              <span>Belt profile</span>
              <select id="beltType" name="beltType" value={beltType} onChange={handleBeltTypeChange}>
                {BELT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <ControlGroup
              groupId="driveControls"
              values={values}
              pitchLocked={pitchLocked}
              onValueChange={handleValueChange}
            />
          </section>

          <section className="panel">
            <h2>Layout and Tension</h2>
            <ControlGroup
              groupId="layoutControls"
              values={values}
              pitchLocked={pitchLocked}
              onValueChange={handleValueChange}
            />
          </section>

          <section className="panel diagnostics-panel">
            <h2>Diagnostics</h2>
            <pre id="diagnostics" className="diagnostics" aria-live="polite">
              {diagnosticsText}
            </pre>
          </section>
        </aside>

        <section className="plot-pane" aria-label="Belt layout preview">
          <MetricsBar
            inputParams={inputParams}
            solveState={solveState}
            solution={solution}
            derived={derived}
          />
          <LayoutSvg
            inputParams={inputParams}
            modelParams={modelParams}
            solution={solution}
            derived={derived}
            solveState={solveState}
          />
        </section>
      </section>
    </main>
  );
}
