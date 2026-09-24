import frappe


RECEIPT_FORMAT = "POS RECEIPT"
KITCHEN_FORMAT = "POS Kitchen Print"


def ensure_print_format_2_field():
    """
    Ensure POS Profile has a print_format_2 Custom Field.

    Existing fields are detected by dt + fieldname, regardless of the
    Custom Field document name. Existing customer fields are reused
    and never renamed or deleted.
    """

    existing = frappe.db.get_value(
        "Custom Field",
        {
            "dt": "POS Profile",
            "fieldname": "print_format_2",
        },
        "name",
    )

    if existing:
        return existing

    doc = frappe.get_doc(
        {
            "doctype": "Custom Field",
            "dt": "POS Profile",
            "fieldname": "print_format_2",
            "label": "Print Format 2",
            "fieldtype": "Link",
            "options": "Print Format",
            "insert_after": "print_format",
            "default": KITCHEN_FORMAT,
        }
    )

    doc.insert(ignore_permissions=True)
    frappe.clear_cache(doctype="POS Profile")

    return doc.name


def set_pos_profile_print_defaults(doc, method=None):
    """
    Apply NOZOM POS print defaults without overwriting customer choices.
    """

    if (
        not doc.get("print_format")
        and frappe.db.exists("Print Format", RECEIPT_FORMAT)
    ):
        doc.print_format = RECEIPT_FORMAT

    if (
        not doc.get("print_format_2")
        and frappe.db.exists("Print Format", KITCHEN_FORMAT)
    ):
        doc.print_format_2 = KITCHEN_FORMAT


def apply_existing_pos_profiles():
    """
    after_migrate hook.

    1. Ensure print_format_2 exists.
    2. Populate blank print settings on existing POS Profiles.
    3. Never overwrite an existing customer-selected value.
    """

    ensure_print_format_2_field()

    frappe.clear_cache(doctype="POS Profile")

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

        if not values:
            continue

        updates = {}

        if receipt_exists and not values.get("print_format"):
            updates["print_format"] = RECEIPT_FORMAT

        if kitchen_exists and not values.get("print_format_2"):
            updates["print_format_2"] = KITCHEN_FORMAT

        if updates:
            frappe.db.set_value(
                "POS Profile",
                name,
                updates,
                update_modified=False,
            )
