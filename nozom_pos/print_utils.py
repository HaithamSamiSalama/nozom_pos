"""NOZOM POS print helpers (Jinja-safe)."""

from __future__ import annotations

from base64 import b64encode
from io import BytesIO

import frappe
from frappe.utils import cstr


ALLOWED_URL_SCHEMES = ("http://", "https://")


def get_pos_profile_print_logo(pos_profile: str | None) -> str:
	"""Return the configured receipt logo for a POS Profile."""
	pos_profile = cstr(pos_profile).strip()
	if not pos_profile:
		return ""

	logo = cstr(
		frappe.db.get_value("POS Profile", pos_profile, "nozom_print_logo") or ""
	).strip()

	if not logo:
		return ""

	if logo.startswith(("http://", "https://")):
		return logo

	return frappe.utils.get_url(logo)


DEFAULT_LOGO_HEIGHT_PX = 55
MIN_LOGO_HEIGHT_PX = 20
MAX_LOGO_HEIGHT_PX = 120


def get_pos_profile_print_logo_max_height(pos_profile: str | None) -> str:
	"""Return CSS max-height for POS Profile receipt logo based on nozom_print_logo_size."""
	from frappe.utils import cint

	pos_profile = cstr(pos_profile).strip()
	if not pos_profile:
		return f"{DEFAULT_LOGO_HEIGHT_PX}px"

	val_raw = frappe.db.get_value("POS Profile", pos_profile, "nozom_print_logo_size")
	try:
		val = cint(val_raw)
	except Exception:
		val = DEFAULT_LOGO_HEIGHT_PX

	if val < MIN_LOGO_HEIGHT_PX or val > MAX_LOGO_HEIGHT_PX:
		val = DEFAULT_LOGO_HEIGHT_PX

	return f"{val}px"


def get_company_tax_id(company: str | None) -> str:
	"""Return Company Tax ID for POS receipt."""
	company = cstr(company).strip()
	if not company:
		return ""
	return cstr(frappe.db.get_value("Company", company, "tax_id") or "").strip()


def get_cashier_name(doc_or_owner) -> str:
	"""Return human-readable Cashier display name from User or Employee, with email fallback."""
	if not doc_or_owner:
		return ""

	owner = getattr(doc_or_owner, "owner", None) if hasattr(doc_or_owner, "owner") else doc_or_owner
	if isinstance(owner, dict):
		owner = owner.get("owner")
	owner = cstr(owner).strip()
	if not owner:
		return ""

	# 1. Lookup User full_name / first_name
	user_row = frappe.db.get_value(
		"User", owner, ["full_name", "first_name", "last_name"], as_dict=True
	)
	if user_row:
		full_name = cstr(user_row.get("full_name") or "").strip()
		if not full_name:
			first = cstr(user_row.get("first_name") or "").strip()
			last = cstr(user_row.get("last_name") or "").strip()
			full_name = f"{first} {last}".strip()
		if full_name and full_name.lower() != owner.lower():
			return full_name

	# 2. Lookup Employee linked to user_id
	emp_name = frappe.db.get_value("Employee", {"user_id": owner}, "employee_name")
	if emp_name and cstr(emp_name).strip():
		return cstr(emp_name).strip()

	# 3. Standard Frappe get_fullname helper
	fn = cstr(frappe.utils.get_fullname(owner)).strip()
	if fn and fn.lower() != owner.lower():
		return fn

	# 4. Safe fallback to owner string
	return owner


def is_safe_location_url(url: str | None) -> bool:
	value = cstr(url).strip()
	if not value:
		return False
	lower = value.lower()
	if not lower.startswith(ALLOWED_URL_SCHEMES):
		return False
	if lower.startswith(("javascript:", "data:", "vbscript:", "file:")):
		return False
	return True


def sanitize_location_url(url: str | None) -> str:
	value = cstr(url).strip()
	return value if is_safe_location_url(value) else ""


def get_delivery_location_qr_svg(url: str | None, scale: int = 3) -> str:
	"""
	Return inline SVG markup for a delivery-location QR code.
	Empty string when URL missing/unsafe — print formats should hide the section.
	"""
	safe = sanitize_location_url(url)
	if not safe:
		return ""

	from pyqrcode import create as qrcreate

	stream = BytesIO()
	try:
		qrcreate(safe).svg(stream, scale=max(2, int(scale or 3)), quiet_zone=2)
		svg = stream.getvalue().decode().replace("\n", "")
	finally:
		stream.close()
	return svg


def get_delivery_location_qr_img(url: str | None, scale: int = 3) -> str:
	"""Return a data-URI <img> for environments that prefer images over raw SVG."""
	svg = get_delivery_location_qr_svg(url, scale=scale)
	if not svg:
		return ""
	b64 = b64encode(svg.encode()).decode()
	return f'<img alt="Delivery Location QR" src="data:image/svg+xml;base64,{b64}" style="width:28mm;height:28mm;" />'


def format_delivery_address_line(title: str | None, address_text: str | None) -> str:
	title = cstr(title).strip()
	address_text = format_address_plain(address_text, joiner=", ")
	if title and address_text:
		return f"{title} — {address_text}"
	return title or address_text


def format_address_plain(address_html: str | None, joiner: str = "\n") -> str:
	"""Convert address_display HTML (<br>, tags) into plain readable text."""
	import re

	raw = cstr(address_html)
	if not raw:
		return ""
	text = raw.replace("\r\n", "\n")
	text = re.sub(r"<\s*br\s*/?\s*>", "\n", text, flags=re.IGNORECASE)
	text = re.sub(r"</\s*p\s*>", "\n", text, flags=re.IGNORECASE)
	text = re.sub(r"</\s*div\s*>", "\n", text, flags=re.IGNORECASE)
	text = re.sub(r"<[^>]+>", "", text)
	text = (
		text.replace("&nbsp;", " ")
		.replace("&amp;", "&")
		.replace("&lt;", "<")
		.replace("&gt;", ">")
		.replace("&#39;", "'")
		.replace("&quot;", '"')
	)
	lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
	return joiner.join([line for line in lines if line])


def payment_status_key(doc) -> str:
	"""Authoritative payment status from invoice amounts."""
	from frappe.utils import flt

	if cint(getattr(doc, "is_return", 0)):
		return "Return"
	total = flt(getattr(doc, "rounded_total", None)) or flt(getattr(doc, "grand_total", 0))
	paid = flt(getattr(doc, "paid_amount", 0))
	outstanding = flt(getattr(doc, "outstanding_amount", 0))
	if outstanding < 0:
		outstanding = 0
	if outstanding <= 0.0001:
		return "Fully Paid"
	if paid <= 0.0001:
		return "Unpaid"
	return "Partially Paid"


def payment_status_label(doc) -> str:
	key = payment_status_key(doc)
	labels = {
		"Fully Paid": "Fully Paid / مدفوع بالكامل",
		"Partially Paid": "Partially Paid / مدفوع جزئيا",
		"Unpaid": "Unpaid / غير مدفوع",
		"Return": "Return / مرتجع",
	}
	return labels.get(key, key)


def cint(val):
	from frappe.utils import cint as _cint

	return _cint(val)


def get_receipt_remaining_formatted(doc) -> str:
	"""Return formatted remaining/outstanding amount for receipt (never negative)."""
	from frappe.utils import flt

	rem = flt(getattr(doc, "outstanding_amount", 0))
	if rem > 0.0001:
		return doc.get_formatted("outstanding_amount")
	try:
		return frappe.format_value(0, df=doc.meta.get_field("outstanding_amount"), doc=doc)
	except Exception:
		curr = getattr(doc, "currency", None) or frappe.db.get_default("currency")
		return frappe.utils.fmt_money(0, currency=curr)
