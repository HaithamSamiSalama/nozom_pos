import frappe


RECEIPT_FORMAT = "POS RECEIPT"
KITCHEN_FORMAT = "POS Kitchen Print"


def set_pos_profile_print_defaults(doc, method=None):
    """
    Set NOZOM POS print defaults only when fields are empty.
    Never overwrite an explicit customer choice.
    """
    if not doc.get("print_format") and frappe.db.exists("Print Format", RECEIPT_FORMAT):
        doc.print_format = RECEIPT_FORMAT

    if not doc.get("print_format_2") and frappe.db.exists("Print Format", KITCHEN_FORMAT):
        doc.print_format_2 = KITCHEN_FORMAT


def apply_existing_pos_profiles():
    """
    Called after migrate:
    populate existing POS Profiles only where values are blank.
    """
    if not frappe.db.has_column("POS Profile", "print_format_2"):
        return

    receipt_exists = frappe.db.exists("Print Format", RECEIPT_FORMAT)
    kitchen_exists = frappe.db.exists("Print Format", KITCHEN_FORMAT)

    if not receipt_exists and not kitchen_exists:
        return

    for name in frappe.get_all("POS Profile", pluck="name"):
        values = frappe.db.get_value(
            "POS Profile",
            name,
            ["print_format", "print_format_2"],
            as_dict=True,
        )

        updates = {}

        if receipt_exists and not values.print_format:
            updates["print_format"] = RECEIPT_FORMAT

        if kitchen_exists and not values.print_format_2:
            updates["print_format_2"] = KITCHEN_FORMAT

        if updates:
            frappe.db.set_value(
                "POS Profile",
                name,
                updates,
                update_modified=False,
            )
