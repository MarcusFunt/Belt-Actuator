const assert = require("node:assert/strict");
const test = require("node:test");

require("../../web/app.js");

const api = globalThis.BeltActuator;

const defaultParams = { ...api.DEFAULTS };
const gt3Variant = {
  ...api.DEFAULTS,
  belt_pitch_mm: 3.0,
  belt_length_mm: 373.0,
  pulleyI_teeth: 18,
  pulleyO_teeth: 72,
  idler_OD_mm: 24.0,
  center_IO_mm: 115.0,
  idler_x_offset_mm: 32.0
};

const straySpanFixture = {
  beltPitch: 5.0,
  beltLength: 596.2772811633768,
  pulleyITeeth: 66,
  pulleyOTeeth: 81,
  idlerOD: 48.79071618424381,
  beltBackToPitch: 0.0,
  motorY: 95.00006317942966,
  idlerX: 96.52267216524247,
  idlerY: 19.171666193473275
};

function solveInputParams(inputParams) {
  const baseModel = api.modelParams(inputParams, 0.0);
  const result = api.solveIdlerY(baseModel);
  assert.notEqual(result.y, null, result.message);
  const model = api.modelParams(inputParams, result.y + inputParams.tension_offset_mm);
  const solution = api.beltSolution(model);
  const derived = api.derived(inputParams, model, solution, result.y);
  return { result, model, solution, derived };
}

test("default solver fixture matches the Python reference values", () => {
  const { result, solution, derived } = solveInputParams(defaultParams);

  assert.equal(result.message, "OK");
  assert.equal(result.candidates.length, 1);
  assert.equal(solution.valid, true);
  assert.ok(Math.abs(result.y - 29.26314942270517) < 1e-9);
  assert.ok(Math.abs(solution.length - 264.0) < 1e-6);
  assert.ok(Math.abs(solution.lineLength - 160.52169094968426) < 1e-6);
  assert.ok(Math.abs(solution.arcLength - 103.47830904957603) < 1e-6);
  assert.ok(Math.abs(derived.beltResidual) < 1e-6);
});

test("alternate GT3-style fixture solves and preserves belt length", () => {
  const { result, solution, derived } = solveInputParams(gt3Variant);

  assert.equal(result.message, "OK");
  assert.equal(solution.valid, true);
  assert.ok(Math.abs(result.y - 38.2216779232025) < 1e-9);
  assert.ok(Math.abs(solution.length - gt3Variant.belt_length_mm) < 1e-6);
  assert.ok(Math.abs(derived.beltResidual) < 1e-6);
});

test("solver rejects tangent spans that hit non-contact circles", () => {
  const solution = api.beltSolution(straySpanFixture);

  assert.equal(solution.valid, false);
  assert.match(solution.reason, /unintended pulley\/idler contact/);
});

test("idler X solver recovers the default half-spacing", () => {
  const { result } = solveInputParams(defaultParams);
  const solvedX = api.solveIdlerX(api.modelParams(defaultParams, result.y));

  assert.equal(solvedX.message, "OK");
  assert.ok(Math.abs(solvedX.x - defaultParams.idler_x_offset_mm) < 1e-6);
});

test("invalid belt lengths return bounded errors instead of invalid geometry", () => {
  const tooShort = api.solveIdlerY(api.modelParams({ ...defaultParams, belt_length_mm: 100.0 }, 0.0));
  const tooLong = api.solveIdlerY(api.modelParams({ ...defaultParams, belt_length_mm: 1000.0 }, 0.0));

  assert.equal(tooShort.y, null);
  assert.equal(tooShort.candidates.length, 0);
  assert.match(tooShort.message, /Selected belt is too short/);
  assert.match(tooShort.message, /Shortest valid path found/);

  assert.equal(tooLong.y, null);
  assert.equal(tooLong.candidates.length, 0);
  assert.match(tooLong.message, /Selected belt is too long/);
  assert.match(tooLong.message, /Longest valid path found/);
});

test("derived metrics flag non-integer belts, clearance, and tension offset drift", () => {
  const inputParams = {
    ...defaultParams,
    belt_length_mm: 264.5,
    minimum_clearance_mm: 20.0,
    tension_offset_mm: 10.0
  };
  const baseModel = api.modelParams(inputParams, 0.0);
  const result = api.solveIdlerY(baseModel);
  assert.notEqual(result.y, null, result.message);

  const model = api.modelParams(inputParams, result.y + inputParams.tension_offset_mm);
  const solution = api.beltSolution(model);
  const derived = api.derived(inputParams, model, solution, result.y);

  assert.ok(Math.abs(derived.beltTeethError) > 1e-6);
  assert.ok(derived.clearanceWarnings.length > 0);
  assert.ok(Array.isArray(derived.clearanceWarnings[0].names));
  assert.equal(typeof derived.clearanceWarnings[0].text, "string");
  assert.ok(Math.abs(derived.beltResidual) > 0.05);
});

test("Fusion CSV rows stay stable and escape CSV-sensitive values", () => {
  const { result } = solveInputParams(defaultParams);
  const rows = api.fusionRows(defaultParams, "GT2", result.y);
  const csv = api.rowsToCsv([
    ["Name", "Unit", "Expression", "Comment"],
    ...rows,
    ["needs_escape", "No Units", "1", "comma, quote \" and newline\nhere"]
  ]);

  assert.equal(rows.length, 44);
  assert.equal(rows[0][0], "belt_profile_code");
  assert.ok(rows.some((row) => row[0] === "belt_back_to_pitch_mm"));
  assert.match(rows.find((row) => row[0] === "output_shaft_dia_mm")[3], /PLACEHOLDER - verify for your build/);
  assert.match(rows.find((row) => row[0] === "motor_mount_hole_spacing_mm")[3], /PLACEHOLDER - verify for your build/);
  assert.ok(csv.startsWith("Name,Unit,Expression,Comment\r\n"));
  assert.ok(csv.includes("belt_pitch_mm,mm"));
  assert.ok(csv.includes("\"comma, quote \"\" and newline\nhere\""));
});

test("Fusion CSV export rejects an unsolved nominal idler Y", () => {
  assert.throws(
    () => api.fusionRows(defaultParams, "GT2", null),
    /Cannot export Fusion CSV before the solver finds a neutral idler Y/
  );
});
