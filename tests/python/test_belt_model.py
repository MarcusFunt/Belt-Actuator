import math
import unittest

from belted_actuator_gui import BeltModel, segment_intersection, tangent_options


DEFAULT_MODEL = {
    "beltPitch": 2.0,
    "beltLength": 264.0,
    "pulleyITeeth": 20,
    "pulleyOTeeth": 60,
    "idlerOD": 22.0,
    "beltBackToPitch": 0.0,
    "motorY": 90.0,
    "idlerX": 20.0,
    "idlerY": 0.0,
}

GT3_VARIANT = {
    "beltPitch": 3.0,
    "beltLength": 373.0,
    "pulleyITeeth": 18,
    "pulleyOTeeth": 72,
    "idlerOD": 24.0,
    "beltBackToPitch": 0.0,
    "motorY": 115.0,
    "idlerX": 32.0,
    "idlerY": 0.0,
}


class GeometryHelperTests(unittest.TestCase):
    def test_tangent_options_place_points_on_each_circle(self):
        options = tangent_options((0.0, 0.0), 5.0, (20.0, 0.0), 3.0)

        self.assertEqual(len(options), 2)
        for p1, p2 in options:
            self.assertAlmostEqual(math.hypot(p1[0], p1[1]), 5.0, places=9)
            self.assertAlmostEqual(math.hypot(p2[0] - 20.0, p2[1]), 3.0, places=9)

    def test_segment_intersection_handles_crossing_and_separate_segments(self):
        self.assertTrue(segment_intersection((0, 0), (10, 10), (0, 10), (10, 0)))
        self.assertFalse(segment_intersection((0, 0), (2, 0), (3, 0), (5, 0)))


class BeltModelTests(unittest.TestCase):
    def test_circles_use_expected_symmetry_and_pitch_radii(self):
        circles = {circle.name: circle for circle in BeltModel.circles(DEFAULT_MODEL)}

        self.assertEqual(circles["pulleyI"].center, (0.0, 90.0))
        self.assertEqual(circles["pulleyO"].center, (0.0, 0.0))
        self.assertEqual(circles["idler1"].center, (-20.0, 0.0))
        self.assertEqual(circles["idler2"].center, (20.0, 0.0))
        self.assertAlmostEqual(circles["pulleyI"].radius, 20 * 2.0 / math.pi / 2, places=12)
        self.assertAlmostEqual(circles["pulleyO"].radius, 60 * 2.0 / math.pi / 2, places=12)
        self.assertAlmostEqual(circles["idler1"].radius, 11.0, places=12)

    def test_default_idler_y_solution_matches_target_belt_length(self):
        y, candidates, message = BeltModel.solve_idler_y(DEFAULT_MODEL)

        self.assertEqual(message, "OK")
        self.assertEqual(len(candidates), 1)
        self.assertAlmostEqual(y, 29.26314942270517, places=9)

        solution = BeltModel.belt_solution({**DEFAULT_MODEL, "idlerY": y})
        self.assertTrue(solution.valid, solution.reason)
        self.assertAlmostEqual(solution.length, DEFAULT_MODEL["beltLength"], places=6)
        self.assertAlmostEqual(solution.line_length, 160.52169094968426, places=6)
        self.assertAlmostEqual(solution.arc_length, 103.47830904957603, places=6)
        self.assertAlmostEqual(solution.wrap_deg["pulleyI"], 175.06430426402358, places=6)
        self.assertAlmostEqual(solution.wrap_deg["pulleyO"], 227.54116840506592, places=6)

    def test_alternate_pitch_and_pulley_fixture_solves(self):
        y, candidates, message = BeltModel.solve_idler_y(GT3_VARIANT)

        self.assertEqual(message, "OK")
        self.assertEqual(len(candidates), 1)
        self.assertAlmostEqual(y, 38.2216779232025, places=9)

        solution = BeltModel.belt_solution({**GT3_VARIANT, "idlerY": y})
        self.assertTrue(solution.valid, solution.reason)
        self.assertAlmostEqual(solution.length, GT3_VARIANT["beltLength"], places=6)

    def test_solve_idler_x_recovers_default_half_spacing(self):
        y, _, _ = BeltModel.solve_idler_y(DEFAULT_MODEL)
        x, message = BeltModel.solve_idler_x({**DEFAULT_MODEL, "idlerY": y})

        self.assertEqual(message, "OK")
        self.assertAlmostEqual(x, DEFAULT_MODEL["idlerX"], places=6)

    def test_too_short_and_too_long_belts_return_actionable_errors(self):
        too_short = {**DEFAULT_MODEL, "beltLength": 100.0}
        too_long = {**DEFAULT_MODEL, "beltLength": 1000.0}

        y_short, candidates_short, message_short = BeltModel.solve_idler_y(too_short)
        y_long, candidates_long, message_long = BeltModel.solve_idler_y(too_long)

        self.assertIsNone(y_short)
        self.assertEqual(candidates_short, [])
        self.assertIn("Selected belt is too short", message_short)
        self.assertIn("Shortest valid path found", message_short)

        self.assertIsNone(y_long)
        self.assertEqual(candidates_long, [])
        self.assertIn("Selected belt is too long", message_long)
        self.assertIn("Longest valid path found", message_long)


if __name__ == "__main__":
    unittest.main()
