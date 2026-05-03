"""Pure geometry solver for the symmetric belted NEMA17 actuator layout."""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

Point = Tuple[float, float]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BELT_PITCH_PRESETS: Dict[str, float] = {
    "GT2": 2.0,
    "GT3": 3.0,
    "HTD-3M": 3.0,
    "HTD-5M": 5.0,
}

CUSTOM_BELT_TYPE = "Custom"

# Offset from the physical back surface of the belt to the pitch line.
# Non-zero for profiles where the pitch line is not at the belt surface
# (e.g. fibre-cord GT2/GT3 belts). Set per-profile if needed.
BELT_BACK_TO_PITCH: float = 0.0


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

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


def sample_arc(
    center: Point,
    radius: float,
    a0: float,
    a1: float,
    direction: int,
    n: int = 48,
) -> List[Point]:
    travel = unwrap_to_direction(a0, a1, direction)
    return [
        (
            center[0] + radius * math.cos(a0 + travel * i / max(1, n - 1)),
            center[1] + radius * math.sin(a0 + travel * i / max(1, n - 1)),
        )
        for i in range(n)
    ]


def tangent_vector(center: Point, point: Point, direction: int) -> Point:
    radial = unit(sub(point, center))
    if direction >= 0:
        return (-radial[1], radial[0])
    return (radial[1], -radial[0])


def tangent_options(
    c1: Point,
    r1: float,
    c2: Point,
    r2: float,
    internal: bool = False,
) -> List[Tuple[Point, Point]]:
    """Return tangent-point pairs between two circles.

    External tangents are used for the normal outside belt path.  Internal
    tangents are also enumerated because tightly packed layouts can otherwise
    leave no continuous candidate.
    """
    v = sub(c2, c1)
    d = norm(v)
    if d <= 1e-9:
        return []

    side = -1.0 if internal else 1.0
    c = (r1 - side * r2) / d
    if abs(c) > 1.0:
        return []

    vx, vy = v[0] / d, v[1] / d
    h = math.sqrt(max(0.0, 1.0 - c * c))

    out: List[Tuple[Point, Point]] = []
    for s in (-1.0, 1.0):
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
        return (
            min(p[0], r[0]) - 1e-9 <= q[0] <= max(p[0], r[0]) + 1e-9
            and min(p[1], r[1]) - 1e-9 <= q[1] <= max(p[1], r[1]) + 1e-9
        )

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


def point_segment_distance(p: Point, a: Point, b: Point) -> float:
    ab = sub(b, a)
    denom = dot(ab, ab)
    if denom <= 1e-18:
        return norm(sub(p, a))

    t = max(0.0, min(1.0, dot(sub(p, a), ab) / denom))
    q = add(a, mul(ab, t))
    return norm(sub(p, q))


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Belt model (pure geometry, no UI dependency)
# ---------------------------------------------------------------------------

class BeltModel:
    """Symmetric pulley/idler belt model.

    Fixed contact order: input -> right idler -> output -> left idler -> input.
    Pulleys contact the toothed side; idlers contact the flat backside.
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
        r_id = params["idlerOD"] / 2 + params.get("beltBackToPitch", BELT_BACK_TO_PITCH)
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

        # Collect tangent options for each consecutive circle pair.
        edge_options: List[List[Tuple[Point, Point]]] = []
        for i in range(n):
            a = circles[i]
            b = circles[(i + 1) % n]
            opts = tangent_options(a.center, a.radius, b.center, b.radius, internal=False)
            opts += tangent_options(a.center, a.radius, b.center, b.radius, internal=True)
            if not opts:
                return BeltSolution(
                    math.inf, math.inf, math.inf, [], {}, {}, False,
                    "No tangent solution: circles overlap or are too close.",
                )
            edge_options.append(opts)

        best: Optional[Tuple[float, BeltSolution]] = None

        # Enumerate all combinations of tangent choices via itertools.product.
        for edges in itertools.product(*edge_options):
            dirs: Dict[str, int] = {}
            continuous = True

            for k, c in enumerate(circles):
                incoming_start, incoming_point = edges[(k - 1) % n]
                outgoing_point, outgoing_end = edges[k]
                incoming_vec = unit(sub(incoming_point, incoming_start))
                outgoing_vec = unit(sub(outgoing_end, outgoing_point))

                matching_dirs = [
                    direction
                    for direction in (1, -1)
                    if (
                        dot(incoming_vec, tangent_vector(c.center, incoming_point, direction)) > 0.999
                        and dot(outgoing_vec, tangent_vector(c.center, outgoing_point, direction)) > 0.999
                    )
                ]
                if not matching_dirs:
                    continuous = False
                    break
                dirs[c.name] = matching_dirs[0]

            if not continuous:
                continue

            # Toothed pulleys must wrap the same way; backside idlers must wrap opposite.
            if dirs["pulleyI"] != dirs["pulleyO"]:
                continue
            if dirs["idler1"] != -dirs["pulleyI"] or dirs["idler2"] != -dirs["pulleyI"]:
                continue

            # Reject any combination where spans cross.
            crossed = any(
                segment_intersection(edges[i][0], edges[i][1], edges[j][0], edges[j][1])
                for i in range(n)
                for j in range(i + 1, n)
            )
            if crossed:
                continue

            # A straight belt span may only touch its two endpoint circles.
            # Reject candidates where the span passes through any other
            # pulley/idler disk; line-line crossing alone does not catch this.
            obstructed = any(
                point_segment_distance(other.center, edges[i][0], edges[i][1]) < other.radius - 1e-9
                for i in range(n)
                for other in circles
                if other.name not in (circles[i].name, circles[(i + 1) % n].name)
            )
            if obstructed:
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

            sol = BeltSolution(line_len + arc_len, line_len, arc_len, list(edges), arcs, wraps, True, "OK")
            score = (
                wraps["pulleyO"]
                + wraps["pulleyI"]
                + 0.25 * (wraps["idler1"] + wraps["idler2"])
            )
            if best is None or score > best[0]:
                best = (score, sol)

        if best is None:
            return BeltSolution(
                math.inf, math.inf, math.inf, [], {}, {}, False,
                "No valid backside-idler belt path found without span crossings or unintended pulley/idler contact.",
            )
        return best[1]

    @staticmethod
    def solve_idler_x(
        params: Dict[str, float],
        x_min: float = 1.0,
        x_max: float = 250.0,
    ) -> Tuple[Optional[float], str]:
        """Solve for idlerX that matches the target belt length."""
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
                prev_x = prev_f = None
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
            prev_x, prev_f = x, f

        if bracket is None:
            if min_valid is None or max_valid is None:
                return None, "No valid backside-idler belt path exists for this geometry."
            if target < min_valid[1]:
                return None, (
                    f"Selected belt is too short. "
                    f"Shortest valid path found is {min_valid[1]:.3f} mm at idlerX {min_valid[0]:.3f} mm."
                )
            if target > max_valid[1]:
                return None, (
                    f"Selected belt is too long. "
                    f"Longest valid path found is {max_valid[1]:.3f} mm at idlerX {max_valid[0]:.3f} mm."
                )
            return None, (
                "Could not solve idlerX for this belt length without crossing, unintended contact, or wrong-side idler wrap. "
                "Change belt length, belt type, motorY, idlerY, or pulley/idler sizes."
            )

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
        """Solve for idlerY that matches the target belt length.

        Returns (best_y, all_candidates, message).  Multiple valid Y values
        are possible; the one that maximises wrap angle while staying compact
        is returned as the first element.
        """
        target = BeltModel.target_length(params)
        center_y = params["motorY"]
        idler_x = params["idlerX"]

        max_radius = max(
            params["pulleyITeeth"] * params["beltPitch"] / math.pi / 2,
            params["pulleyOTeeth"] * params["beltPitch"] / math.pi / 2,
            params["idlerOD"] / 2 + params.get("beltBackToPitch", BELT_BACK_TO_PITCH),
        )
        span = max(target / 2, abs(center_y), abs(idler_x), max_radius) + 50.0
        lo_limit = (min(0.0, center_y) - span) if y_min is None else y_min
        hi_limit = (max(0.0, center_y) + span) if y_max is None else y_max

        def residual(y: float) -> float:
            p = dict(params)
            p["idlerY"] = y
            return BeltModel.belt_solution(p).length - target

        def finite_residual(y: float) -> Optional[float]:
            f = residual(y)
            return f if math.isfinite(f) else None

        def refine(a: float, b: float, f_a: float) -> Optional[float]:
            lo, hi, flo = a, b, f_a
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
                    lo, flo = mid, fmid
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
                prev_y = prev_f = None
                continue

            length = f + target
            if min_valid is None or length < min_valid[1]:
                min_valid = (y, length)
            if max_valid is None or length > max_valid[1]:
                max_valid = (y, length)

            if abs(f) < 1e-9:
                roots.append(y)
            elif prev_y is not None and prev_f is not None and prev_f * f <= 0:
                root = refine(prev_y, y, prev_f)
                if root is not None:
                    roots.append(root)
            prev_y, prev_f = y, f

        # Deduplicate roots that landed within floating-point noise of each other.
        deduped: List[float] = []
        for y in sorted(roots):
            if not deduped or abs(y - deduped[-1]) > 1e-5:
                deduped.append(y)

        if not deduped:
            if min_valid is None or max_valid is None:
                return None, [], "No valid backside-idler belt path exists for this geometry."
            if target < min_valid[1]:
                return None, [], (
                    f"Selected belt is too short. "
                    f"Shortest valid path found is {min_valid[1]:.3f} mm at idlerY {min_valid[0]:.3f} mm."
                )
            if target > max_valid[1]:
                return None, [], (
                    f"Selected belt is too long. "
                    f"Longest valid path found is {max_valid[1]:.3f} mm at idlerY {max_valid[0]:.3f} mm."
                )
            return None, [], "Could not solve idlerY for this belt length without crossing, unintended contact, or wrong-side idler wrap."

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
