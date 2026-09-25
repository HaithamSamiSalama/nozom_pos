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

function set_nozom_pos_page_chrome(active) {
	const $body = $(document.body);
	$body.toggleClass("nozom-pos-page-active", Boolean(active));

	const $page = $('.page-container[data-page-route="point-of-sale"]');
	if (!$page.length) return;

	// Hide Frappe page-head breadcrumbs + standalone POS title on this page only.
	$page.find(".page-head .navbar-breadcrumbs").toggleClass("nozom-pos-hide-core-chrome", Boolean(active));
	$page.find(".page-head .page-title").toggleClass("nozom-pos-hide-core-chrome", Boolean(active));
	$page.find(".page-head .page-title .title-text").toggleClass("nozom-pos-hide-core-chrome", Boolean(active));
	// Hide empty three-dot menu button if present
	$page.find(".page-head .menu-btn-group").toggleClass("nozom-pos-hide-core-chrome", Boolean(active));
}

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
			set_nozom_pos_page_chrome(true);
		});
	});
};

frappe.pages["point-of-sale"].on_page_show = function (wrapper) {
	set_nozom_pos_page_chrome(true);
	nozom_pos.i18n?.boot_on_pos?.();
	if (wrapper.pos) {
		wrapper.pos.$components_wrapper.show();
	}
};

$(document).on("page-change", () => {
	const on_pos = frappe.get_route_str() === "point-of-sale";
	set_nozom_pos_page_chrome(on_pos);
	if (!on_pos) {
		// Restore in-memory Desk language — never wrote User language
		nozom_pos.i18n?.restore_desk_language?.();
	}
});
