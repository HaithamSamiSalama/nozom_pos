import frappe


LABEL = "NOZOM POS"
APP = "hspos"
ROUTE = "/desk/point-of-sale"
LOGO = "/assets/hspos/images/nozom-pos.svg"


def ensure_desktop_icon():
    """
    Ensure exactly one NOZOM POS desktop App icon exists.
    Safe for fresh installs and existing sites.
    """

    # Find all records related to hspos or previous NOZOM POS attempts
    related = frappe.get_all(
        "Desktop Icon",
        fields=["name", "label", "app", "icon_type"],
    )

    related = [
        row
        for row in related
        if (row.app or "").lower() == APP
        or (row.label or "").strip().lower() == LABEL.lower()
    ]

    # Prefer existing NOZOM POS label, otherwise existing hspos app icon
    chosen = None

    for row in related:
        if (row.label or "").strip().lower() == LABEL.lower():
            chosen = row.name
            break

    if not chosen:
        for row in related:
            if (row.app or "").lower() == APP:
                chosen = row.name
                break

    # Remove duplicate old hspos/NOZOM POS icons
    for row in related:
        if row.name != chosen:
            frappe.delete_doc(
                "Desktop Icon",
                row.name,
                force=True,
                ignore_permissions=True,
            )

    if chosen and frappe.db.exists("Desktop Icon", chosen):
        icon = frappe.get_doc("Desktop Icon", chosen)
    else:
        icon = frappe.new_doc("Desktop Icon")

    # Match Frappe v16 App icon structure exactly
    icon.label = LABEL
    icon.app = APP
    icon.icon_type = "App"

    icon.link_type = "External"
    icon.link = ROUTE

    # CRITICAL:
    # old Workspace experiments may have left this populated
    icon.link_to = None

    icon.logo_url = LOGO
    icon.hidden = 0

    # Clear old Workspace/folder relations
    icon.parent_icon = None
    icon.sidebar = None

    if icon.is_new():
        icon.insert(ignore_permissions=True)
    else:
        icon.save(ignore_permissions=True)

    frappe.db.commit()
    frappe.clear_cache()

    return icon.name


def after_install():
    ensure_desktop_icon()
