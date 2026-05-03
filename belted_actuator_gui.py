"""
Belted NEMA17 actuator layout tool

Features
- Symmetric four-wheel layout: input pulley, output pulley, two smooth backside idlers
- Standard belt length input by belt profile/pitch + closed-loop pitch length
- Live Tkinter GUI with sliders + entry fields
- Matplotlib 2D visualizer with belt path, pulley/idler circles, and dimension lines
- Solves neutral idler Y from fixed belt length using a tangent-belt geometry model
- Exports a Fusion 360 Parameter I/O compatible CSV: name, unit, expression/value, comment

Install:
    pip install matplotlib

Run:
    python belted_actuator_gui.py

Notes
- Pulleys are modeled at pitch radius.
- Smooth idlers are modeled at idlerOD/2 for this 2D layout.
- The belt visual thickness is drawing-only and is not used by the pitch-line solver.
"""

from __future__ import annotations

import csv
import math
import tkinter as tk
from dataclasses import dataclass
from tkinter import filedialog, messagebox, ttk
from typing import Dict, List, Optional, Tuple

from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure

Point = Tuple[float, float]

BELT_PITCH_PRESETS: Dict[str, float] = {
    "GT2": 2.0,
    "GT3": 3.0,
    "HTD-3M": 3.0,
    "HTD-5M": 5.0,
}
CUSTOM_BELT_TYPE = "Custom"


# ----------------------------- Geometry helpers -----------------------------

def add(a: Point, b: Point) -> Point:
    return (a[0] + b[0], a[1] + b[1])


def sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1])


def mul(a: Point, k: float) -> Point:
    return (a[0] * k, a[1] * k)


def dot(a: Point, b: Point) -> float:
    return a[0] * b[0] + a[1] * b[1]


def norm(a: Point) -> float:
    return math.hypot(a[0], a[1])


def unit(a: Point) -> Point:
    length = norm(a)
    if length <= 1e-12:
        return (0.0, 0.0)
    return (a[0] / length, a[1] / length)


def angle_of(p: Point, center: Point) -> float:
    return math.atan2(p[1] - center[1], p[0] - center[0])


def unwrap_to_direction(a0: float, a1: float, direction: int) -> float:
    """Return signed angular travel from a0 to a1.
    direction = +1 means CCW, -1 means CW.
    """
    if direction >= 0:
        while a1 < a0:
            a1 += 2 * math.pi
        return a1 - a0
    else:
        while a1 > a0:
            a1 -= 2 * math.pi
        return a1 - a0


def sample_arc(center: Point, radius: float, a0: float, a1: float, direction: int, n: int = 48) -> List[Point]:
    travel = unwrap_to_direction(a0, a1, direction)
    return [
        (center[0] + radius * math.cos(a0 + travel * i / max(1, n - 1)),
         center[1] + radius * math.sin(a0 + travel * i / max(1, n - 1)))
        for i in range(n)
    ]


def tangent_vector(center: Point, point: Point, direction: int) -> Point:
    radial = unit(sub(point, center))
    if direction >= 0:
        return (-radial[1], radial[0])
    return (radial[1], -radial[0])


def tangent_options(c1: Point, r1: float, c2: Point, r2: float, internal: bool = False) -> List[Tuple[Point, Point]]:
    """Return the two tangent-point pairs between two circles.

    External tangents are used for the normal outside belt path. Internal
    tangents are still enumerated by the solver because tightly packed layouts
    can otherwise leave no continuous candidate.
    """
    v = sub(c2, c1)
    d = norm(v)
    if d <= 1e-9:
        return []

    # internal: p2 uses -normal, equivalent to r1 + r2 separation condition
    side = -1.0 if internal else 1.0
    c = (r1 - side * r2) / d
    if abs(c) > 1.0:
        return []

    vx, vy = v[0] / d, v[1] / d
    h = math.sqrt(max(0.0, 1.0 - c * c))
    out: List[Tuple[Point, Point]] = []
    for s in (-1.0, 1.0):
        # Unit normal to the tangent line.
        nx = vx * c - s * h * vy
        ny = vy * c + s * h * vx
        n = (nx, ny)
        p1 = add(c1, mul(n, r1))
        p2 = add(c2, mul(n, side * r2))
        out.append((p1, p2))
    return out


def segment_intersection(a: Point, b: Point, c: Point, d: Point) -> bool:
    def orient(p: Point, q: Point, r: Point) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def between(p: Point, q: Point, r: Point) -> bool:
        return min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9 and \
               min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9

    o1 = orient(a, b, c)
    o2 = orient(a, b, d)
    o3 = orient(c, d, a)
    o4 = orient(c, d, b)

    if o1 * o2 < 0 and o3 * o4 < 0:
        return True
    if abs(o1) < 1e-9 and between(a, c, b):
        return True
    if abs(o2) < 1e-9 and between(a, d, b):
        return True
    if abs(o3) < 1e-9 and between(c, a, d):
        return True
    if abs(o4) < 1e-9 and between(c, b, d):
        return True
    return False


@dataclass
class CircleItem:
    name: str
    center: Point
    radius: float
    kind: str  # "pulley" or "idler"


@dataclass
class BeltSolution:
    length: float
    line_length: float
    arc_length: float
    tangent_edges: List[Tuple[Point, Point]]
    arc_points: Dict[str, List[Point]]
    wrap_deg: Dict[str, float]
    valid: bool
    reason: str


class BeltModel:
    """Symmetric pulley/idler belt model.

    Fixed contact order: input -> right idler -> output -> left idler -> input.
    Pulleys contact toothed side; idlers contact flat backside.
    """

    CONTACT_ORDER = ("pulleyI", "idler2", "pulleyO", "idler1")

    @staticmethod
    def target_length(params: Dict[str, float]) -> float:
        if "beltLength" in params:
            return params["beltLength"]
        return params["beltPitch"] * params["beltTeeth"]

    @staticmethod
    def circles(params: Dict[str, float]) -> List[CircleItem]:
        pitch = params["beltPitch"]
        r_i = params["pulleyITeeth"] * pitch / math.pi / 2
        r_o = params["pulleyOTeeth"] * pitch / math.pi / 2
        r_id = params["idlerOD"] / 2 + params.get("beltBackToPitch", 0.0)
        x = params["idlerX"]
        y = params["idlerY"]
        motor_y = params["motorY"]
        return [
            CircleItem("pulleyI", (0.0, motor_y), r_i, "pulley"),
            CircleItem("idler1", (-x, y), r_id, "idler"),
            CircleItem("pulleyO", (0.0, 0.0), r_o, "pulley"),
            CircleItem("idler2", (x, y), r_id, "idler"),
        ]

    @staticmethod
    def belt_solution(params: Dict[str, float]) -> BeltSolution:
        circles_by_name = {c.name: c for c in BeltModel.circles(params)}
        circles = [circles_by_name[name] for name in BeltModel.CONTACT_ORDER]
        n = len(circles)

        edge_options: List[List[Tuple[Point, Point]]] = []
        for i in range(n):
            a = circles[i]
            b = circles[(i + 1) % n]
            opts = tangent_options(a.center, a.radius, b.center, b.radius, internal=False)
            opts += tangent_options(a.center, a.radius, b.center, b.radius, internal=True)
            if not opts:
                return BeltSolution(math.inf, math.inf, math.inf, [], {}, {}, False, "No tangent solution: circles overlap or are too close.")
            edge_options.append(opts)

        best: Optional[Tuple[float, BeltSolution]] = None

        def candidate_edges(index: int = 0, current: Optional[List[Tuple[Point, Point]]] = None):
            if current is None:
                current = []
            if index == n:
                yield list(current)
                return
            for edge in edge_options[index]:
                current.append(edge)
                yield from candidate_edges(index + 1, current)
                current.pop()

        for edges in candidate_edges():
            dirs: Dict[str, int] = {}
            continuous = True
            for k, c in enumerate(circles):
                incoming_start, incoming_point = edges[(k - 1) % n]
                outgoing_point, outgoing_end = edges[k]
                incoming_vec = unit(sub(incoming_point, incoming_start))
                outgoing_vec = unit(sub(outgoing_end, outgoing_point))
                matching_dirs = [
                    direction for direction in (1, -1)
                    if dot(incoming_vec, tangent_vector(c.center, incoming_point, direction)) > 0.999
                    and dot(outgoing_vec, tangent_vector(c.center, outgoing_point, direction)) > 0.999
                ]
                if not matching_dirs:
                    continuous = False
                    break
                dirs[c.name] = matching_dirs[0]
            if not continuous:
                continue

            # The toothed pulleys bend one way; backside idlers must bend the
            # opposite way. Crossing is always illegal, even for adjacent spans.
            if dirs["pulleyI"] != dirs["pulleyO"]:
                continue
            if dirs["idler1"] != -dirs["pulleyI"] or dirs["idler2"] != -dirs["pulleyI"]:
                continue

            crossed = False
            for i in range(n):
                for j in range(i + 1, n):
                    if segment_intersection(edges[i][0], edges[i][1], edges[j][0], edges[j][1]):
                        crossed = True
                        break
                if crossed:
                    break
            if crossed:
                continue

            line_len = sum(norm(sub(b, a)) for a, b in edges)
            arc_len = 0.0
            arcs: Dict[str, List[Point]] = {}
            wraps: Dict[str, float] = {}
            for k, c in enumerate(circles):
                incoming_point = edges[(k - 1) % n][1]
                outgoing_point = edges[k][0]
                a0 = angle_of(incoming_point, c.center)
                a1 = angle_of(outgoing_point, c.center)
                travel = unwrap_to_direction(a0, a1, dirs[c.name])
                arc_len += abs(travel) * c.radius
                wraps[c.name] = abs(math.degrees(travel))
                arcs[c.name] = sample_arc(c.center, c.radius, a0, a1, dirs[c.name])

            sol = BeltSolution(line_len + arc_len, line_len, arc_len, edges, arcs, wraps, True, "OK")
            score = wraps["pulleyO"] + wraps["pulleyI"] + 0.25 * (wraps["idler1"] + wraps["idler2"])
            if best is None or score > best[0]:
                best = (score, sol)

        if best is None:
            return BeltSolution(math.inf, math.inf, math.inf, [], {}, {}, False, "No non-crossing backside-idler belt path found.")

        return best[1]

    @staticmethod
    def solve_idler_x(params: Dict[str, float], x_min: float = 1.0, x_max: float = 250.0) -> Tuple[Optional[float], str]:
        target = BeltModel.target_length(params)

        def residual(x: float) -> float:
            p = dict(params)
            p["idlerX"] = x
            return BeltModel.belt_solution(p).length - target

        lo_limit = max(x_min, 0.1)
        hi_limit = max(x_max, lo_limit + 1.0)

        samples = 1000
        bracket: Optional[Tuple[float, float]] = None
        prev_x: Optional[float] = None
        prev_f: Optional[float] = None
        min_valid: Optional[Tuple[float, float]] = None
        max_valid: Optional[Tuple[float, float]] = None
        for i in range(samples + 1):
            x = lo_limit + (hi_limit - lo_limit) * i / samples
            p = dict(params)
            p["idlerX"] = x
            sol = BeltModel.belt_solution(p)
            if not math.isfinite(sol.length):
                prev_x = None
                prev_f = None
                continue
            if min_valid is None or sol.length < min_valid[1]:
                min_valid = (x, sol.length)
            if max_valid is None or sol.length > max_valid[1]:
                max_valid = (x, sol.length)
            f = sol.length - target
            if abs(f) < 1e-9:
                return x, "OK"
            if prev_x is not None and prev_f is not None and prev_f * f <= 0:
                bracket = (prev_x, x)
                break
            prev_x = x
            prev_f = f

        if bracket is None:
            if min_valid is None or max_valid is None:
                return None, "No valid non-crossing backside-idler belt path exists for this geometry."
            if target < min_valid[1]:
                return None, f"Selected belt is too short. Shortest valid path found is {min_valid[1]:.3f} mm at idlerX {min_valid[0]:.3f} mm."
            if target > max_valid[1]:
                return None, f"Selected belt is too long. Longest valid path found is {max_valid[1]:.3f} mm at idlerX {max_valid[0]:.3f} mm."
            return None, "Could not solve idlerX for this belt length without crossing or wrong-side idler wrap. Change belt length, belt type, motorY, idlerY, or pulley/idler sizes."

        lo, hi = bracket

        for _ in range(80):
            mid = (lo + hi) / 2
            f_mid = residual(mid)
            f_lo = residual(lo)
            if f_lo * f_mid <= 0:
                hi = mid
            else:
                lo = mid
        return (lo + hi) / 2, "OK"

    @staticmethod
    def solve_idler_y(
        params: Dict[str, float],
        y_min: Optional[float] = None,
        y_max: Optional[float] = None,
    ) -> Tuple[Optional[float], List[float], str]:
        target = BeltModel.target_length(params)
        center_y = params["motorY"]
        idler_x = params["idlerX"]
        max_radius = max(
            params["pulleyITeeth"] * params["beltPitch"] / math.pi / 2,
            params["pulleyOTeeth"] * params["beltPitch"] / math.pi / 2,
            params["idlerOD"] / 2 + params.get("beltBackToPitch", 0.0),
        )
        span = max(target / 2, abs(center_y), abs(idler_x), max_radius) + 50.0
        lo_limit = min(0.0, center_y) - span if y_min is None else y_min
        hi_limit = max(0.0, center_y) + span if y_max is None else y_max

        def residual(y: float) -> float:
            p = dict(params)
            p["idlerY"] = y
            return BeltModel.belt_solution(p).length - target

        def finite_residual(y: float) -> Optional[float]:
            f = residual(y)
            if math.isfinite(f):
                return f
            return None

        def refine(a: float, b: float, f_a: float, _f_b: float) -> Optional[float]:
            lo = a
            hi = b
            flo = f_a
            for _ in range(80):
                mid = (lo + hi) / 2
                fmid = finite_residual(mid)
                if fmid is None:
                    return None
                if abs(fmid) < 1e-9:
                    return mid
                if flo * fmid <= 0:
                    hi = mid
                else:
                    lo = mid
                    flo = fmid
            return (lo + hi) / 2

        samples = 300
        roots: List[float] = []
        prev_y: Optional[float] = None
        prev_f: Optional[float] = None
        min_valid: Optional[Tuple[float, float]] = None
        max_valid: Optional[Tuple[float, float]] = None

        for i in range(samples + 1):
            y = lo_limit + (hi_limit - lo_limit) * i / samples
            f = finite_residual(y)
            if f is None:
                prev_y = None
                prev_f = None
                continue

            length = f + target
            if min_valid is None or length < min_valid[1]:
                min_valid = (y, length)
            if max_valid is None or length > max_valid[1]:
                max_valid = (y, length)

            if abs(f) < 1e-9:
                roots.append(y)
            elif prev_y is not None and prev_f is not None and prev_f * f <= 0:
                root = refine(prev_y, y, prev_f, f)
                if root is not None:
                    roots.append(root)

            prev_y = y
            prev_f = f

        deduped: List[float] = []
        for y in sorted(roots):
            if not deduped or abs(y - deduped[-1]) > 1e-5:
                deduped.append(y)

        if not deduped:
            if min_valid is None or max_valid is None:
                return None, [], "No valid non-crossing backside-idler belt path exists for this geometry."
            if target < min_valid[1]:
                return None, [], f"Selected belt is too short. Shortest valid path found is {min_valid[1]:.3f} mm at idlerY {min_valid[0]:.3f} mm."
            if target > max_valid[1]:
                return None, [], f"Selected belt is too long. Longest valid path found is {max_valid[1]:.3f} mm at idlerY {max_valid[0]:.3f} mm."
            return None, [], "Could not solve idlerY for this belt length without crossing or wrong-side idler wrap."

        def score(y: float) -> float:
            p = dict(params)
            p["idlerY"] = y
            sol = BeltModel.belt_solution(p)
            midpoint = center_y / 2
            lower = min(0.0, center_y)
            upper = max(0.0, center_y)
            outside = max(lower - y, 0.0, y - upper)
            wrap_score = (
                sol.wrap_deg.get("pulleyI", 0.0)
                + sol.wrap_deg.get("pulleyO", 0.0)
                + 0.25 * sol.wrap_deg.get("idler1", 0.0)
                + 0.25 * sol.wrap_deg.get("idler2", 0.0)
            )
            compact_penalty = abs(y - midpoint)
            return wrap_score - 0.2 * compact_penalty - 4.0 * outside

        chosen = max(deduped, key=score)
        if len(deduped) == 1:
            return chosen, deduped, "OK"
        return chosen, deduped, f"OK; found {len(deduped)} valid idlerY candidates and chose the best-scored one."


# ----------------------------- GUI app -----------------------------

class ParamControl:
    def __init__(self, parent, row: int, name: str, label: str, unit: str, initial: float, low: float, high: float, step: float, callback):
        self.name = name
        self.unit = unit
        self.step = step
        self.var = tk.DoubleVar(value=initial)
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=4, pady=2)
        self.scale = ttk.Scale(parent, from_=low, to=high, variable=self.var, command=lambda _=None: self._scale_changed(callback))
        self.scale.grid(row=row, column=1, sticky="ew", padx=4)
        self.entry = ttk.Entry(parent, width=10)
        self.entry.grid(row=row, column=2, sticky="ew", padx=4)
        ttk.Label(parent, text=unit).grid(row=row, column=3, sticky="w", padx=4)
        self.entry.insert(0, self._fmt(initial))
        self.entry.bind("<Return>", lambda _=None: self._entry_changed(callback))
        self.entry.bind("<FocusOut>", lambda _=None: self._entry_changed(callback))

    def _fmt(self, value: float) -> str:
        if self.step >= 1:
            return str(int(round(value)))
        return f"{value:.3f}".rstrip("0").rstrip(".")

    def _scale_changed(self, callback):
        value = self.var.get()
        if self.step >= 1:
            value = round(value)
        else:
            value = round(value / self.step) * self.step
        self.var.set(value)
        self.entry.delete(0, tk.END)
        self.entry.insert(0, self._fmt(value))
        callback()

    def _entry_changed(self, callback):
        try:
            value = float(self.entry.get().strip())
        except ValueError:
            value = self.var.get()
        self.var.set(value)
        self.entry.delete(0, tk.END)
        self.entry.insert(0, self._fmt(value))
        callback()

    def get(self) -> float:
        return float(self.var.get())

    def set(self, value: float):
        self.var.set(value)
        entry_state = str(self.entry.cget("state"))
        if entry_state == "disabled":
            self.entry.configure(state="normal")
        self.entry.delete(0, tk.END)
        self.entry.insert(0, self._fmt(value))
        if entry_state == "disabled":
            self.entry.configure(state="disabled")

    def set_enabled(self, enabled: bool):
        state = "normal" if enabled else "disabled"
        self.scale.configure(state=state)
        self.entry.configure(state=state)


class ActuatorGUI(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Symmetric Belted NEMA17 Actuator Solver")
        self.geometry("1320x820")
        self.minsize(1050, 700)
        self.controls: Dict[str, ParamControl] = {}
        self.belt_type_var = tk.StringVar(value="GT2")
        self.status_var = tk.StringVar(value="Ready")
        self.layout_error: Optional[str] = None
        self.solved_idler_y_nominal: Optional[float] = None
        self.idler_y_candidates: List[float] = []
        self.last_solve_message = "Not solved"
        self._build_ui()
        self._apply_belt_type(solve=False)
        self.solve_idler_y(show_errors=False)

    def _build_ui(self):
        root = ttk.Frame(self, padding=(8, 8, 8, 4))
        root.pack(fill=tk.BOTH, expand=True)
        root.rowconfigure(0, weight=1)
        root.columnconfigure(0, weight=1)

        paned = ttk.PanedWindow(root, orient=tk.HORIZONTAL)
        paned.grid(row=0, column=0, sticky="nsew")

        left = ttk.Frame(paned, padding=(0, 0, 8, 0))
        right = ttk.Frame(paned, padding=(8, 0, 0, 0))
        paned.add(left, weight=0)
        paned.add(right, weight=1)

        left.columnconfigure(0, weight=1)
        left.rowconfigure(3, weight=1)
        right.columnconfigure(0, weight=1)
        right.rowconfigure(0, weight=1)

        ttk.Label(left, text="Input parameters", font=("Segoe UI", 12, "bold")).grid(row=0, column=0, sticky="w", pady=(0, 8))

        controls_area = ttk.Frame(left)
        controls_area.grid(row=1, column=0, sticky="ew")
        controls_area.columnconfigure(0, weight=1)
        controls_area.columnconfigure(1, weight=1)

        drive_frame = ttk.LabelFrame(controls_area, text="Belt and drive", padding=(8, 6))
        layout_frame = ttk.LabelFrame(controls_area, text="Layout and tension", padding=(8, 6))
        drive_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        layout_frame.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        drive_frame.columnconfigure(1, weight=1)
        layout_frame.columnconfigure(1, weight=1)

        ttk.Label(drive_frame, text="Belt profile").grid(row=0, column=0, sticky="w", padx=4, pady=2)
        self.belt_type_combo = ttk.Combobox(
            drive_frame,
            textvariable=self.belt_type_var,
            values=list(BELT_PITCH_PRESETS.keys()) + [CUSTOM_BELT_TYPE],
            state="readonly",
            width=12,
        )
        self.belt_type_combo.grid(row=0, column=1, columnspan=2, sticky="ew", padx=4)
        ttk.Label(drive_frame, text="preset").grid(row=0, column=3, sticky="w", padx=4)
        self.belt_type_combo.bind("<<ComboboxSelected>>", self._belt_type_changed)

        control_groups = [
            (drive_frame, 1, [
                ("belt_pitch_mm", "Belt pitch", "mm", 2.0, 1.0, 8.0, 0.1),
                ("belt_length_mm", "Belt length", "mm", 264.0, 80.0, 1000.0, 1.0),
                ("pulleyI_teeth", "Input pulley teeth", "teeth", 20, 10, 80, 1),
                ("pulleyO_teeth", "Output pulley teeth", "teeth", 60, 20, 240, 1),
                ("idler_OD_mm", "Idler OD", "mm", 22.0, 6.0, 60.0, 0.5),
                ("belt_visual_thickness_mm", "Belt visual thickness", "mm", 1.5, 0.2, 8.0, 0.1),
            ]),
            (layout_frame, 0, [
                ("center_IO_mm", "Input-output center", "mm", 90.0, 20.0, 220.0, 0.5),
                ("idler_x_offset_mm", "Idler half-spacing", "mm", 20.0, 1.0, 250.0, 0.5),
                ("tension_slot_travel_mm", "Tension slot travel", "mm", 6.0, 0.0, 40.0, 0.5),
                ("tension_offset_mm", "Tension offset", "mm", 0.0, -20.0, 20.0, 0.1),
                ("minimum_clearance_mm", "Minimum clearance", "mm", 1.5, 0.0, 20.0, 0.1),
            ]),
        ]
        solver_inputs = {
            "belt_pitch_mm",
            "belt_length_mm",
            "pulleyI_teeth",
            "pulleyO_teeth",
            "idler_OD_mm",
            "center_IO_mm",
            "idler_x_offset_mm",
        }
        for frame, start_row, specs in control_groups:
            for r, spec in enumerate(specs, start=start_row):
                name, label, unit, initial, low, high, step = spec
                callback = self._input_changed if name in solver_inputs else self.redraw
                self.controls[name] = ParamControl(frame, r, name, label, unit, initial, low, high, step, callback)

        actions = ttk.Frame(left)
        actions.grid(row=2, column=0, sticky="ew", pady=(8, 8))
        for col in range(3):
            actions.columnconfigure(col, weight=1)
        ttk.Button(actions, text="Solve idler Y", command=self.solve_idler_y).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(actions, text="Export CSV", command=self.export_csv_dialog).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(actions, text="Reset", command=self.reset_example).grid(row=0, column=2, sticky="ew", padx=(4, 0))

        diagnostics = ttk.LabelFrame(left, text="Diagnostics", padding=(6, 6))
        diagnostics.grid(row=3, column=0, sticky="nsew")
        diagnostics.rowconfigure(0, weight=1)
        diagnostics.columnconfigure(0, weight=1)
        self.readout = tk.Text(diagnostics, height=10, width=64, wrap="word", font=("Consolas", 9), relief="flat", borderwidth=0)
        readout_scrollbar = ttk.Scrollbar(diagnostics, orient=tk.VERTICAL, command=self.readout.yview)
        self.readout.configure(yscrollcommand=readout_scrollbar.set, state="disabled")
        self.readout.grid(row=0, column=0, sticky="nsew")
        readout_scrollbar.grid(row=0, column=1, sticky="ns")

        ttk.Label(root, textvariable=self.status_var, foreground="#444", anchor="w").grid(row=1, column=0, sticky="ew", pady=(4, 0))

        self.fig = Figure(figsize=(8, 7), dpi=100, constrained_layout=True)
        self.ax = self.fig.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.fig, master=right)
        self.canvas.get_tk_widget().grid(row=0, column=0, sticky="nsew")
        self.toolbar = NavigationToolbar2Tk(self.canvas, right, pack_toolbar=False)
        self.toolbar.update()
        self.toolbar.grid(row=1, column=0, sticky="ew")

    def params(self) -> Dict[str, float]:
        return {k: c.get() for k, c in self.controls.items()}

    def _belt_type_changed(self, _event=None):
        self._apply_belt_type(solve=True)

    def _apply_belt_type(self, solve: bool):
        pitch_control = self.controls.get("belt_pitch_mm")
        if pitch_control is None:
            return
        belt_type = self.belt_type_var.get()
        if belt_type == CUSTOM_BELT_TYPE:
            pitch_control.set_enabled(True)
        else:
            pitch_control.set(BELT_PITCH_PRESETS[belt_type])
            pitch_control.set_enabled(False)
        if solve:
            self.solve_idler_y(show_errors=False)

    def _input_changed(self):
        self.solve_idler_y(show_errors=False)

    def model_params(self, p: Optional[Dict[str, float]] = None, idler_y: Optional[float] = None) -> Dict[str, float]:
        if p is None:
            p = self.params()
        if idler_y is None:
            nominal_y = self.solved_idler_y_nominal
            if nominal_y is None:
                nominal_y = p["center_IO_mm"] / 2
            idler_y = nominal_y + p["tension_offset_mm"]
        return {
            "beltPitch": p["belt_pitch_mm"],
            "beltLength": p["belt_length_mm"],
            "pulleyITeeth": p["pulleyI_teeth"],
            "pulleyOTeeth": p["pulleyO_teeth"],
            "idlerOD": p["idler_OD_mm"],
            "beltBackToPitch": 0.0,
            "motorY": p["center_IO_mm"],
            "idlerX": p["idler_x_offset_mm"],
            "idlerY": idler_y,
        }

    def clearance_warnings(self, model_p: Dict[str, float], minimum_clearance: float) -> List[str]:
        circles = BeltModel.circles(model_p)
        warnings: List[str] = []
        for i, a in enumerate(circles):
            for b in circles[i + 1:]:
                clearance = norm(sub(a.center, b.center)) - a.radius - b.radius
                if clearance < minimum_clearance:
                    warnings.append(f"{a.name}-{b.name}: {clearance:.3f} mm")
        return warnings

    def derived(self, p: Dict[str, float], model_p: Dict[str, float], sol: BeltSolution) -> Dict[str, float]:
        pitch = p["belt_pitch_mm"]
        belt_teeth_exact = p["belt_length_mm"] / pitch if pitch else math.inf
        nominal_y = self.solved_idler_y_nominal
        actual_y = model_p["idlerY"]
        return {
            "beltPitchLength": p["belt_length_mm"],
            "beltTeethExact": belt_teeth_exact,
            "beltTeethRounded": round(belt_teeth_exact) if math.isfinite(belt_teeth_exact) else math.inf,
            "beltTeethError": belt_teeth_exact - round(belt_teeth_exact) if math.isfinite(belt_teeth_exact) else math.inf,
            "pulleyIPitchDia": p["pulleyI_teeth"] * pitch / math.pi,
            "pulleyOPitchDia": p["pulleyO_teeth"] * pitch / math.pi,
            "pulleyIPitchR": p["pulleyI_teeth"] * pitch / math.pi / 2,
            "pulleyOPitchR": p["pulleyO_teeth"] * pitch / math.pi / 2,
            "idlerR": p["idler_OD_mm"] / 2,
            "idlerEffR": p["idler_OD_mm"] / 2,
            "ratio": p["pulleyO_teeth"] / p["pulleyI_teeth"],
            "centerIO": p["center_IO_mm"],
            "centerIIdler": math.hypot(p["idler_x_offset_mm"], p["center_IO_mm"] - actual_y),
            "centerOIdler": math.hypot(p["idler_x_offset_mm"], actual_y),
            "idlerSpan": 2 * p["idler_x_offset_mm"],
            "idlerYNominal": nominal_y,
            "idlerYActual": actual_y,
            "modelBeltLength": sol.length,
            "beltResidual": sol.length - p["belt_length_mm"],
            "lineLength": sol.line_length,
            "arcLength": sol.arc_length,
            "clearanceWarnings": self.clearance_warnings(model_p, p["minimum_clearance_mm"]),
        }

    def reset_example(self):
        defaults = {
            "belt_pitch_mm": 2.0,
            "belt_length_mm": 264.0,
            "pulleyI_teeth": 20,
            "pulleyO_teeth": 60,
            "idler_OD_mm": 22.0,
            "center_IO_mm": 90.0,
            "idler_x_offset_mm": 20.0,
            "tension_slot_travel_mm": 6.0,
            "tension_offset_mm": 0.0,
            "belt_visual_thickness_mm": 1.5,
            "minimum_clearance_mm": 1.5,
        }
        self.belt_type_var.set("GT2")
        for k, v in defaults.items():
            self.controls[k].set(v)
        self._apply_belt_type(solve=False)
        self.solve_idler_y(show_errors=False)

    def solve_idler_y(self, show_errors: bool = True, update_status: bool = True):
        p = self.params()
        model_p = self.model_params(p, idler_y=0.0)
        y, candidates, msg = BeltModel.solve_idler_y(model_p)
        self.idler_y_candidates = candidates
        self.last_solve_message = msg
        if y is None:
            self.solved_idler_y_nominal = None
            self.layout_error = msg
            if show_errors:
                messagebox.showerror("No solution", msg)
            if update_status:
                self.status_var.set(msg)
            self.redraw()
            return None
        self.solved_idler_y_nominal = y
        self.layout_error = None
        if update_status:
            suffix = "" if len(candidates) == 1 else f" ({len(candidates)} candidates)"
            self.status_var.set(f"Solved neutral idler Y = {y:.3f} mm{suffix}")
        self.redraw()
        return y

    def dim_line(self, ax, p1: Point, p2: Point, text: str, offset: Point = (0, 0)):
        x1, y1 = p1
        x2, y2 = p2
        ox, oy = offset
        a = (x1 + ox, y1 + oy)
        b = (x2 + ox, y2 + oy)
        ax.annotate("", xy=b, xytext=a, arrowprops=dict(arrowstyle="<->", lw=0.9))
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        ax.text(mid[0], mid[1], text, fontsize=8, ha="center", va="center", bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75))
        # Extension lines.
        ax.plot([x1, a[0]], [y1, a[1]], lw=0.6, linestyle=":")
        ax.plot([x2, b[0]], [y2, b[1]], lw=0.6, linestyle=":")

    def redraw(self):
        p = self.params()
        model_p = self.model_params(p)
        sol = BeltModel.belt_solution(model_p)
        d = self.derived(p, model_p, sol)
        self.ax.clear()
        ax = self.ax
        ax.set_aspect("equal", adjustable="box")
        ax.set_title("Symmetric belted NEMA17 actuator layout")
        ax.set_xlabel("X [mm]")
        ax.set_ylabel("Y [mm]")
        ax.grid(True, alpha=0.25)

        circles = BeltModel.circles(model_p)
        belt_lw = max(1.2, p["belt_visual_thickness_mm"] * 2.2)

        # Draw belt path first.
        if sol.valid and self.layout_error is None:
            for a, b in sol.tangent_edges:
                ax.plot([a[0], b[0]], [a[1], b[1]], lw=belt_lw, color="black", solid_capstyle="round")
            for pts in sol.arc_points.values():
                xs = [q[0] for q in pts]
                ys = [q[1] for q in pts]
                ax.plot(xs, ys, lw=belt_lw, color="black", solid_capstyle="round")
        else:
            reason = self.layout_error if self.layout_error is not None else sol.reason
            ax.text(0.5, 0.95, reason, transform=ax.transAxes, ha="center", va="top", color="red", wrap=True)

        # Draw tension slot travel around the solved neutral idler height.
        if self.solved_idler_y_nominal is not None and p["tension_slot_travel_mm"] > 0:
            slot_half = p["tension_slot_travel_mm"] / 2
            for x in (-model_p["idlerX"], model_p["idlerX"]):
                ax.plot(
                    [x, x],
                    [self.solved_idler_y_nominal - slot_half, self.solved_idler_y_nominal + slot_half],
                    color="#1f77b4",
                    lw=1.4,
                    alpha=0.75,
                )

        # Draw pitch/effective circles.
        for c in circles:
            patch = self.ax.add_patch(__import__("matplotlib").patches.Circle(c.center, c.radius, fill=False, lw=2.0, linestyle="-"))
            if any(c.name in warning for warning in d["clearanceWarnings"]):
                patch.set_edgecolor("red")
            ax.plot(c.center[0], c.center[1], marker="+", ms=9)
            ax.text(c.center[0], c.center[1] + c.radius + 3, c.name, ha="center", fontsize=9, bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.7))

        # Draw centerline and center markers.
        ax.plot([0, 0], [0, model_p["motorY"]], lw=0.8, linestyle="--", alpha=0.7)
        ax.plot([-model_p["idlerX"], model_p["idlerX"]], [model_p["idlerY"], model_p["idlerY"]], lw=0.8, linestyle="--", alpha=0.7)

        # Dimension lines.
        x_pad = model_p["idlerX"] + max(d["pulleyOPitchR"], d["idlerEffR"]) + 22
        y_pad = max(model_p["motorY"], model_p["idlerY"], 0) + max(d["pulleyIPitchR"], d["idlerEffR"]) + 18
        self.dim_line(ax, (0, 0), (0, model_p["motorY"]), f"center_IO {model_p['motorY']:.1f}", offset=(x_pad, 0))
        self.dim_line(ax, (-model_p["idlerX"], model_p["idlerY"]), (model_p["idlerX"], model_p["idlerY"]), f"idler span {2*model_p['idlerX']:.1f}", offset=(0, 12))
        self.dim_line(ax, (0, 0), (model_p["idlerX"], model_p["idlerY"]), f"O-idler {d['centerOIdler']:.1f}", offset=(8, -8))
        self.dim_line(ax, (0, model_p["motorY"]), (model_p["idlerX"], model_p["idlerY"]), f"I-idler {d['centerIIdler']:.1f}", offset=(8, 8))

        margin = 35
        min_x = min(-model_p["idlerX"] - d["idlerEffR"], -d["pulleyOPitchR"], -d["pulleyIPitchR"]) - margin
        max_x = max(model_p["idlerX"] + d["idlerEffR"], d["pulleyOPitchR"], d["pulleyIPitchR"], x_pad + 5) + margin
        slot_y_min = self.solved_idler_y_nominal - p["tension_slot_travel_mm"] / 2 if self.solved_idler_y_nominal is not None else model_p["idlerY"]
        slot_y_max = self.solved_idler_y_nominal + p["tension_slot_travel_mm"] / 2 if self.solved_idler_y_nominal is not None else model_p["idlerY"]
        min_y = min(-d["pulleyOPitchR"], model_p["idlerY"] - d["idlerEffR"], slot_y_min) - margin
        max_y = max(model_p["motorY"] + d["pulleyIPitchR"], model_p["idlerY"] + d["idlerEffR"], slot_y_max, y_pad) + margin
        ax.set_xlim(min_x, max_x)
        ax.set_ylim(min_y, max_y)

        self.update_readout(p, d, sol)
        self.canvas.draw_idle()

    def update_readout(self, p: Dict[str, float], d: Dict[str, float], sol: BeltSolution):
        target = d["beltPitchLength"]
        teeth_error = d["beltTeethError"]
        tooth_line = f"Implied belt teeth: {d['beltTeethExact']:.3f}"
        if math.isfinite(teeth_error) and abs(teeth_error) < 1e-6:
            tooth_line += f" ({int(d['beltTeethRounded'])}T)"
        else:
            tooth_line += " (not an integer tooth count)"

        travel_half = p["tension_slot_travel_mm"] / 2
        offset_warning = abs(p["tension_offset_mm"]) > travel_half + 1e-9 if p["tension_slot_travel_mm"] >= 0 else False
        lines = [
            f"Belt profile: {self.belt_type_var.get()}",
            f"Belt pitch: {p['belt_pitch_mm']:.3f} mm",
            f"Belt pitch length: {target:.3f} mm",
            tooth_line,
            "",
            f"Ratio: {d['ratio']:.3f}:1",
            f"Input pitch dia: {d['pulleyIPitchDia']:.3f} mm",
            f"Output pitch dia: {d['pulleyOPitchDia']:.3f} mm",
            f"Idler OD: {2*d['idlerEffR']:.3f} mm",
            "",
            f"Neutral idler Y: {d['idlerYNominal']:.3f} mm" if d["idlerYNominal"] is not None else "Neutral idler Y: unsolved",
            f"Current idler Y: {d['idlerYActual']:.3f} mm",
            f"Tension offset: {p['tension_offset_mm']:+.3f} mm of +/-{travel_half:.3f} mm",
            f"Model belt length at current offset: {d['modelBeltLength']:.3f} mm",
            f"Length residual at current offset: {d['beltResidual']:+.3f} mm",
            f"Line length: {d['lineLength']:.3f} mm",
            f"Arc length: {d['arcLength']:.3f} mm",
            "",
            f"Center I-O: {d['centerIO']:.3f} mm",
            f"Center I-idler: {d['centerIIdler']:.3f} mm",
            f"Center O-idler: {d['centerOIdler']:.3f} mm",
            f"Idler span: {d['idlerSpan']:.3f} mm",
            f"Solve candidates: {len(self.idler_y_candidates)}",
            "",
        ]
        warnings = []
        if math.isfinite(teeth_error) and abs(teeth_error) >= 1e-6:
            warnings.append("Belt length is not an integer multiple of belt pitch.")
        if offset_warning:
            warnings.append("Tension offset is outside half of the configured slot travel.")
        if d["clearanceWarnings"]:
            warnings.append("Clearance below minimum: " + "; ".join(d["clearanceWarnings"]))
        if warnings:
            lines += ["Warnings:"] + [f"  {warning}" for warning in warnings] + [""]
        if self.layout_error is not None:
            lines += ["Invalid selected belt:", self.layout_error]
        elif sol.valid:
            lines += ["Wrap angles:"]
            for k, v in sol.wrap_deg.items():
                lines.append(f"  {k}: {v:.1f} deg")
        else:
            lines.append(f"Invalid: {sol.reason}")

        self.readout.configure(state="normal")
        self.readout.delete("1.0", tk.END)
        self.readout.insert(tk.END, "\n".join(lines))
        self.readout.yview_moveto(0.0)
        self.readout.configure(state="disabled")

    def fusion_rows(self) -> List[Tuple[str, str, str, str]]:
        p = self.params()
        model_p = self.model_params(p)
        sol = BeltModel.belt_solution(model_p)
        d = self.derived(p, model_p, sol)

        def mm(v: float) -> str:
            return f"{v:.4f} mm"

        belt_type = self.belt_type_var.get()
        belt_type_codes = {name: i + 1 for i, name in enumerate(BELT_PITCH_PRESETS)}
        belt_type_code = belt_type_codes.get(belt_type, 0)
        belt_type_comment = "GUI belt profile: " + belt_type + ". 0=Custom, 1=GT2, 2=GT3, 3=HTD-3M, 4=HTD-5M."
        nominal_y = d["idlerYNominal"] if d["idlerYNominal"] is not None else model_p["idlerY"]

        rows = [
            ("belt_profile_code", "No Units", str(belt_type_code), belt_type_comment),
            ("belt_pitch_mm", "mm", mm(p["belt_pitch_mm"]), "Timing belt tooth pitch."),
            ("belt_length_mm", "mm", mm(p["belt_length_mm"]), "Closed-loop belt pitch length."),
            ("belt_teeth_exact", "No Units", "belt_length_mm/belt_pitch_mm", "Implied closed belt tooth count; should be an integer for real belts."),
            ("pulleyI_teeth", "No Units", str(int(round(p["pulleyI_teeth"]))), "Input/motor timing pulley tooth count."),
            ("pulleyO_teeth", "No Units", str(int(round(p["pulleyO_teeth"]))), "Output timing pulley tooth count."),
            ("ratio", "No Units", "pulleyO_teeth/pulleyI_teeth", "Reduction ratio."),
            ("pulleyI_pitch_dia_mm", "mm", "pulleyI_teeth*belt_pitch_mm/PI", "Input pulley pitch diameter."),
            ("pulleyO_pitch_dia_mm", "mm", "pulleyO_teeth*belt_pitch_mm/PI", "Output pulley pitch diameter."),
            ("pulleyI_pitch_r_mm", "mm", "pulleyI_pitch_dia_mm/2", "Input pulley pitch radius."),
            ("pulleyO_pitch_r_mm", "mm", "pulleyO_pitch_dia_mm/2", "Output pulley pitch radius."),
            ("idler_OD_mm", "mm", mm(p["idler_OD_mm"]), "Smooth backside idler outside diameter."),
            ("idler_r_mm", "mm", "idler_OD_mm/2", "Smooth idler physical radius."),
            ("center_IO_mm", "mm", mm(p["center_IO_mm"]), "Vertical center distance between output and input pulley."),
            ("idler_x_offset_mm", "mm", mm(p["idler_x_offset_mm"]), "Horizontal half-spacing from centerline to either idler."),
            ("tension_slot_travel_mm", "mm", mm(p["tension_slot_travel_mm"]), "Total travel range of the shared idler pod."),
            ("tension_offset_mm", "mm", mm(p["tension_offset_mm"]), "Current idler-pod displacement from the solved neutral position."),
            ("belt_visual_thickness_mm", "mm", mm(p["belt_visual_thickness_mm"]), "Visual belt thickness in the 2D drawing only."),
            ("minimum_clearance_mm", "mm", mm(p["minimum_clearance_mm"]), "Clearance warning threshold between 2D circular parts."),
            ("output_x_mm", "mm", "0 mm", "Output pulley center X. Layout origin."),
            ("output_y_mm", "mm", "0 mm", "Output pulley center Y. Layout origin."),
            ("input_x_mm", "mm", "0 mm", "Input pulley center X. Symmetry centerline."),
            ("input_y_mm", "mm", "center_IO_mm", "Input pulley center Y above output."),
            ("idler_y_nominal_mm", "mm", mm(nominal_y), "Solved idler Y at zero tension offset."),
            ("idler_y_mm", "mm", "idler_y_nominal_mm+tension_offset_mm", "Current shared idler Y coordinate."),
            ("idler1_x_mm", "mm", "-idler_x_offset_mm", "Left idler center X."),
            ("idler1_y_mm", "mm", "idler_y_mm", "Left idler center Y."),
            ("idler2_x_mm", "mm", "idler_x_offset_mm", "Right idler center X."),
            ("idler2_y_mm", "mm", "idler_y_mm", "Right idler center Y."),
            ("center_I_idler_mm", "mm", mm(d["centerIIdler"]), "Computed center distance from input pulley to either idler at current offset."),
            ("center_O_idler_mm", "mm", mm(d["centerOIdler"]), "Computed center distance from output pulley to either idler at current offset."),
            ("idler_span_mm", "mm", "2*idler_x_offset_mm", "Distance between the two idler centers."),
            ("motor_mount_hole_spacing_mm", "mm", "31 mm", "NEMA17 mounting hole spacing."),
            ("motor_screw_clearance_dia_mm", "mm", "3.4 mm", "M3 clearance hole."),
            ("motor_pilot_clearance_dia_mm", "mm", "23 mm", "Typical NEMA17 pilot clearance; verify your motor."),
            ("output_shaft_dia_mm", "mm", "8 mm", "Output shaft placeholder."),
            ("output_bearing_OD_mm", "mm", "16 mm", "Output bearing OD placeholder, e.g. 688 bearing."),
            ("output_bearing_width_mm", "mm", "5 mm", "Output bearing width placeholder."),
            ("idler_bolt_dia_mm", "mm", "5 mm", "Idler bearing mounting bolt diameter placeholder."),
            ("idler_bolt_clearance_dia_mm", "mm", "idler_bolt_dia_mm+0.4 mm", "Idler bolt clearance hole."),
            ("slot_length_mm", "mm", "tension_slot_travel_mm+idler_bolt_dia_mm", "Idler tension slot length."),
            ("slot_width_mm", "mm", "idler_bolt_clearance_dia_mm", "Idler tension slot width."),
            ("model_belt_length_mm", "mm", mm(d["modelBeltLength"]), "Computed belt length from tangent model at current tension offset; diagnostic only."),
            ("belt_residual_mm", "mm", mm(d["beltResidual"]), "model_belt_length_mm - belt_length_mm; should be near 0 at zero tension offset."),
        ]
        return rows

    def export_csv_dialog(self):
        path = filedialog.asksaveasfilename(
            title="Export Fusion parameter CSV",
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
            initialfile="belt_actuator_parameters.csv",
        )
        if not path:
            return
        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(self.fusion_rows())
            self.status_var.set(f"Exported: {path}")
            messagebox.showinfo("Export complete", f"Wrote Fusion parameter CSV:\n{path}")
        except OSError as e:
            messagebox.showerror("Export failed", str(e))


if __name__ == "__main__":
    app = ActuatorGUI()
    app.mainloop()
