# Belt-Actuator

A desktop layout tool for symmetric belt-driven NEMA17 actuators.

## Features

- Symmetric four-wheel layout: input pulley, output pulley, two smooth backside idlers
- Live 2D visualiser with belt path, pulley/idler circles, and dimension lines
- Solves neutral idler Y (and idler X) from a fixed belt length
- Belt profile presets: GT2, GT3, HTD-3M, HTD-5M, or custom pitch
- Clearance warnings between components
- Exports a Fusion 360 Parameter I/O compatible CSV with formula expressions

## Requirements

- Python 3.9+
- matplotlib ≥ 3.5 (Tkinter is included with standard Python)

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python belted_actuator_gui.py
```

## Usage

1. Select a belt profile from the dropdown (pitch is set automatically, or choose *Custom*).
2. Set belt length, pulley tooth counts, idler OD, and layout dimensions using the sliders or entry fields.
3. Click **Solve idler Y** (or adjust any solver input — it solves automatically).
4. Use **Tension offset** to simulate the idler pod moving along its slot.
5. Click **Export CSV** to save Fusion 360 parameters.
6. Click **Reset** to return to the default example.

## Notes

- All dimensions are in millimetres.
- Pulleys are modelled at pitch radius; idlers at OD/2 + `BELT_BACK_TO_PITCH`.
- `BELT_BACK_TO_PITCH` is a module-level constant (default `0.0`). Adjust it if
  your belt's pitch line is offset from the back surface.
- The belt visual thickness in the 2D drawing does not affect the pitch-line solver.
- Multiple valid idler Y positions may exist for a given belt length; the solver
  picks the one that maximises pulley wrap angle while keeping the layout compact.
