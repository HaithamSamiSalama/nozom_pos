import frappe


def execute():
    logo = "/assets/hspos/images/nozom-pos.svg"
    route = "/desk/point-of-sale"

    icons = frappe.get_all(
        "Desktop Icon",
        filters={"app": "hspos"},
        fields=["name"],
    )

    for icon in icons:
        frappe.db.set_value(
            "Desktop Icon",
            icon.name,
            {
                "label": "NOZOM POS",
                "logo_url": logo,
                "link": route,
                "app": "hspos",
                "icon_type": "App",
            },
            update_modified=False,
        )
