"""One-time patch: correct POS Profile NOZOM Setting tab organization & numeric logo size.

1. Removes old nozom_pos_settings_tab (which was placed after taxes_and_charges and swallowed standard fields).
2. Cleans up nozom_print_logo_size values to integers (default 55).
3. Re-creates/aligns Custom Fields cleanly from setup.py definition.
"""

import frappe
from frappe.utils import cint


def execute():
    # 1. Remove old tab custom field so standard ERPNext fields are restored
    for name in ["POS Profile-nozom_pos_settings_tab", "POS Profile-nozom_print_logo_size"]:
        if frappe.db.exists("Custom Field", name):
            frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
            frappe.logger().info("nozom_pos patch: deleted %s", name)

    # 2. Update existing POS Profiles with valid numeric logo size
    try:
        for row in frappe.get_all("POS Profile", fields=["name"]):
            val_raw = frappe.db.get_value("POS Profile", row["name"], "nozom_print_logo_size")
            try:
                val = cint(val_raw)
            except Exception:
                val = 55
            if val < 20 or val > 120:
                val = 55
            frappe.db.set_value(
                "POS Profile",
                row["name"],
                "nozom_print_logo_size",
                val,
                update_modified=False,
            )
    except Exception as e:
        frappe.logger().warning("nozom_pos patch: note on updating POS Profile records: %s", e)

    # 3. Ensure custom fields are fully created/aligned from setup.py
    from nozom_pos.setup import ensure_custom_fields
    ensure_custom_fields()

    # 4. Make sure print_format_2 is inside Printing section
    pf2 = frappe.db.get_value(
        "Custom Field",
        {"dt": "POS Profile", "fieldname": "print_format_2"},
        "name",
    )
    if pf2:
        frappe.db.set_value(
            "Custom Field",
            pf2,
            "insert_after",
            "nozom_pos_printing_section",
            update_modified=False,
        )

    frappe.clear_cache(doctype="POS Profile")
