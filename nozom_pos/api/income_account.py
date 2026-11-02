"""Read-only account resolution for NOZOM POS checkout."""

import frappe
from frappe import _
from frappe.utils import cint
from erpnext.stock.doctype.item.item import get_item_defaults
from erpnext.setup.doctype.item_group.item_group import get_item_group_defaults
from erpnext.setup.doctype.brand.brand import get_brand_defaults


def _valid_income_account(account, company):
    if not account:
        return False

    info = frappe.db.get_value(
        "Account",
        account,
        ["company", "disabled", "is_group", "root_type"],
        as_dict=True,
    )

    return bool(
        info
        and info.company == company
        and not cint(info.disabled)
        and not cint(info.is_group)
        and info.root_type == "Income"
    )


def _resolve_item_account(item_code, company, profile=None):
    item = frappe.get_cached_doc("Item", item_code)

    if item.disabled or not item.is_sales_item:
        frappe.throw(_("Item is not available for sale: {0}").format(item_code))

    item_defaults = get_item_defaults(item_code, company) or {}
    group_defaults = (
        get_item_group_defaults(item_code, company) or {}
        if item.item_group else {}
    )
    brand_defaults = (
        get_brand_defaults(item_code, company) or {}
        if item.brand else {}
    )

    candidates = [
        profile.get("income_account") if profile else None,
        item_defaults.get("income_account"),
        group_defaults.get("income_account"),
        brand_defaults.get("income_account"),
        frappe.get_cached_value("Company", company, "default_income_account"),
    ]

    # Preserve ERPNext account priority. Do not silently skip
    # an explicitly configured but invalid account.
    account = next((value for value in candidates if value), None)

    if not _valid_income_account(account, company):
        frappe.throw(
            _("No valid Income Account for item {0} in company {1}")
            .format(item_code, company)
        )

    return account


@frappe.whitelist()
def resolve_missing_income_accounts(company, pos_profile, items):
    """Return only missing row accounts. Never save an invoice."""

    if isinstance(items, str):
        items = frappe.parse_json(items)

    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        frappe.throw(_("Invalid item list"))

    if not company or not pos_profile:
        frappe.throw(_("Company and POS Profile are required"))

    # User must be able to create a POS invoice.
    frappe.has_permission("POS Invoice", "create", throw=True)

    profile = frappe.get_doc("POS Profile", pos_profile)
    profile.check_permission("read")

    if profile.company != company or cint(profile.disabled):
        frappe.throw(_("Invalid or disabled POS Profile for company"))

    results = []

    for row in items:
        if not isinstance(row, dict):
            frappe.throw(_("Invalid item row"))

        code = row.get("item_code")
        idx = row.get("idx")

        if not code or not isinstance(idx, int) or isinstance(idx, bool):
            frappe.throw(_("Invalid item information"))

        if idx < 1 or idx > 100:
            frappe.throw(_("Invalid item row number"))

        results.append({
            "idx": idx,
            "item_code": code,
            "income_account": _resolve_item_account(code, company, profile),
        })

    return results
