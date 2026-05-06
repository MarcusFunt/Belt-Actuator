import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StlPreview from "./StlPreview.jsx";

const customizer = window.BeltCustomizer;

function assetBaseUrl() {
  return new URL("./", window.location.href).href;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function groupedControls(controls) {
  const sections = [];
  const bySection = new Map();
  controls.forEach((control) => {
    const name = control.section || "Parameters";
    if (!bySection.has(name)) {
      const group = { name, controls: [] };
      bySection.set(name, group);
      sections.push(group);
    }
    bySection.get(name).controls.push(control);
  });
  return sections;
}

function CustomizerField({ control, value, onChange }) {
  const inputId = `customizer-${control.name}`;

  if (control.type === "boolean") {
    return (
      <label className="field customizer-check" htmlFor={inputId}>
        <span>{control.label}</span>
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(control, event.target.checked)}
        />
        <span className="unit">{control.unit || ""}</span>
      </label>
    );
  }

  if (control.type === "select") {
    return (
      <label className="field compact" htmlFor={inputId}>
        <span>{control.label}</span>
        <select
          id={inputId}
          value={String(value)}
          onChange={(event) => {
            const option = (control.options || []).find((item) => (
              String(item.value) === event.target.value
            ));
            onChange(control, option ? option.value : event.target.value);
          }}
        >
          {(control.options || []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.type === "color") {
    return (
      <label className="field compact color-field" htmlFor={inputId}>
        <span>{control.label}</span>
        <input
          id={inputId}
          type="color"
          value={String(value)}
          onChange={(event) => onChange(control, event.target.value)}
        />
      </label>
    );
  }

  if (control.type === "vector") {
    return (
      <label className="field" htmlFor={inputId}>
        <span>{control.label}</span>
        <input
          id={inputId}
          type="text"
          value={String(value)}
          onChange={(event) => onChange(control, event.target.value)}
        />
        <span className="unit">{control.unit || ""}</span>
      </label>
    );
  }

  const rangeValue = Number.isFinite(Number(value)) ? Number(value) : control.default;
  const min = Number(control.min ?? 0);
  const max = Number(control.max ?? 100);
  const progress = max > min
    ? Math.min(100, Math.max(0, ((Number(rangeValue) - min) / (max - min)) * 100))
    : 0;

  return (
    <label className="field" htmlFor={inputId}>
      <span>{control.label}</span>
      <input
        id={inputId}
        type="number"
        min={control.min}
        max={control.max}
        step={control.step}
        value={String(value)}
        onChange={(event) => onChange(control, event.target.value)}
      />
      <span className="unit">{control.unit || ""}</span>
      {Number.isFinite(min) && Number.isFinite(max) && max > min && (
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={rangeValue}
          aria-label={control.label}
          style={{ "--range-progress": `${progress}%` }}
          onChange={(event) => onChange(control, event.target.value)}
        />
      )}
    </label>
  );
}

export default function CustomizerPage({ query }) {
  const [manifest, setManifest] = useState(null);
  const [source, setSource] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedModelId, setSelectedModelId] = useState(query.get("model") || "input-pulley");
  const [values, setValues] = useState({});
  const [renderStatus, setRenderStatus] = useState("idle");
  const [renderMessage, setRenderMessage] = useState("");
  const [renderLog, setRenderLog] = useState("");
  const [stlBuffer, setStlBuffer] = useState(null);
  const workerRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      try {
        const base = assetBaseUrl();
        const manifestResponse = await fetch(new URL("models/pulleys/manifest.json", base));
        if (!manifestResponse.ok) {
          throw new Error(`Could not load pulley manifest (${manifestResponse.status}).`);
        }
        const nextManifest = await manifestResponse.json();
        customizer.validateManifest(nextManifest);

        const sourceResponse = await fetch(new URL(`models/pulleys/${nextManifest.source}`, base));
        if (!sourceResponse.ok) {
          throw new Error(`Could not load ${nextManifest.source} (${sourceResponse.status}).`);
        }

        if (!cancelled) {
          setManifest(nextManifest);
          setSource(await sourceResponse.text());
          setLoadError("");
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!manifest) {
      return;
    }
    const nextModel = customizer.modelById(manifest, selectedModelId);
    if (nextModel.id !== selectedModelId) {
      setSelectedModelId(nextModel.id);
      return;
    }
    setValues(customizer.initialValuesForModel(manifest, nextModel.id, query));
    setStlBuffer(null);
    setRenderLog("");
    setRenderMessage("");
    setRenderStatus("idle");
  }, [manifest, query, selectedModelId]);

  useEffect(() => () => {
    workerRef.current?.terminate();
  }, []);

  const activeModel = useMemo(() => (
    manifest ? customizer.modelById(manifest, selectedModelId) : null
  ), [manifest, selectedModelId]);

  const generatedScad = useMemo(() => {
    if (!manifest || !source) {
      return "";
    }
    return customizer.replaceScadAssignments(source, values, manifest.controls);
  }, [manifest, source, values]);

  const sections = useMemo(() => (
    manifest ? groupedControls(manifest.controls) : []
  ), [manifest]);

  const handleControlChange = useCallback((control, nextValue) => {
    setValues((current) => ({ ...current, [control.name]: nextValue }));
    setStlBuffer(null);
    setRenderStatus("idle");
  }, []);

  const handleModelChange = useCallback((event) => {
    const nextModelId = event.target.value;
    setSelectedModelId(nextModelId);
    const url = new URL(window.location.href);
    const nextQuery = new URLSearchParams(query);
    nextQuery.set("model", nextModelId);
    url.hash = `#/customizer/pulleys?${nextQuery.toString()}`;
    window.history.replaceState(null, "", url);
  }, [query]);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./openscad-worker.js", import.meta.url), {
        type: "module"
      });
      workerRef.current.onmessage = (event) => {
        const message = event.data;
        if (message.requestId !== requestIdRef.current) {
          return;
        }
        if (message.type === "rendered") {
          setStlBuffer(message.buffer);
          setRenderLog(message.log || "");
          setRenderMessage("Rendered STL preview");
          setRenderStatus("rendered");
        } else if (message.type === "error") {
          setRenderLog(message.log || "");
          setRenderMessage(message.message || "OpenSCAD render failed.");
          setRenderStatus("error");
        }
      };
    }
    return workerRef.current;
  }, []);

  const handleRender = useCallback(() => {
    if (!generatedScad || renderStatus === "rendering") {
      return;
    }
    const worker = ensureWorker();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRenderStatus("rendering");
    setRenderMessage("Rendering STL...");
    setRenderLog("");
    worker.postMessage({
      type: "render",
      requestId,
      source: generatedScad,
      assetBaseUrl: assetBaseUrl()
    });
  }, [ensureWorker, generatedScad, renderStatus]);

  const handleDownloadScad = useCallback(() => {
    if (!generatedScad || !activeModel) {
      return;
    }
    downloadBlob(
      new Blob([generatedScad], { type: "text/plain;charset=utf-8" }),
      `${activeModel.filenamePrefix || activeModel.id}.scad`
    );
  }, [activeModel, generatedScad]);

  const handleDownloadStl = useCallback(() => {
    if (!stlBuffer || !activeModel) {
      return;
    }
    downloadBlob(
      new Blob([stlBuffer], { type: "model/stl" }),
      `${activeModel.filenamePrefix || activeModel.id}.stl`
    );
  }, [activeModel, stlBuffer]);

  return (
    <main className="app-shell customizer-shell">
      <header className="topbar">
        <div>
          <h1>OpenSCAD Customizer</h1>
          <p>Parametric pulley generator</p>
        </div>
        <nav className="topbar-nav" aria-label="Page navigation">
          <a href="#/dashboard">Dashboard</a>
          <a href="#/belt-actuator">Belt Actuator</a>
          <a href="#/traction-wheel">O-ring Wheels</a>
        </nav>
      </header>

      {loadError ? (
        <section className="dashboard-page">
          <div className="panel">
            <h2>Load error</h2>
            <pre className="diagnostics danger-text">{loadError}</pre>
          </div>
        </section>
      ) : (
        <section className="customizer-workspace" aria-label="OpenSCAD pulley customizer">
          <aside className="control-pane customizer-controls" aria-label="Pulley parameters">
            <section className="panel">
              <h2>Model</h2>
              <label className="field compact" htmlFor="pulleyModel">
                <span>Pulley preset</span>
                <select
                  id="pulleyModel"
                  value={activeModel?.id || selectedModelId}
                  onChange={handleModelChange}
                  disabled={!manifest}
                >
                  {(manifest?.models || []).map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </label>
            </section>

            {sections.map((section) => (
              <section key={section.name} className="panel">
                <h2>{section.name}</h2>
                <div className="control-list">
                  {section.controls.map((control) => (
                    <CustomizerField
                      key={control.name}
                      control={control}
                      value={values[control.name] ?? ""}
                      onChange={handleControlChange}
                    />
                  ))}
                </div>
              </section>
            ))}
          </aside>

          <section className="customizer-preview" aria-label="Pulley STL preview">
            <div className="customizer-actions" aria-label="Customizer actions">
              <button
                id="renderStlButton"
                type="button"
                onClick={handleRender}
                disabled={!generatedScad || renderStatus === "rendering"}
              >
                {renderStatus === "rendering" ? "Rendering..." : "Render STL"}
              </button>
              <button
                id="downloadScadButton"
                type="button"
                onClick={handleDownloadScad}
                disabled={!generatedScad}
              >
                Download SCAD
              </button>
              <button
                id="downloadStlButton"
                type="button"
                onClick={handleDownloadStl}
                disabled={!stlBuffer}
              >
                Download STL
              </button>
            </div>
            <StlPreview stlBuffer={stlBuffer} label="Pulley STL preview" />
            <div className={`render-status ${renderStatus === "error" ? "danger" : ""}`} role="status">
              {renderMessage || (activeModel ? activeModel.description : "Loading pulley model...")}
            </div>
            <section className="panel diagnostics-panel customizer-log-panel">
              <h2>OpenSCAD Log</h2>
              <pre id="openscadLog" className="diagnostics" aria-live="polite">
                {renderLog || "No render output yet."}
              </pre>
            </section>
          </section>
        </section>
      )}
    </main>
  );
}
