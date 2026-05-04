# Belt-Actuator

A browser-based layout tool for symmetric belt-driven NEMA17 actuators.

## Web app

The GitHub Pages version runs in the browser:

https://marcusfunt.github.io/Belt-Actuator/

The React source lives in `src/`. The checked-in GitHub Pages build is emitted
to `web/`, while the root `index.html` keeps redirecting visitors into that
static app. The app uses hash routes:

- `#/dashboard` lists project tools.
- `#/belt-actuator` opens the belt layout solver.
- `#/customizer/pulleys` opens the bundled OpenSCAD pulley customizer.

## Features

- Symmetric four-wheel layout: input pulley, output pulley, two smooth backside idlers
- Live 2D visualiser with belt path, pulley/idler circles, and dimension lines
- Solves neutral idler Y (and idler X) from a fixed belt length
- Belt profile presets: MXL, GT2, GT3, HTD-3M, HTD-5M, or custom pitch
- Clearance warnings between components
- Exports a Fusion 360 Parameter I/O compatible CSV with formula expressions
- Bundled OpenSCAD pulley customizer with STL preview and SCAD/STL downloads

## Requirements

- Python 3.9+
- Node.js 20.19+ or 22.12+ for the React build and browser tests

## Install

```bash
npm install
```

## Run Locally

Run the React development server:

```bash
npm run dev
```

Or build the GitHub Pages output and serve it as static files:

```bash
npm run build
python -m http.server 8000 -d web
```

Then open `http://localhost:8000`.

## Test

Run the Python solver tests:

```bash
python -m unittest discover -s tests/python -v
```

Run the JavaScript API and browser end-to-end tests:

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` builds the React app into `web/`, then runs the JavaScript API tests
and Chromium E2E tests. CI runs the Python solver tests, JavaScript API tests,
and Chromium E2E tests on pushes to `main` and on pull requests.

## Usage

1. Select a belt profile from the dropdown (pitch is set automatically, or choose *Custom*).
2. Set belt length, pulley tooth counts, idler OD, belt back-to-pitch offset, and layout dimensions using the sliders or entry fields.
3. Adjust any solver input to solve automatically, or click **Re-run** to run the solver again with the current values.
4. Use **Tension offset** to simulate the idler pod moving along its slot.
5. Click **Export CSV** to save Fusion 360 parameters.
6. Click **Get 3D files** to open the OpenSCAD pulley customizer seeded from the current belt and pulley values.
7. Click **Reset** to return to the default example.

## Notes

- All dimensions are in millimetres.
- Pulleys are modelled at pitch radius; idlers at OD/2 plus the belt back-to-pitch UI parameter.
- Belt back-to-pitch defaults to `0.0` mm. Increase it if your belt's pitch line is offset from the back surface.
- The belt visual thickness in the 2D drawing does not affect the pitch-line solver.
- Multiple valid idler Y positions may exist for a given belt length; the solver
  picks the one that maximises pulley wrap angle while keeping the layout compact.
- The OpenSCAD pulley generator source is stored at `public/models/pulleys/pulley-generator.scad`.
- BOSL2 is vendored under `public/vendor/BOSL2` so the static customizer can render the uploaded pulley source on GitHub Pages.
