"""One-shot helper: sync POS RECEIPT print format from fixture."""

import json
from pathlib import Path

import frappe


def sync_pos_receipt():
	path = Path(frappe.get_app_path("nozom_pos")) / "fixtures" / "print_format.json"
	data = json.loads(path.read_text())
	for row in data:
		if row.get("name") != "POS RECEIPT":
			continue
		if frappe.db.exists("Print Format", "POS RECEIPT"):
			doc = frappe.get_doc("Print Format", "POS RECEIPT")
			doc.html = row["html"]
			doc.save(ignore_permissions=True)
		else:
			doc = frappe.get_doc({
				**row,
				"doctype": "Print Format",
				"name": "POS RECEIPT",
			})
			doc.insert(ignore_permissions=True)
		return {
			"ok": True,
			"html_len": len(doc.html),
			"has_qr": "get_delivery_location_qr_img" in doc.html,
			"has_phone": "nozom_customer_phone_snapshot" in doc.html,
		}
	return {"ok": False, "message": "POS RECEIPT not in fixture"}
