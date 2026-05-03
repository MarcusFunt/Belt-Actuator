# Belted NEMA17 actuator layout + Fusion 360 parameter export

This README describes the parameter CSV and the browser-based visualizer for the symmetric belted NEMA17 actuator layout.

The goal is to make a small belt-reduction actuator where a NEMA17 stepper drives a smaller timing pulley, which drives a larger output timing pulley through a closed timing belt. Two identical smooth bearing idlers guide the belt and increase wrap around the toothed pulleys. The tool is built around this design choice:

> Choose a standard belt length first, then solve the actuator layout around that belt.

That matters because timing belts are normally bought in fixed pitch lengths/tooth counts. Instead of designing a random geometry and then hoping a belt exists, the tool starts with a real closed-loop pitch length and calculates the idler position needed to make the belt fit.

---

## Mechanical layout being modelled

The actuator is a 2D belt path viewed from above/front-on in the pulley plane.

There are four circular belt-contact elements:

1. `pulleyI` — the input pulley on the NEMA17 motor shaft.
2. `pulleyO` — the large output pulley connected to the output shaft.
3. `idler1` — a smooth bearing idler on the left side.
4. `idler2` — a smooth bearing idler on the right side.

The layout is symmetric around the vertical centerline.

Coordinate system:

| Part | X coordinate | Y coordinate |
|---|---:|---:|
| Output pulley, `pulleyO` | `0` | `0` |
| Input pulley, `pulleyI` | `0` | `center_IO_mm` |
| Left idler, `idler1` | `-idler_x_offset_mm` | `idler_y_mm` |
| Right idler, `idler2` | `+idler_x_offset_mm` | `idler_y_mm` |

So the output shaft is the origin. The motor sits above it. The two idlers sit symmetrically left and right. The web tool solves `idler_y_nominal_mm` from the chosen belt length, then applies `tension_offset_mm` to get the current `idler_y_mm`.

The intended belt path is:

`pulleyI → idler1 → pulleyO → idler2 → pulleyI`

The same layout can also be interpreted mirrored as:

`pulleyI → idler2 → pulleyO → idler1 → pulleyI`

Because the design is symmetric, those two are mechanically equivalent.

---

## Belt orientation assumption

This is the exact belt orientation assumed by the tool:

| Component | Belt contact side | Mechanical meaning |
|---|---|---|
| `pulleyI` / input pulley | Toothed side | The motor pulley engages the belt teeth. |
| `pulleyO` / output pulley | Toothed side | The output pulley engages the belt teeth. |
| `idler1` | Flat/back side | The idler is a smooth bearing, not toothed. |
| `idler2` | Flat/back side | The idler is a smooth bearing, not toothed. |

This is important. The idlers are not timing pulleys. They are treated as plain round bearing rollers with a user-entered outside diameter.

Because the idlers touch the back side of the belt, the belt bends in the reverse direction around them compared with the toothed pulleys. This is mechanically common, but the idler OD should not be too small. A tiny backside bend radius can increase belt fatigue, friction, heat, and noise.

---

## Main design goal

The design goal is to generate a useful parametric actuator layout from a minimal set of real-world choices:

1. Choose a belt family and pitch.
2. Choose a standard closed belt pitch length.
3. Choose input and output pulley tooth counts.
4. Choose the idler bearing OD.
5. Choose the motor-to-output vertical spacing.
6. Choose the idler half-spacing from the centerline.
7. Solve the neutral idler height needed to make the selected belt fit.
8. Export the resulting values to Fusion 360 as user parameters.

This supports quick iteration across belt standards such as GT2, GT3, HTD-3M, HTD-5M, etc., without rewriting the CAD model each time.

---

## Inputs agreed for this actuator

These are the actual inputs the layout is meant to use.

### Belt inputs

| Input | Meaning |
|---|---|
| `belt_profile` | Optional belt-family label/preset, e.g. `GT2`, `HTD-3M`. |
| `belt_pitch_mm` | Tooth pitch in mm. Example: GT2 = 2 mm, HTD-3M = 3 mm, HTD-5M = 5 mm. |
| `belt_length_mm` | Closed-loop belt pitch length. |
| `belt_visual_thickness_mm` | Visual belt thickness in the 2D drawing only. It is not used by the solver. |

Derived from those:

| Derived value | Formula / meaning |
|---|---|
| `belt_teeth_exact` | `belt_length_mm / belt_pitch_mm`; should be an integer for a real timing belt. |

### Timing pulley inputs

| Input | Meaning |
|---|---|
| `pulleyI_teeth` | Tooth count of the motor/input pulley. |
| `pulleyO_teeth` | Tooth count of the large output pulley. |

Derived from those:

| Derived value | Formula / meaning |
|---|---|
| `pulleyI_pitch_dia_mm` | `pulleyI_teeth * belt_pitch_mm / PI` |
| `pulleyO_pitch_dia_mm` | `pulleyO_teeth * belt_pitch_mm / PI` |
| `pulleyI_pitch_r_mm` | `pulleyI_pitch_dia_mm / 2` |
| `pulleyO_pitch_r_mm` | `pulleyO_pitch_dia_mm / 2` |
| `ratio` | `pulleyO_teeth / pulleyI_teeth` |

The reduction ratio is purely tooth-count based. Example: 20T input and 100T output gives a 5:1 reduction.

### Smooth idler inputs

| Input | Meaning |
|---|---|
| `idler_OD_mm` | Physical outside diameter of both smooth bearing idlers. |

Derived from those:

| Derived value | Formula / meaning |
|---|---|
| `idler_r_mm` | `idler_OD_mm / 2` |

The 2D solver uses the idler OD as the backside idler contact circle for layout.

### Layout inputs

| Input | Meaning |
|---|---|
| `center_IO_mm` | Vertical distance from output pulley center to motor/input pulley center. |
| `idler_x_offset_mm` | Horizontal offset of each idler from the centerline. |
| `tension_slot_travel_mm` | Total travel range of the shared idler pod. |
| `tension_offset_mm` | Current idler-pod displacement from the solved neutral position. |
| `minimum_clearance_mm` | Clearance warning threshold between 2D circular parts. |

The recommended workflow is to manually choose `center_IO_mm` and `idler_x_offset_mm`, then solve `idler_y_nominal_mm` from the selected belt length.

The solver can return zero, one, or multiple valid Y positions. If there are multiple candidates, the solver chooses the best-scored one based on wrap and compactness and reports the candidate count.

### Mechanical / CAD inputs

These are not part of the mathematical belt solver, but they are useful for Fusion 360 modelling:

| Input | Meaning |
|---|---|
| `motor_mount_hole_spacing_mm` | NEMA17 screw spacing, usually 31 mm. |
| `motor_screw_clearance_dia_mm` | Clearance hole diameter for motor screws. |
| `motor_pilot_clearance_dia_mm` | Clearance for the motor front boss/pilot. |
| `output_shaft_dia_mm` | Placeholder output shaft diameter. |
| `output_bearing_OD_mm` | Placeholder output bearing outside diameter. |
| `output_bearing_width_mm` | Placeholder output bearing width. |
| `idler_bolt_dia_mm` | Idler bolt/shaft diameter. |
| `idler_bolt_clearance_dia_mm` | Clearance hole diameter for the idler bolt. |
| `slot_length_mm` | Tensioning slot length. |
| `slot_width_mm` | Tensioning slot width. |

---

## Outputs generated by the solver / web app

The web tool and the parameter file are intended to generate these outputs:

| Output | Purpose |
|---|---|
| `ratio` | Mechanical reduction ratio from motor to output. |
| `belt_teeth_exact` | Implied closed belt tooth count from `belt_length_mm / belt_pitch_mm`. |
| `pulleyI_pitch_dia_mm` | Pitch diameter of the motor pulley. |
| `pulleyO_pitch_dia_mm` | Pitch diameter of the output pulley. |
| `idler_y_nominal_mm` | Solved idler Y at zero tension offset. |
| `idler_y_mm` | Current shared idler Y after applying `tension_offset_mm`. |
| `idler1_x_mm`, `idler1_y_mm` | Left idler center coordinates. |
| `idler2_x_mm`, `idler2_y_mm` | Right idler center coordinates. |
| `center_I_idler_mm` | Input pulley to either idler center distance. |
| `center_O_idler_mm` | Output pulley to either idler center distance. |
| `idler_span_mm` | Center distance between idler1 and idler2. |
| `belt_residual_mm` | Difference between modelled belt length and selected belt length at the current tension offset. Ideally near zero at zero offset. |

The visualizer should show the pulley/idler circles, the approximate pitch-line belt path, labels, and useful dimension lines such as:

- motor-to-output center distance
- idler horizontal half-spacing
- idler-to-idler span
- input-to-idler center distance
- output-to-idler center distance
- neutral idler Y and tension slot travel
- belt length residual/status

---

## What the web tool does

The web app is intended as a layout solver and visual checker before committing the geometry to Fusion 360.

It provides:

- Sliders and entry fields for the main input parameters.
- A live 2D drawing of the actuator.
- Dimension lines on the drawing.
- A button to solve `idler_y_nominal_mm` from the selected belt length.
- A Fusion 360-style CSV export.

The web UI is not meant to be a replacement for CAD. It is a fast pre-layout tool. Fusion 360 is still where the actual plates, bearing pockets, pulley models, motor mount, slots, spacers, shafts, and output structure should be designed.

---

## What the Fusion 360 CSV does

The CSV is meant to be imported into Fusion 360 using a parameter import workflow such as the Parameter I/O add-in.

CSV format used:

`parameter name, unit, expression/value, comment`

Example row:

`pulleyI_pitch_dia_mm,mm,pulleyI_teeth*belt_pitch_mm/PI,Input pulley pitch diameter.`

The idea is that Fusion receives the key dimensions as named user parameters, so sketches and features can reference them directly. For example:

- A sketch circle for the input pulley pitch diameter can reference `pulleyI_pitch_dia_mm`.
- The output pulley sketch can reference `pulleyO_pitch_dia_mm`.
- The motor center can be placed at `(input_x_mm, input_y_mm)`.
- The idler centers can be placed at `(idler1_x_mm, idler1_y_mm)` and `(idler2_x_mm, idler2_y_mm)`.
- Slots can reference `slot_length_mm` and `slot_width_mm`.
- Bearing holes can reference `output_bearing_OD_mm`, `idler_bolt_clearance_dia_mm`, etc.

---

## Important limitation: Fusion is not the belt solver

Fusion user parameters can store equations, but the normal parameter table is not a general nonlinear root solver.

That means Fusion can easily do:

- `belt_teeth_exact = belt_length_mm / belt_pitch_mm`
- `ratio = pulleyO_teeth / pulleyI_teeth`
- `pulleyI_pitch_dia_mm = pulleyI_teeth * belt_pitch_mm / PI`

But Fusion should not be expected to automatically solve a complex tangent-belt path for `idler_y_nominal_mm`.

So the workflow is:

1. Use the web app to solve `idler_y_nominal_mm`.
2. Export the CSV.
3. Import/update the CSV in Fusion.
4. Let Fusion rebuild the model from those parameters.

---

## Geometry assumptions in the belt model

The visualizer/solver uses a simplified but useful pitch-line belt model.

Assumptions:

- The actuator is planar and 2D.
- All pulley/idler axes are parallel.
- The belt has no twist.
- The belt path is symmetric.
- The input and output pulleys are represented by pitch circles.
- The idlers are represented by their smooth outside-diameter circles.
- The belt follows tangent lines between circular contact regions.
- Belt thickness, tooth deformation, manufacturing tolerance, and tension stretch are not fully physically simulated.
- The model is for layout and CAD parameter generation, not final belt life prediction.

Practical consequence:

The solved layout should be treated as a good starting point, not a guarantee that the real belt will tension perfectly. Real builds need tensioning travel.

---

## Mechanical assumptions and recommendations


### Idler size

Because the idlers bend the belt backwards, avoid very small idlers. Backside idlers that are too small can make the actuator noisy, inefficient, and short-lived.

The model allows any `idler_OD_mm`, but mechanically you should check the belt manufacturer’s minimum backside bend radius.

### Pulley wrap

The reason for the two idlers is to improve belt wrap around the input and output timing pulleys. The small motor pulley is especially sensitive to wrap. If the input pulley has too little wrap, the belt can skip under load.

For a first prototype, aim for generous wrap around the motor pulley rather than the most compact possible layout.

### Output stiffness

The output shaft and bearings matter more than the belt math. A belt reduction can multiply torque, but if the output shaft, pulley attachment, printed frame, or bearing spacing is weak, the actuator will feel sloppy.

For a useful actuator, consider:

- two output bearings with spacing between them
- a stiff side plate or double-plate structure
- a strong pulley-to-output-shaft connection
- an output-side encoder if closed-loop accuracy matters

### Encoder placement

A motor-side encoder only measures the motor. It does not see belt stretch, belt slip, pulley compliance, frame flex, or output shaft play.

An output-side encoder gives better real output position feedback.

---

## How to use the workflow

1. Pick a belt profile and pitch.
   - Example: GT2, 2 mm pitch.
2. Pick a standard closed belt pitch length.
   - Example: 132T gives a 264 mm pitch length for GT2.
3. Pick pulley tooth counts.
   - Example: 20T input and 60T output gives 3:1 reduction.
4. Pick smooth idler OD.
   - Example: 22 mm bearing OD.
5. Pick `center_IO_mm` and `idler_x_offset_mm` based on packaging and desired wrap.
6. Use the web app to solve `idler_y_nominal_mm`.
7. Check the drawing and dimension lines.
8. Adjust values until the layout is reasonable.
9. Export the CSV.
10. Import/update user parameters in Fusion 360.
11. Build the actual actuator plates, shaft supports, idler mounts, and motor mount around those parameter names.

---

## Suggested first prototype values

These are not magic numbers, just reasonable first-test values:

| Parameter | Suggested value |
|---|---:|
| `belt_profile` | `GT2` |
| `belt_pitch_mm` | `2 mm` |
| `belt_length_mm` | `264 mm` |
| `pulleyI_teeth` | `20` |
| `pulleyO_teeth` | `60` |
| `idler_OD_mm` | `22 mm` |
| `center_IO_mm` | `90 mm` |
| `idler_x_offset_mm` | `20 mm` |
| `tension_slot_travel_mm` | `6 mm` |
| `tension_offset_mm` | `0 mm` |
| `belt_visual_thickness_mm` | `1.5 mm` |
| `minimum_clearance_mm` | `1.5 mm` |

The solver then finds the neutral `idler_y_nominal_mm`.


The intended flow is:

`Web app -> solve layout -> export CSV -> Fusion 360 user parameters -> parametric CAD model`
