"""One-time patch: clean up POS Profile custom field layout after tab refactor.

1. Deletes the old nozom_print_logo_section (replaced by nozom_pos_printing_section).
2. Updates the print_format_2 custom field to insert_after nozom_pos_printing_section.
"""

import frappe


def execute():
    # 1. Remove old standalone section (now replaced by nozom_pos_printing_section)
    old_section = "POS Profile-nozom_print_logo_section"
    if frappe.db.exists("Custom Field", old_section):
        frappe.delete_doc("Custom Field", old_section, force=True, ignore_permissions=True)
        frappe.logger().info("nozom_pos patch: deleted %s", old_section)

    # Also try lookup by dt+fieldname in case the docname was different
    alt = frappe.db.get_value(
        "Custom Field",
        {"dt": "POS Profile", "fieldname": "nozom_print_logo_section"},
        "name",
    )
    if alt and alt != old_section:
        frappe.delete_doc("Custom Field", alt, force=True, ignore_permissions=True)
        frappe.logger().info("nozom_pos patch: deleted alt %s", alt)

    # 2. Update print_format_2 insert_after so it sits inside the new printing section
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
        frappe.logger().info("nozom_pos patch: updated %s insert_after -> nozom_pos_printing_section", pf2)

    frappe.clear_cache(doctype="POS Profile")
