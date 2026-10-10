import hashlib
import secrets

import frappe
from frappe import _


PBKDF2_ITERATIONS = 210_000
ALGORITHM = "PBKDF2-SHA256"
VERSION = 1


def _require_pos_admin():
    roles = set(frappe.get_roles(frappe.session.user))

    if frappe.session.user == "Administrator" or "System Manager" in roles:
        return

    frappe.throw(
        _("Only an administrator can manage failed offline transactions."),
        frappe.PermissionError,
    )


@frappe.whitelist()
def get_offline_admin_verifier(pos_profile: str):
    _require_pos_admin()

    if not pos_profile:
        frappe.throw(_("POS Profile is required."))

    profile = frappe.get_doc("POS Profile", pos_profile)

    if not frappe.has_permission("POS Profile", "read", doc=profile):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    password = profile.get_password(
        "nozom_offline_admin_password",
        raise_exception=False,
    )

    if not password:
        return {
            "configured": False,
            "version": VERSION,
        }

    salt = secrets.token_bytes(16)

    verifier = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )

    return {
        "configured": True,
        "version": VERSION,
        "algorithm": ALGORITHM,
        "iterations": PBKDF2_ITERATIONS,
        "salt": salt.hex(),
        "verifier": verifier.hex(),
        "pos_profile": profile.name,
        "profile_modified": str(profile.modified),
    }
