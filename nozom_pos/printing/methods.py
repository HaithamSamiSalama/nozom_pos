"""Printing Method resolution for POS Profile.

Default is always Browser Printing for backward compatibility.
"""

from __future__ import annotations

from frappe.utils import cstr

METHOD_BROWSER = "Browser Printing"
METHOD_WINDOWS = "Windows Printing"
METHOD_NOZOM_PRINT = "NOZOM Print"

ALLOWED_METHODS = frozenset({METHOD_BROWSER, METHOD_WINDOWS, METHOD_NOZOM_PRINT})

# Select field options (newline-separated for Custom Field).
PRINTING_METHOD_OPTIONS = "\n".join(
	[METHOD_BROWSER, METHOD_WINDOWS, METHOD_NOZOM_PRINT]
)

# Legacy / alternate spellings → canonical.
_ALIASES = {
	"browser": METHOD_BROWSER,
	"browser printing": METHOD_BROWSER,
	"browser_printing": METHOD_BROWSER,
	"windows": METHOD_WINDOWS,
	"windows printing": METHOD_WINDOWS,
	"windows_printing": METHOD_WINDOWS,
	"kiosk": METHOD_WINDOWS,
	"nozom print": METHOD_NOZOM_PRINT,
	"nozom_print": METHOD_NOZOM_PRINT,
	"silent": METHOD_NOZOM_PRINT,
}


def normalize_printing_method(value: str | None) -> str:
	"""Return a canonical Printing Method. Blank/unknown → Browser Printing."""
	raw = cstr(value or "").strip()
	if not raw:
		return METHOD_BROWSER
	if raw in ALLOWED_METHODS:
		return raw
	mapped = _ALIASES.get(raw.lower())
	if mapped:
		return mapped
	return METHOD_BROWSER


def resolve_printing_method(pos_profile_doc_or_dict=None, *, raw_value: str | None = None) -> str:
	"""Resolve Printing Method from a POS Profile row or an explicit value."""
	if raw_value is not None:
		return normalize_printing_method(raw_value)
	if not pos_profile_doc_or_dict:
		return METHOD_BROWSER
	if isinstance(pos_profile_doc_or_dict, dict):
		value = pos_profile_doc_or_dict.get("nozom_printing_method")
	else:
		value = pos_profile_doc_or_dict.get("nozom_printing_method")
	return normalize_printing_method(value)
