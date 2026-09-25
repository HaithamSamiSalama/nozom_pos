import os

import frappe
from frappe.translate import get_all_translations, get_translation_dict_from_file


@frappe.whitelist()
def get_pos_messages(lang="en"):
	"""
	Return translation messages for POS presentation only.
	Does not change User language or Desk preference.

	Always overlays a fresh read of nozom_pos/translations/{lang}.csv
	so local CSV edits apply even when Frappe's merged translation cache
	is stale.
	"""
	lang = (lang or "en").strip().lower()[:2]
	if lang not in ("en", "ar"):
		lang = "en"

	messages = dict(get_all_translations(lang) or {})

	# Fresh app CSV overlay (last-wins for NOZOM POS custom strings)
	csv_path = frappe.get_app_path("nozom_pos", "translations", f"{lang}.csv")
	if os.path.exists(csv_path):
		overlay = get_translation_dict_from_file(csv_path, lang, "nozom_pos") or {}
		messages.update(overlay)

	return messages
