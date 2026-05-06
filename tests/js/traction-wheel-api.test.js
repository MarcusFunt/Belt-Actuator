const assert = require("node:assert/strict");
const test = require("node:test");

const api = require("../../public/traction-wheel.js");

test("default o-ring wheel calculation conserves installed volume", () => {
  const result = api.calculate(api.DEFAULTS);

  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.metrics.volumeError) < 1e-9);
  assert.ok(Math.abs(result.metrics.freeVolumeError) < 1e-9);
  assert.ok(result.metrics.finalWheelOd > result.input.wheel_groove_diameter_mm);
  assert.ok(result.metrics.treadProtrusion > 0);
});

test("target stretch mode derives the wheel groove diameter", () => {
  const result = api.calculate({
    ...api.DEFAULTS,
    mode: api.MODE_TARGET_STRETCH,
    oring_id_mm: 50,
    target_stretch_percent: 5
  });

  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.input.wheel_groove_diameter_mm - 52.5) < 1e-12);
  assert.ok(Math.abs(result.metrics.innerStretchPercent - 5) < 1e-12);
});

test("groove width changes installed tire height while preserving volume", () => {
  const narrow = api.calculate({ ...api.DEFAULTS, groove_width_mm: 2.4 });
  const wide = api.calculate({ ...api.DEFAULTS, groove_width_mm: 4.4 });

  assert.equal(narrow.valid, true);
  assert.equal(wide.valid, true);
  assert.ok(narrow.metrics.installedHeight > wide.metrics.installedHeight);
  assert.ok(Math.abs(narrow.metrics.volumeError) < 1e-9);
  assert.ok(Math.abs(wide.metrics.volumeError) < 1e-9);
});

test("invalid dimensions are rejected before solving", () => {
  const result = api.calculate({ ...api.DEFAULTS, groove_width_mm: 0 });

  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /Groove width/);
  assert.match(api.diagnosticsText(result), /Invalid inputs/);
});
