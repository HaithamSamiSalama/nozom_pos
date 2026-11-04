frappe.provide("erpnext.PointOfSale");

/**
 * True for cashier POS documents only. Keeps TaxesAndTotals / rounding helpers
 * from bleeding into Quotation, SO, or desk Sales Invoice after visiting POS.
 */
erpnext.PointOfSale.is_nozom_pos_document = function (doc) {
	if (!doc || !doc.doctype) return false;
	if (doc.doctype === "POS Invoice") return true;
	return (
		doc.doctype === "Sales Invoice" &&
		cint(doc.is_pos) === 1 &&
		(cint(doc.is_created_using_pos) === 1 || Boolean(doc.pos_profile))
	);
};

erpnext.PointOfSale.is_rounded_total_disabled = function (doc) {
	// Prefer invoice value, then POS Profile setting (POS docs only), then Global Defaults
	if (doc && doc.disable_rounded_total != null && doc.disable_rounded_total !== "") {
		return cint(doc.disable_rounded_total);
	}
	if (
		erpnext.PointOfSale.is_nozom_pos_document(doc) &&
		window.cur_pos?.settings &&
		cur_pos.settings.disable_rounded_total != null
	) {
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

/**
 * POS Invoice has no disable_rounded_total DocField, so stock
 * TaxesAndTotals.set_rounded_total only reads Global Defaults and can leave a
 * stale rounded_total (e.g. -53 for grand_total -52.60). Align with server:
 * when the POS Profile disables rounding, zero rounded_total.
 */
erpnext.PointOfSale.apply_rounding_preference = function (doc, settings) {
	if (!doc) return doc;
	if (settings && settings.disable_rounded_total != null && settings.disable_rounded_total !== "") {
		doc.disable_rounded_total = cint(settings.disable_rounded_total);
	} else if (
		doc.disable_rounded_total == null &&
		erpnext.PointOfSale.is_nozom_pos_document(doc) &&
		window.cur_pos?.settings &&
		cur_pos.settings.disable_rounded_total != null
	) {
		doc.disable_rounded_total = cint(cur_pos.settings.disable_rounded_total);
	}
	if (erpnext.PointOfSale.is_rounded_total_disabled(doc)) {
		doc.rounded_total = 0;
		doc.base_rounded_total = 0;
		doc.rounding_adjustment = 0;
		doc.base_rounding_adjustment = 0;
	}
	return doc;
};

(function patch_pos_rounded_total() {
	const proto = erpnext?.taxes_and_totals?.prototype;
	if (!proto || proto._nozom_rounded_total_patched) return;
	const original = proto.set_rounded_total;
	if (typeof original !== "function") return;
	proto.set_rounded_total = function () {
		const doc = this.frm?.doc;
		// Scope: NOZOM POS cashier docs only — never rewrite rounding for other forms.
		if (
			doc &&
			erpnext.PointOfSale.is_nozom_pos_document(doc) &&
			erpnext.PointOfSale.is_rounded_total_disabled(doc)
		) {
			doc.disable_rounded_total = 1;
			doc.rounded_total = 0;
			doc.rounding_adjustment = 0;
			doc.base_rounded_total = 0;
			doc.base_rounding_adjustment = 0;
			if (typeof this.set_in_company_currency === "function") {
				this.set_in_company_currency(doc, ["rounding_adjustment", "rounded_total"]);
			}
			return;
		}
		return original.apply(this, arguments);
	};
	proto._nozom_rounded_total_patched = true;
})();

function set_nozom_pos_page_chrome(active) {
	const $body = $(document.body);
	$body.toggleClass("nozom-pos-page-active", Boolean(active));

	// Reinforce Desk body-sidebar hide/restore for Frappe v16.
	// Primary hide is CSS (body[data-route="point-of-sale"] / .nozom-pos-page-active).
	// JS keeps frappe.app.sidebar.wrapper in sync so leaving POS restores cleanly.
	try {
		const sidebar = frappe.app?.sidebar;
		if (sidebar?.wrapper?.length) {
			if (active) {
				sidebar.wrapper.hide();
			} else if (typeof sidebar.toggle === "function") {
				sidebar.toggle();
			} else {
				sidebar.wrapper.show();
			}
		}
	} catch (e) {
		/* ignore — CSS route rule still applies */
	}

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
		// Brand literal — never __() / never localize
		title: nozom_pos.PAGE_TITLE || "NOZOM POS",
		single_column: true,
		hide_sidebar: true,
	});

	frappe.require("point-of-sale.bundle.js", function () {
		frappe.require("nozom_pos.bundle.js", function () {
			wrapper.pos = new erpnext.PointOfSale.Controller(wrapper);
			window.cur_pos = wrapper.pos;
			set_nozom_pos_page_chrome(true);
			nozom_pos.set_brand_page_title?.(wrapper.pos?.page || wrapper.page);
		});
	});
};

frappe.pages["point-of-sale"].on_page_show = function (wrapper) {
	set_nozom_pos_page_chrome(true);
	nozom_pos.set_brand_page_title?.(wrapper.pos?.page || wrapper.page);
	nozom_pos.i18n?.boot_on_pos?.().then(() => {
		nozom_pos.i18n?.refresh_pos_ui?.();
	});
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

// Apply as early as possible on cold load of /desk/point-of-sale
if (frappe.get_route_str && frappe.get_route_str() === "point-of-sale") {
	$(document.body).addClass("nozom-pos-page-active");
}