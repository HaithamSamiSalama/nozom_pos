from frappe.utils.install import auto_generate_icons_and_sidebar


def after_install():
    auto_generate_icons_and_sidebar()
