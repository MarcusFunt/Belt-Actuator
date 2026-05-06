import React, { useCallback, useMemo, useState } from "react";

const api = window.TractionWheel;

if (!api) {
  throw new Error("TractionWheel API script did not load.");
}

const O_RING_FIELDS = [
  ["oring_id_mm", "Inside diameter", "mm", 5, 160, 0.1],
  ["oring_cs_mm", "Cross-section", "mm", 1, 12, 0.1]
];

const WHEEL_DIAMETER_FIELDS = [
  ["wheel_groove_diameter_mm", "Groove floor diameter", "mm", 6, 180, 0.1]
];

const TARGET_STRETCH_FIELDS = [
  ["target_stretch_percent", "Target inside stretch", "%", -5, 16, 0.1]
];

const GROOVE_FIELDS = [
  ["groove_width_mm", "Groove width", "mm", 0.8, 18, 0.1],
  ["groove_depth_mm", "Groove depth", "mm", 0.2, 8, 0.1]
];

function defaultValues() {
  return Object.fromEntries(
    Object.entries(api.DEFAULTS).map(([name, value]) => [name, String(value)])
  );
}

function valuesToInput(values) {
  return Object.fromEntries(
    Object.entries(api.DEFAULTS).map(([name, fallback]) => {
      if (name === "mode") {
        return [name, values.mode || fallback];
      }
      const parsed = Number.parseFloat(values[name]);
      return [name, Number.isFinite(parsed) ? parsed : fallback];
    })
  );
}

function rangeProgress(value, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || max <= min) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((parsed - min) / (max - min)) * 100));
}

function CalculatorField({ spec, value, onValueChange }) {
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
        onChange={(event) => onValueChange(name, event.target.value)}
      />
      <span className="unit">{unit}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={rangeValue}
        aria-label={label}
        style={{ "--range-progress": `${progress}%` }}
        onChange={(event) => onValueChange(name, event.target.value)}
      />
    </label>
  );
}

function FieldGroup({ fields, values, onValueChange }) {
  return (
    <div className="control-list">
      {fields.map((spec) => (
        <CalculatorField
          key={spec[0]}
          spec={spec}
          value={values[spec[0]]}
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

function metricsTone(result, metric) {
  if (!result.valid) {
    return "danger";
  }
  if (metric === "stretch" && result.metrics.innerStretchPercent > 8) {
    return "warning";
  }
  if (metric === "protrusion" && result.metrics.treadProtrusion <= 0) {
    return "danger";
  }
  if (metric === "protrusion" && result.metrics.treadProtrusion < 0.25) {
    return "warning";
  }
  return "";
}

function WheelMetrics({ result }) {
  if (!result.valid) {
    return (
      <div className="metrics-bar" aria-label="Wheel calculator summary">
        <Metric label="Inputs" value="invalid" tone="danger" />
      </div>
    );
  }

  const m = result.metrics;
  return (
    <div className="metrics-bar" aria-label="Wheel calculator summary">
      <Metric label="Final OD" value={`${api.formatNumber(m.finalWheelOd, 2)} mm`} tone="primary" />
      <Metric
        label="Inside Stretch"
        value={`${api.formatNumber(m.innerStretchPercent, 2)}%`}
        tone={metricsTone(result, "stretch")}
      />
      <Metric label="Tire Height" value={`${api.formatNumber(m.installedHeight, 3)} mm`} />
      <Metric
        label="Protrusion"
        value={`${api.formatNumber(m.treadProtrusion, 3)} mm`}
        tone={metricsTone(result, "protrusion")}
      />
      <Metric label="Area Ratio" value={`${api.formatNumber(m.areaRatioPercent, 1)}%`} />
      <Metric label="Volume Error" value={`${api.formatNumber(m.volumeError, 5)} mm^3`} />
    </div>
  );
}

function ResultItem({ label, value }) {
  return (
    <div className="result-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultList({ result }) {
  if (!result.valid) {
    return null;
  }

  const m = result.metrics;
  const input = result.input;
  return (
    <div id="tractionResults" className="result-list" aria-label="Calculated wheel dimensions">
      <ResultItem label="Groove floor diameter" value={`${api.formatNumber(input.wheel_groove_diameter_mm, 3)} mm`} />
      <ResultItem label="Groove rim OD" value={`${api.formatNumber(m.rimOd, 3)} mm`} />
      <ResultItem label="Final wheel OD" value={`${api.formatNumber(m.finalWheelOd, 3)} mm`} />
      <ResultItem label="Installed radial tire height" value={`${api.formatNumber(m.installedHeight, 3)} mm`} />
      <ResultItem label="Tread above rim" value={`${api.formatNumber(m.treadProtrusion, 3)} mm`} />
      <ResultItem label="Equivalent round section" value={`${api.formatNumber(m.equivalentSectionDiameter, 3)} mm`} />
      <ResultItem label="Free round section after stretch" value={`${api.formatNumber(m.freeSectionDiameter, 3)} mm`} />
      <ResultItem label="Groove fill at rim" value={`${api.formatNumber(m.grooveFillPercent, 1)}%`} />
    </div>
  );
}

function TractionWheelSvg({ result }) {
  if (!result.valid) {
    return (
      <svg
        id="tractionWheelSvg"
        className="traction-svg"
        viewBox="0 0 360 220"
        role="img"
        aria-label="O-ring wheel cross-section"
      >
        <text x="180" y="110" textAnchor="middle" className="traction-svg-label">Invalid inputs</text>
      </svg>
    );
  }

  const m = result.metrics;
  const input = result.input;
  const maxRadial = Math.max(m.installedHeight, input.groove_depth_mm, m.freeSectionDiameter, 0.1);
  const widthScale = Math.min(128, Math.max(44, input.groove_width_mm / Math.max(m.freeSectionDiameter, 0.1) * 74));
  const radialScale = 78 / maxRadial;
  const grooveDepthPx = input.groove_depth_mm * radialScale;
  const tireHeightPx = m.installedHeight * radialScale;
  const sectionHalfWidth = widthScale / 2;
  const tireTop = 132 - tireHeightPx;
  const grooveTop = 132 - grooveDepthPx;

  return (
    <svg
      id="tractionWheelSvg"
      className="traction-svg"
      viewBox="0 0 360 220"
      role="img"
      aria-label="O-ring wheel cross-section"
    >
      <rect x="42" y={grooveTop} width="276" height={174 - grooveTop} className="svg-wheel-body" />
      <rect x={180 - sectionHalfWidth} y={grooveTop} width={widthScale} height={132 - grooveTop} className="svg-groove" />
      <line x1="42" y1="132" x2="318" y2="132" className="svg-reference-line" />
      <ellipse
        cx="180"
        cy={(tireTop + 132) / 2}
        rx={sectionHalfWidth}
        ry={Math.max(5, tireHeightPx / 2)}
        className="svg-oring"
      />
      <line x1="318" y1={tireTop} x2="336" y2={tireTop} className="svg-dimension-line" />
      <line x1="318" y1={grooveTop} x2="336" y2={grooveTop} className="svg-dimension-line" />
      <line x1="328" y1={tireTop} x2="328" y2={grooveTop} className="svg-dimension-line" />
      <text x="34" y="198" className="traction-svg-label">floor {api.formatNumber(input.wheel_groove_diameter_mm, 1)} mm</text>
      <text x="180" y="28" textAnchor="middle" className="traction-svg-title">final OD {api.formatNumber(m.finalWheelOd, 2)} mm</text>
      <text x="336" y={(tireTop + grooveTop) / 2 + 4} className="traction-svg-label">
        {api.formatNumber(m.treadProtrusion, 2)} mm
      </text>
    </svg>
  );
}

export default function TractionWheelPage() {
  const [values, setValues] = useState(defaultValues);
  const inputValues = useMemo(() => valuesToInput(values), [values]);
  const result = useMemo(() => api.calculate(inputValues), [inputValues]);
  const diagnostics = useMemo(() => api.diagnosticsText(result), [result]);
  const mode = values.mode === api.MODE_TARGET_STRETCH
    ? api.MODE_TARGET_STRETCH
    : api.MODE_WHEEL_DIAMETER;

  const handleValueChange = useCallback((name, nextValue) => {
    setValues((current) => ({ ...current, [name]: nextValue }));
  }, []);

  const handleModeChange = useCallback((event) => {
    setValues((current) => ({ ...current, mode: event.target.value }));
  }, []);

  const handleReset = useCallback(() => {
    setValues(defaultValues());
  }, []);

  const statusText = result.valid
    ? `Final wheel OD ${api.formatNumber(result.metrics.finalWheelOd, 2)} mm`
    : "Check wheel inputs";

  return (
    <main id="tractionWheelCalculator" className="app-shell traction-shell">
      <header className="topbar">
        <div>
          <h1>High-Traction O-Ring Wheels</h1>
          <p>Wheel tire sizing from o-ring stretch and conserved volume</p>
        </div>
        <nav className="topbar-nav" aria-label="Page navigation">
          <a href="#/dashboard">Dashboard</a>
          <a href="#/belt-actuator">Belt Actuator</a>
        </nav>
        <output id="tractionStatus" className={result.valid ? "status" : "status danger"} aria-live="polite">
          {statusText}
        </output>
      </header>

      <section className="traction-workspace" aria-label="O-ring wheel calculator">
        <aside className="control-pane" aria-label="Wheel calculator inputs">
          <div className="toolbar traction-toolbar" aria-label="Actions">
            <button id="tractionResetButton" type="button" onClick={handleReset}>
              Reset
            </button>
          </div>

          <section className="panel">
            <h2>O-Ring</h2>
            <FieldGroup fields={O_RING_FIELDS} values={values} onValueChange={handleValueChange} />
          </section>

          <section className="panel">
            <h2>Wheel Groove</h2>
            <label className="field compact" htmlFor="tractionMode">
              <span>Solve mode</span>
              <select id="tractionMode" value={mode} onChange={handleModeChange}>
                <option value={api.MODE_WHEEL_DIAMETER}>Known wheel diameter</option>
                <option value={api.MODE_TARGET_STRETCH}>Target stretch</option>
              </select>
            </label>
            <FieldGroup
              fields={mode === api.MODE_TARGET_STRETCH ? TARGET_STRETCH_FIELDS : WHEEL_DIAMETER_FIELDS}
              values={values}
              onValueChange={handleValueChange}
            />
            <FieldGroup fields={GROOVE_FIELDS} values={values} onValueChange={handleValueChange} />
          </section>

          <section className="panel diagnostics-panel">
            <h2>Design Checks</h2>
            <pre id="tractionDiagnostics" className="diagnostics" aria-live="polite">
              {diagnostics}
            </pre>
          </section>
        </aside>

        <section className="traction-results-pane" aria-label="O-ring wheel result">
          <WheelMetrics result={result} />
          <div className="traction-preview">
            <TractionWheelSvg result={result} />
          </div>
          <ResultList result={result} />
        </section>
      </section>
    </main>
  );
}
