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

const mxlFusionDemo = {
  ...api.DEFAULTS,
  belt_pitch_mm: 2.032,
  belt_length_mm: 237.744,
  pulleyI_teeth: 20,
  pulleyO_teeth: 75,
  idler_OD_mm: 15.0,
  belt_back_to_pitch_mm: 0.0,
  center_IO_mm: 67.5,
  idler_x_offset_mm: 15.0,
  tension_slot_travel_mm: 6.0,
  tension_offset_mm: 0.0,
  belt_visual_thickness_mm: 1.5,
  minimum_clearance_mm: 1.5
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

test("MXL belt preset uses the 0.080 inch metric pitch", () => {
  assert.equal(api.BELT_PITCH_PRESETS.MXL, 2.032);
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
    ["Name", "Unit", "Expression", "Value", "Comments", "Favorite"],
    ...rows,
    ["needs_escape", "", "1", "1", "comma, quote \" and newline\nhere", "false"]
  ]);

  assert.equal(rows.length, 45);
  assert.equal(rows.every((row) => row.length === 6), true);
  assert.equal(rows[0][0], "belt_profile_code");
  assert.equal(rows[0][1], "");
  assert.equal(api.fusionRows(defaultParams, "MXL", result.y)[0][2], "5");
  assert.equal(rows[0][5], "false");
  assert.equal(rows.every((row) => row[3] !== ""), true);
  assert.ok(rows.some((row) => row[0] === "belt_teeth"));
  assert.ok(rows.every((row) => row[0] !== "belt_teeth_exact"));
  assert.ok(rows.some((row) => row[0] === "belt_back_to_pitch_mm"));
  assert.ok(rows.some((row) => row[0] === "idler_pitch_r_mm"));
  assert.equal(rows.find((row) => row[0] === "belt_length_mm")[2], "belt_teeth*belt_pitch_mm");
  assert.equal(rows.find((row) => row[0] === "center_I_idler_mm")[2], "sqrt(idler_x_offset_mm^2+(input_y_mm-idler_y_mm)^2)");
  assert.match(rows.find((row) => row[0] === "output_shaft_dia_mm")[4], /placeholder/);
  assert.match(rows.find((row) => row[0] === "motor_mount_hole_spacing_mm")[4], /placeholder/);
  assert.ok(csv.startsWith("Name,Unit,Expression,Value,Comments,Favorite\r\n"));
  assert.ok(csv.includes("belt_pitch_mm,mm"));
  assert.ok(csv.includes("\"comma, quote \"\" and newline\nhere\""));
});

test("Fusion CSV matches the known-good Parameter I/O demo format", () => {
  const { result } = solveInputParams(mxlFusionDemo);
  const csv = api.rowsToCsv([
    ["Name", "Unit", "Expression", "Value", "Comments", "Favorite"],
    ...api.fusionRows(mxlFusionDemo, "MXL", result.y)
  ]);

  const expected = [
    "Name,Unit,Expression,Value,Comments,Favorite",
    "belt_profile_code,,5,5,MXL profile code,false",
    "belt_pitch_mm,mm,2.0320 mm,2.032,MXL belt pitch,false",
    "belt_teeth,,117,117,Closed belt tooth count,true",
    "belt_length_mm,mm,belt_teeth*belt_pitch_mm,237.744,Closed belt pitch length,true",
    "pulleyI_teeth,,20,20,Input pulley teeth,true",
    "pulleyO_teeth,,75,75,Output pulley teeth,true",
    "ratio,,pulleyO_teeth/pulleyI_teeth,3.75,Reduction ratio,true",
    "pulleyI_pitch_dia_mm,mm,pulleyI_teeth*belt_pitch_mm/PI,12.936,Input pulley pitch diameter,false",
    "pulleyO_pitch_dia_mm,mm,pulleyO_teeth*belt_pitch_mm/PI,48.51,Output pulley pitch diameter,false",
    "pulleyI_pitch_r_mm,mm,pulleyI_pitch_dia_mm/2,6.468,Input pulley pitch radius,false",
    "pulleyO_pitch_r_mm,mm,pulleyO_pitch_dia_mm/2,24.255,Output pulley pitch radius,false",
    "idler_OD_mm,mm,15.0000 mm,15.00,Smooth idler outside diameter,true",
    "idler_r_mm,mm,idler_OD_mm/2,7.5,Smooth idler radius,false",
    "belt_back_to_pitch_mm,mm,0.0000 mm,0.00,Backside idler pitch offset,false",
    "idler_pitch_r_mm,mm,idler_r_mm+belt_back_to_pitch_mm,7.5,Effective idler pitch radius,false",
    "center_IO_mm,mm,67.5000 mm,67.5,Input to output center distance,true",
    "idler_x_offset_mm,mm,15.0000 mm,15.00,Horizontal idler half spacing,true",
    "tension_slot_travel_mm,mm,6.0000 mm,6.00,Total tension slot travel,true",
    "tension_offset_mm,mm,0.0000 mm,0.00,Current tension displacement,true",
    "belt_visual_thickness_mm,mm,1.5000 mm,1.5,Visual belt thickness only,false",
    "minimum_clearance_mm,mm,1.5000 mm,1.5,2D clearance warning limit,false",
    "output_x_mm,mm,0 mm,0.00,Output center X,false",
    "output_y_mm,mm,0 mm,0.00,Output center Y,false",
    "input_x_mm,mm,0 mm,0.00,Input center X,false",
    "input_y_mm,mm,center_IO_mm,67.5,Input center Y,false",
    "idler_y_nominal_mm,mm,47.9152 mm,47.915,Solved idler Y neutral,true",
    "idler_y_mm,mm,idler_y_nominal_mm+tension_offset_mm,47.915,Current idler Y,false",
    "idler1_x_mm,mm,-idler_x_offset_mm,-15.00,Left idler X,false",
    "idler1_y_mm,mm,idler_y_mm,47.915,Left idler Y,false",
    "idler2_x_mm,mm,idler_x_offset_mm,15.00,Right idler X,false",
    "idler2_y_mm,mm,idler_y_mm,47.915,Right idler Y,false",
    "center_I_idler_mm,mm,sqrt(idler_x_offset_mm^2+(input_y_mm-idler_y_mm)^2),24.669,Input to idler distance,false",
    "center_O_idler_mm,mm,sqrt(idler_x_offset_mm^2+(idler_y_mm-output_y_mm)^2),50.208,Output to idler distance,false",
    "idler_span_mm,mm,2*idler_x_offset_mm,30.00,Distance between idler centers,false",
    "motor_mount_hole_spacing_mm,mm,31 mm,31.00,NEMA17 hole spacing placeholder,true",
    "motor_screw_clearance_dia_mm,mm,3.4 mm,3.4,M3 screw clearance placeholder,false",
    "motor_pilot_clearance_dia_mm,mm,23 mm,23.00,NEMA17 pilot clearance placeholder,false",
    "output_shaft_dia_mm,mm,8 mm,8.00,Output shaft diameter placeholder,true",
    "output_bearing_OD_mm,mm,16 mm,16.00,Output bearing OD placeholder,true",
    "output_bearing_width_mm,mm,5 mm,5.00,Output bearing width placeholder,false",
    "idler_bolt_dia_mm,mm,5 mm,5.00,Idler bolt diameter placeholder,true",
    "idler_bolt_clearance_dia_mm,mm,idler_bolt_dia_mm+0.4 mm,5.4,Idler bolt clearance hole,false",
    "slot_length_mm,mm,tension_slot_travel_mm+idler_bolt_dia_mm,11.00,Idler tension slot length,false",
    "slot_width_mm,mm,idler_bolt_clearance_dia_mm,5.4,Idler tension slot width,false",
    "wall_thickness_mm,mm,3 mm,3.00,General wall thickness,true"
  ].join("\r\n") + "\r\n";

  assert.equal(csv, expected);
});

test("Fusion CSV export rejects an unsolved nominal idler Y", () => {
  assert.throws(
    () => api.fusionRows(defaultParams, "GT2", null),
    /Cannot export Fusion CSV before the solver finds a neutral idler Y/
  );
});
