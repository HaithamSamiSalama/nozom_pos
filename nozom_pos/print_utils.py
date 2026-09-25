"""NOZOM POS print helpers (Jinja-safe)."""

from __future__ import annotations

from base64 import b64encode
from io import BytesIO

import frappe
from frappe.utils import cstr


ALLOWED_URL_SCHEMES = ("http://", "https://")


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
