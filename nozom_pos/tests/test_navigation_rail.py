#!/usr/bin/env python3
"""Targeted tests: NOZOM POS App Rail follows the working NOZOM Chqs pattern."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
	sys.path.insert(0, str(ROOT))


class PosNavigationRailTests(unittest.TestCase):
	def test_sidebar_app_matches_chqs_pattern(self):
		from nozom_pos import navigation

		self.assertEqual(navigation.SIDEBAR_APP, "erpnext")
		self.assertEqual(navigation.SIDEBAR_NAME, "NOZOM POS")
		self.assertEqual(navigation.HOST_APP, "erpnext")
		self.assertEqual(navigation.DOCK_ICON, "/assets/nozom_pos/images/nozom-pos.svg")
		self.assertEqual(navigation.CASHIER_URL, "/desk/nozom-pos/point-of-sale")
		self.assertTrue(callable(navigation.ensure_nozom_pos_navigation))
		self.assertTrue(callable(navigation.ensure_host_site_dock_pin))

	def test_dock_lands_on_workspace_home_not_cashier(self):
		from nozom_pos import navigation

		first = navigation.SIDEBAR_ITEMS[0]
		self.assertEqual(first["link_type"], "Workspace")
		self.assertEqual(first["link_to"], "NOZOM POS")
		open_btn = next(i for i in navigation.SIDEBAR_ITEMS if i["label"] == "Open NOZOM POS")
		self.assertEqual(open_btn["link_type"], "Page")
		self.assertEqual(open_btn["link_to"], "point-of-sale")
		self.assertTrue(open_btn.get("is_default_module"))

	def test_svg_asset_exists(self):
		svg = ROOT / "nozom_pos" / "public" / "images" / "nozom-pos.svg"
		self.assertTrue(svg.exists(), svg)
		text = svg.read_text(encoding="utf-8")
		self.assertIn("viewBox", text)
		self.assertIn("stroke", text)

	def test_install_wires_ensure_navigation(self):
		install = (ROOT / "nozom_pos" / "install.py").read_text(encoding="utf-8")
		self.assertIn("ensure_navigation", install)
		self.assertIn("ensure_nozom_pos_navigation", install)
		self.assertIn('/desk/nozom-pos/point-of-sale', install)

	def test_no_mount_on_companion_dock(self):
		from nozom_pos import navigation

		self.assertFalse(hasattr(navigation, "ensure_dock"))
		text = (ROOT / "nozom_pos" / "navigation.py").read_text(encoding="utf-8")
		self.assertNotIn('mount_on": "erpnext"', text)
		self.assertNotIn("mount_on='erpnext'", text)

	def test_pos_page_keeps_desk_navigation(self):
		pos_js = (ROOT / "nozom_pos" / "public" / "js" / "point_of_sale.js").read_text(encoding="utf-8")
		self.assertIn("hide_sidebar: false", pos_js)
		self.assertNotIn("sidebar.wrapper.hide()", pos_js)
		scss = (ROOT / "nozom_pos" / "public" / "scss" / "nozom_pos.bundle.scss").read_text(encoding="utf-8")
		self.assertNotIn("body-sidebar-container {\n        display: none", scss)
		self.assertIn("nozom-pos-dock-asset", scss)


if __name__ == "__main__":
	unittest.main()
