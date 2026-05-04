(function (global) {
  "use strict";

  const ROUTES = {
    dashboard: "dashboard",
    beltActuator: "belt-actuator",
    pulleyCustomizer: "pulley-customizer"
  };

  const BELT_TYPE_TO_SCAD_TYPE = {
    MXL: "MXL",
    GT2: "GT2_2mm",
    GT3: "GT2_3mm",
    "HTD-3M": "HTD_3mm",
    "HTD-5M": "HTD_5mm"
  };

  function parseRoute(hash) {
    const clean = String(hash || "").replace(/^#/, "") || "/dashboard";
    const [pathPart, queryString = ""] = clean.split("?");
    const path = pathPart.replace(/\/+$/, "") || "/dashboard";
    const query = new URLSearchParams(queryString);

    if (path === "/belt-actuator") {
      return { name: ROUTES.beltActuator, path, query };
    }

    if (path === "/customizer/pulleys") {
      return { name: ROUTES.pulleyCustomizer, path, query };
    }

    return { name: ROUTES.dashboard, path: "/dashboard", query: new URLSearchParams() };
  }

  function beltProfileToScadType(beltType) {
    return BELT_TYPE_TO_SCAD_TYPE[beltType] || "GT2_2mm";
  }

  function buildCustomizerHash(params) {
    const query = new URLSearchParams();
    query.set("model", params.model || "input-pulley");
    query.set("beltType", params.beltType || "GT2");
    query.set("beltPitch", String(params.beltPitch ?? 2));
    query.set("inputTeeth", String(Math.round(Number(params.inputTeeth ?? 20))));
    query.set("outputTeeth", String(Math.round(Number(params.outputTeeth ?? 60))));
    return `#/customizer/pulleys?${query.toString()}`;
  }

  function controlMap(manifest) {
    return new Map((manifest.controls || []).map((control) => [control.name, control]));
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Pulley manifest must be an object.");
    }
    if (typeof manifest.source !== "string" || !manifest.source.endsWith(".scad")) {
      throw new Error("Pulley manifest requires a .scad source.");
    }
    if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
      throw new Error("Pulley manifest requires at least one model preset.");
    }
    if (!Array.isArray(manifest.controls) || manifest.controls.length === 0) {
      throw new Error("Pulley manifest requires controls.");
    }

    manifest.models.forEach((model) => {
      if (!model.id || !model.name) {
        throw new Error("Each pulley model requires id and name.");
      }
    });

    manifest.controls.forEach((control) => {
      if (!control.name || !control.label || !control.type) {
        throw new Error("Each pulley control requires name, label, and type.");
      }
    });

    return true;
  }

  function modelById(manifest, modelId) {
    return (
      (manifest.models || []).find((model) => model.id === modelId) ||
      (manifest.models || [])[0]
    );
  }

  function defaultValueForControl(control) {
    if (Object.prototype.hasOwnProperty.call(control, "default")) {
      return control.default;
    }
    if (control.type === "boolean") {
      return false;
    }
    if (control.type === "number") {
      return control.min ?? 0;
    }
    if (control.type === "select") {
      return (control.options || [])[0]?.value || "";
    }
    return "";
  }

  function initialValuesForModel(manifest, modelId, queryParams) {
    validateManifest(manifest);
    const selectedModel = modelById(manifest, modelId);
    const query = queryParams instanceof URLSearchParams
      ? queryParams
      : new URLSearchParams(queryParams || "");
    const values = {};

    manifest.controls.forEach((control) => {
      values[control.name] = defaultValueForControl(control);
    });

    Object.assign(values, selectedModel.defaults || {});

    if (query.has("beltType")) {
      values.Type = beltProfileToScadType(query.get("beltType"));
    }
    if (query.has("beltPitch")) {
      values.Pitch = Number(query.get("beltPitch"));
    }
    if (selectedModel.queryTeethParam && query.has(selectedModel.queryTeethParam)) {
      values.Teeth = Number(query.get(selectedModel.queryTeethParam));
    }

    return values;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatScadValue(value, control) {
    if (control?.type === "boolean" || typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (control?.type === "number" || typeof value === "number") {
      const number = Number(value);
      return Number.isFinite(number) ? String(number) : "0";
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => formatScadValue(item, { type: "number" })).join(", ")}]`;
    }

    const text = String(value);
    if (control?.type === "vector" && /^\s*\[[\s\S]*\]\s*$/.test(text)) {
      return text;
    }
    return JSON.stringify(text);
  }

  function replaceScadAssignments(source, values, controls) {
    const byName = new Map((controls || []).map((control) => [control.name, control]));
    let nextSource = String(source);

    Object.entries(values || {}).forEach(([name, value]) => {
      const pattern = new RegExp(
        `^(\\s*${escapeRegExp(name)}\\s*=\\s*)([^;]*)(;.*)$`,
        "m"
      );
      const control = byName.get(name);
      nextSource = nextSource.replace(pattern, (_, prefix, _oldValue, suffix) => (
        `${prefix}${formatScadValue(value, control)}${suffix}`
      ));
    });

    return nextSource;
  }

  const api = {
    ROUTES,
    BELT_TYPE_TO_SCAD_TYPE,
    parseRoute,
    beltProfileToScadType,
    buildCustomizerHash,
    validateManifest,
    modelById,
    initialValuesForModel,
    replaceScadAssignments,
    formatScadValue
  };

  global.BeltCustomizer = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
