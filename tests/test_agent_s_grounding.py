"""Unit tests for Agent-S grounding coordinate parsing."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.agent_s.grounding import parse_grounding_response
from services.agent_s.playwright_browser_aci import PlaywrightBrowserACI


class TestGroundingParse(unittest.TestCase):
    def test_point_tag(self):
        self.assertEqual(parse_grounding_response("<point>960,540</point>"), (960, 540))

    def test_paren_pair(self):
        self.assertEqual(parse_grounding_response("click at (100, 200)"), (100, 200))

    def test_json_object(self):
        self.assertEqual(parse_grounding_response('{"x": 50, "y": 75}'), (50, 75))


class TestCoordScale(unittest.TestCase):
    def test_scale_to_viewport(self):
        aci = PlaywrightBrowserACI(
            page=None,
            viewport_width=1280,
            viewport_height=800,
            ground_width=1920,
            ground_height=1080,
        )
        x, y = aci.scale_coords(960, 540)
        self.assertAlmostEqual(x, 640.0)
        self.assertAlmostEqual(y, 400.0)


if __name__ == "__main__":
    unittest.main()
