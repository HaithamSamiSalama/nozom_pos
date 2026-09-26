import os

import frappe
from frappe.translate import get_all_translations, get_translation_dict_from_file

BRAND = "NOZOM POS"


def _load_app_csv(lang: str) -> dict:
	csv_path = frappe.get_app_path("nozom_pos", "translations", f"{lang}.csv")
	if not os.path.exists(csv_path):
		return {}
	return get_translation_dict_from_file(csv_path, lang, "nozom_pos") or {}


@frappe.whitelist()
def get_pos_messages(lang="en"):
	"""
	Return translation messages for POS presentation only.
	Does not change User language or Desk preference.

	Arabic: full language dict + fresh nozom_pos CSV overlay (last-wins).
	English: identity map of Arabic CSV keys so POS can force English source
	text even when Desk language is Arabic.
	"""
	lang = (lang or "en").strip().lower()[:2]
	if lang not in ("en", "ar"):
		lang = "en"

	ar_csv = _load_app_csv("ar")
	en_csv = _load_app_csv("en")

	if lang == "ar":
		messages = dict(get_all_translations("ar") or {})
		messages.update(ar_csv)
	else:
		# Identity for every known POS/Arabic CSV key → English source text
		messages = {key: key for key in ar_csv.keys()}
		messages.update(en_csv)

	messages[BRAND] = BRAND
	return messages
