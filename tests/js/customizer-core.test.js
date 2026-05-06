const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const customizer = require("../../public/customizer-core.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "public", "models", "pulleys", "manifest.json"), "utf8")
);

test("hash routes parse to the expected pages", () => {
  assert.equal(customizer.parseRoute("").name, customizer.ROUTES.dashboard);
  assert.equal(customizer.parseRoute("#/dashboard").name, customizer.ROUTES.dashboard);
  assert.equal(customizer.parseRoute("#/belt-actuator").name, customizer.ROUTES.beltActuator);
  assert.equal(customizer.parseRoute("#/traction-wheel").name, customizer.ROUTES.tractionWheel);

  const route = customizer.parseRoute("#/customizer/pulleys?model=output-pulley");
  assert.equal(route.name, customizer.ROUTES.pulleyCustomizer);
  assert.equal(route.query.get("model"), "output-pulley");
});

test("customizer URL serialization preserves solver values", () => {
  const hash = customizer.buildCustomizerHash({
    beltType: "HTD-5M",
    beltPitch: 5,
    inputTeeth: 18.2,
    outputTeeth: 72.1,
    model: "output-pulley"
  });

  assert.equal(
    hash,
    "#/customizer/pulleys?model=output-pulley&beltType=HTD-5M&beltPitch=5&inputTeeth=18&outputTeeth=72"
  );
});

test("belt profiles map to OpenSCAD pulley generator types", () => {
  assert.equal(customizer.beltProfileToScadType("MXL"), "MXL");
  assert.equal(customizer.beltProfileToScadType("GT2"), "GT2_2mm");
  assert.equal(customizer.beltProfileToScadType("GT3"), "GT2_3mm");
  assert.equal(customizer.beltProfileToScadType("HTD-3M"), "HTD_3mm");
  assert.equal(customizer.beltProfileToScadType("HTD-5M"), "HTD_5mm");
  assert.equal(customizer.beltProfileToScadType("Custom"), "GT2_2mm");
});

test("pulley manifest validates and seeds input/output presets from query params", () => {
  assert.equal(customizer.validateManifest(manifest), true);

  const query = new URLSearchParams({
    beltType: "GT2",
    beltPitch: "2",
    inputTeeth: "20",
    outputTeeth: "60"
  });
  const inputValues = customizer.initialValuesForModel(manifest, "input-pulley", query);
  const outputValues = customizer.initialValuesForModel(manifest, "output-pulley", query);

  assert.equal(inputValues.Type, "GT2_2mm");
  assert.equal(inputValues.Pitch, 2);
  assert.equal(inputValues.Teeth, 20);
  assert.equal(outputValues.Teeth, 60);
});

test("SCAD assignment replacement formats numbers, booleans, vectors, and strings", () => {
  const source = [
    'Type = "XL"; // profile',
    "Teeth = 16;",
    "Hub = false;",
    "Keyway_Size = [0, 0];",
    'Color = "#e0e0e0"; // color'
  ].join("\n");
  const controls = [
    { name: "Type", type: "select" },
    { name: "Teeth", type: "number" },
    { name: "Hub", type: "boolean" },
    { name: "Keyway_Size", type: "vector" },
    { name: "Color", type: "color" }
  ];

  const nextSource = customizer.replaceScadAssignments(source, {
    Type: "GT2_2mm",
    Teeth: "20",
    Hub: true,
    Keyway_Size: "[2, 1]",
    Color: "#d9ded8"
  }, controls);

  assert.match(nextSource, /Type = "GT2_2mm"; \/\/ profile/);
  assert.match(nextSource, /Teeth = 20;/);
  assert.match(nextSource, /Hub = true;/);
  assert.match(nextSource, /Keyway_Size = \[2, 1\];/);
  assert.match(nextSource, /Color = "#d9ded8"; \/\/ color/);
});
