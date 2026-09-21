import frappe


def execute():
    old_labels = {"hspos", "Hspos", "HSPOS"}
    new_label = "NOZOM POS"

    # Update existing Desktop Icon records created by older versions
    icons = frappe.get_all(
        "Desktop Icon",
        fields=["name", "label", "app", "link_type", "link_to", "link"]
    )

    for icon in icons:
        app = (icon.app or "").strip().lower()
        label = (icon.label or "").strip()
        name = (icon.name or "").strip()

        if (
            app == "hspos"
            or label in old_labels
            or name in old_labels
        ):
            updates = {}

            if label != new_label:
                updates["label"] = new_label

            # Preserve direct POS behaviour where supported
            if icon.link_type == "URL":
                if icon.link_to != "/desk/point-of-sale":
                    updates["link_to"] = "/desk/point-of-sale"

            if updates:
                frappe.db.set_value(
                    "Desktop Icon",
                    icon.name,
                    updates,
                    update_modified=False
                )

    # Update Workspace label if an old one exists
    workspaces = frappe.get_all(
        "Workspace",
        fields=["name", "label", "title"]
    )

    for ws in workspaces:
        if (
            (ws.label or "").strip() in old_labels
            or (ws.title or "").strip() in old_labels
            or (ws.name or "").strip() in old_labels
        ):
            updates = {}

            if (ws.label or "").strip() != new_label:
                updates["label"] = new_label

            if (ws.title or "").strip() != new_label:
                updates["title"] = new_label

            if updates:
                frappe.db.set_value(
                    "Workspace",
                    ws.name,
                    updates,
                    update_modified=False
                )

    frappe.db.commit()
