#!/usr/bin/env python3
"""Display-name / Arabic translation checks for NOZOM POS branding."""

from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
	sys.path.insert(0, str(ROOT))


def _ar_map() -> dict[str, str]:
	path = ROOT / "nozom_pos" / "translations" / "ar.csv"
	with path.open(encoding="utf-8") as handle:
		rows = list(csv.reader(handle))
	return {row[0]: row[1] for row in rows if len(row) >= 2 and row[0] and row[0] != "Source Text"}


class PosDisplayTranslationTests(unittest.TestCase):
	def test_brand_stays_english(self):
		ar = _ar_map()
		self.assertEqual(ar.get("NOZOM POS"), "NOZOM POS")

	def test_workspace_and_sidebar_labels_translated(self):
		ar = _ar_map()
		self.assertEqual(ar.get("Sales Invoices"), "فواتير المبيعات")
		self.assertEqual(ar.get("Daily POS Sales"), "مبيعات نقاط البيع اليومية")
		self.assertEqual(ar.get("Open NOZOM POS"), "فتح NOZOM POS")
		self.assertEqual(ar.get("POS Opening Entries"), "قيود فتح نقطة البيع")
		self.assertEqual(ar.get("POS Closing Entries"), "قيود إقفال نقطة البيع")


if __name__ == "__main__":
	unittest.main()
