frappe.provide("erpnext.PointOfSale");

erpnext.PointOfSale.is_rounded_total_disabled = function (doc) {
	// Prefer invoice value, then POS Profile setting, then Global Defaults
	if (doc && doc.disable_rounded_total != null && doc.disable_rounded_total !== "") {
		return cint(doc.disable_rounded_total);
	}
	if (window.cur_pos?.settings && cur_pos.settings.disable_rounded_total != null) {
		return cint(cur_pos.settings.disable_rounded_total);
	}
	return cint(frappe.sys_defaults.disable_rounded_total);
};

erpnext.PointOfSale.get_invoice_total = function (doc) {
	if (!doc) return 0;
	return erpnext.PointOfSale.is_rounded_total_disabled(doc)
		? flt(doc.grand_total)
		: flt(doc.rounded_total || doc.grand_total);
};

frappe.pages["point-of-sale"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Point of Sale"),
		single_column: true,
		hide_sidebar: true,
	});

	frappe.require("point-of-sale.bundle.js", function () {
		frappe.require("nozom_pos.bundle.js", function () {
			wrapper.pos = new erpnext.PointOfSale.Controller(wrapper);
			window.cur_pos = wrapper.pos;
		});
	});
};

frappe.pages["point-of-sale"].on_page_show = function (wrapper) {
	if (wrapper.pos) {
		wrapper.pos.$components_wrapper.show();
	}
};
