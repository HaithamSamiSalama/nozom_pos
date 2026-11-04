/**
 * Full return of 52.60 AED with POS Profile.disable_rounded_total=1.
 *
 * Reproduces the cashier failure:
 *   "Paid amount + Write Off Amount can not be greater than Grand Total"
 * which happened when the client left rounded_total=-53 (stock set_rounded_total
 * ignores the in-memory POS Profile flag) and refunded -53, while the server
 * zeroed rounded_total and compared against grand_total=-52.60.
 */
const fs = require("fs");
const vm = require("vm");

global.cint = (value) => {
	const number = parseInt(value, 10);
	return Number.isFinite(number) ? number : 0;
};
global.flt = (value, precision) => {
	const number = Number(value);
	if (!Number.isFinite(number)) return 0;
	if (precision == null) return number;
	const factor = 10 ** precision;
	return Math.round(number * factor) / factor;
};
global.cstr = (value) => (value == null ? "" : String(value));
global.__ = (value) => value;
global.frappe = {
	provide(path) {
		const parts = String(path).split(".");
		let cursor = global;
		parts.forEach((part) => {
			cursor[part] = cursor[part] || {};
			cursor = cursor[part];
		});
	},
	utils: { escape_html: (value) => value },
	meta: { get_field_precision() { return 2; } },
	sys_defaults: { disable_rounded_total: 0 },
};
global.nozom_pos = { offline: { payment_modes: { list_from_settings() { return []; } } } };
global.erpnext = {
	PointOfSale: {},
	taxes_and_totals: {
		prototype: {
			set_rounded_total() {
				// Stock ERPNext behavior for POS Invoice (no DocField):
				// only Global Defaults — rounding stays ON here.
				const doc = this.frm.doc;
				doc.rounded_total = flt(Math.round(doc.grand_total), 2);
				doc.rounding_adjustment = flt(doc.rounded_total - doc.grand_total, 2);
			},
			set_in_company_currency() {},
		},
	},
};

const posSource = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/point_of_sale.js",
	"utf8"
);
// Only evaluate the PointOfSale helpers + patch (skip page handlers that need $).
const helpersOnly = posSource
	.split("function set_nozom_pos_page_chrome")[0]
	.replace(/frappe\.pages[\s\S]*$/m, "");
vm.runInThisContext(helpersOnly);

const popupSource = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/offline/checkout_popup.js",
	"utf8"
);
vm.runInThisContext(popupSource);
const popup = global.nozom_pos.checkout_popup;

const totalsSource = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/offline/totals.js",
	"utf8"
);
vm.runInThisContext(totalsSource);
const totals = global.nozom_pos.offline.totals;

erpnext.PointOfSale.get_invoice_total = function (doc) {
	if (!doc) return 0;
	return erpnext.PointOfSale.is_rounded_total_disabled(doc)
		? flt(doc.grand_total)
		: flt(doc.rounded_total || doc.grand_total);
};

const results = [];
function check(name, ok, detail) {
	results.push({ name, ok, detail });
	if (!ok) console.error("FAIL", name, detail);
}

function validate_pos_like(doc) {
	const invoice_total = erpnext.PointOfSale.is_rounded_total_disabled(doc)
		? flt(doc.grand_total)
		: flt(doc.rounded_total) || flt(doc.grand_total);
	const tolerance = 1.0 / 10 ** 3;
	return (
		Math.abs(flt(doc.paid_amount)) + Math.abs(flt(doc.write_off_amount || 0)) - Math.abs(flt(invoice_total)) >
		tolerance
	);
}

// --- A. Stale rounded_total=-53 with disable=1 must use grand_total=-52.60 ---
const stale = {
	grand_total: -52.6,
	rounded_total: -53,
	disable_rounded_total: 1,
	write_off_amount: 0,
};
check("A invoice_total", popup.invoice_total(stale) === -52.6, popup.invoice_total(stale));
erpnext.PointOfSale.apply_rounding_preference(stale);
check("A zeros rounded", stale.rounded_total === 0 && stale.rounding_adjustment === 0);

// --- B. Full return opening + apply yields paid_amount=-52.60 ---
const st = {
	precision: 2,
	outstanding: -52.6,
	is_return: 1,
	doc: { is_return: 1, grand_total: -52.6, rounded_total: 0, disable_rounded_total: 1 },
	modes: [
		{ mode_of_payment: "Talabat Tgo", type: "Bank", account: "Talabat - A", default: 1, amount: 0 },
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: 0 },
	],
	selected_mode: null,
	buffer: "",
	allow_change: true,
};
popup.assign_return_opening_payments(st, [
	{ mode_of_payment: "Talabat Tgo", amount: 52.6, account: "Talabat - A", type: "Bank" },
]);
check(
	"B opening refund",
	st.modes[0].amount === -52.6 && st.modes[1].amount === 0,
	st.modes.map((m) => m.amount)
);

const frm = {
	doc: {
		is_return: 1,
		conversion_rate: 1,
		grand_total: -52.6,
		rounded_total: -53, // stale client rounding
		disable_rounded_total: 1,
		write_off_amount: 0,
		payments: [],
	},
	clear_table(field) {
		this.doc[field] = [];
	},
	add_child(field) {
		const row = {};
		this.doc[field] = this.doc[field] || [];
		this.doc[field].push(row);
		return row;
	},
	refresh_field() {},
	cscript: {},
};
popup.align_doc_rounding(frm.doc, { disable_rounded_total: 1 });
check("B align zeros rounded", frm.doc.rounded_total === 0);

// Simulate apply_payments online path body
frm.clear_table("payments");
const payable = st.modes.filter((row) => flt(row.amount) < -0.0000001);
for (const row of payable) {
	const payment = frm.add_child("payments");
	payment.mode_of_payment = row.mode_of_payment;
	payment.account = row.account;
	payment.type = row.type;
	payment.amount = flt(row.amount, 2);
}
popup.sync_paid_amount_from_payments(frm, 2);
check(
	"B paid_amount",
	frm.doc.paid_amount === -52.6 && frm.doc.base_paid_amount === -52.6,
	frm.doc.paid_amount
);
check("B validate_pos passes", validate_pos_like(frm.doc) === false, {
	paid: frm.doc.paid_amount,
	rounded: frm.doc.rounded_total,
	grand: frm.doc.grand_total,
});

// --- C. Without align, refunding against rounded -53 must fail server-style check ---
const bad = {
	grand_total: -52.6,
	rounded_total: 0, // server after disable
	disable_rounded_total: 1,
	paid_amount: -53,
	write_off_amount: 0,
};
check("C reproduces failure", validate_pos_like(bad) === true);

// --- D. Partial return stays capped at due ---
const partial = {
	precision: 2,
	outstanding: -20,
	is_return: 1,
	doc: { is_return: 1, grand_total: -20, rounded_total: 0, disable_rounded_total: 1 },
	modes: [
		{ mode_of_payment: "Talabat Tgo", type: "Bank", account: "Talabat - A", default: 1, amount: 0 },
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: 0 },
	],
	selected_mode: null,
	buffer: "",
	allow_change: true,
};
popup.assign_return_opening_payments(partial, [
	{ mode_of_payment: "Talabat Tgo", amount: 52.6, account: "Talabat - A", type: "Bank" },
]);
const partialTotal = flt(
	partial.modes.reduce((sum, row) => sum + flt(row.amount), 0),
	2
);
check("D partial cap", partialTotal === -20, partialTotal);

// --- E. totals.recalculate zeros rounded_total when disable=1; apply keeps paid ---
const localFrm = {
	doc: {
		is_return: 1,
		conversion_rate: 1,
		disable_rounded_total: 1,
		discount_amount: 0,
		additional_discount_percentage: 0,
		taxes: [],
		items: [{ qty: -1, rate: 52.6, conversion_factor: 1 }],
		payments: [],
		paid_amount: 0,
		change_amount: 0,
	},
};
totals.recalculate(localFrm);
check(
	"E recalculate zeros rounded",
	localFrm.doc.rounded_total === 0 && localFrm.doc.grand_total === -52.6,
	{ rounded: localFrm.doc.rounded_total, grand: localFrm.doc.grand_total }
);
totals.apply_payments_local(
	localFrm,
	[{ mode_of_payment: "Talabat Tgo", amount: -52.6, account: "Talabat - A", type: "Bank" }],
	{ precision: 2, change: 0 }
);
check(
	"E local paid",
	localFrm.doc.paid_amount === -52.6 && localFrm.doc.outstanding_amount === 0,
	{ paid: localFrm.doc.paid_amount, outstanding: localFrm.doc.outstanding_amount }
);

// --- F. Prototype patch zeros rounded for POS Invoice when disable is set ---
const taxDoc = {
	doctype: "POS Invoice",
	grand_total: -52.6,
	rounded_total: -53,
	disable_rounded_total: 1,
	currency: "AED",
};
const controller = { frm: { doc: taxDoc }, set_in_company_currency() {} };
erpnext.taxes_and_totals.prototype.set_rounded_total.call(controller);
check("F patch zeros POS", taxDoc.rounded_total === 0 && taxDoc.rounding_adjustment === 0);

// --- G. Patch scoped to NOZOM POS docs; cur_pos must not affect Quotation ---
global.cur_pos = { settings: { disable_rounded_total: 1 } };
check(
	"G is_nozom_pos_document",
	erpnext.PointOfSale.is_nozom_pos_document({ doctype: "POS Invoice" }) === true &&
		erpnext.PointOfSale.is_nozom_pos_document({ doctype: "Quotation" }) === false &&
		erpnext.PointOfSale.is_nozom_pos_document({
			doctype: "Sales Invoice",
			is_pos: 0,
		}) === false &&
		erpnext.PointOfSale.is_nozom_pos_document({
			doctype: "Sales Invoice",
			is_pos: 1,
			pos_profile: "Shop",
		}) === true
);
const quoteDoc = {
	doctype: "Quotation",
	grand_total: 52.6,
	rounded_total: 99,
	currency: "AED",
};
// Stock mock rounds via Math.round; scoped patch must take this path for Quotation
// even while cur_pos says disable_rounded_total=1.
erpnext.taxes_and_totals.prototype.set_rounded_total.call({
	frm: { doc: quoteDoc },
	set_in_company_currency() {},
});
check("G non-POS uses stock rounding", quoteDoc.rounded_total === 53, quoteDoc.rounded_total);
check(
	"G cur_pos ignored for Quotation",
	erpnext.PointOfSale.is_rounded_total_disabled(quoteDoc) === 0
);

const failed = results.filter((row) => !row.ok);
console.log(results.map((row) => `${row.ok ? "ok" : "FAIL"} ${row.name}`).join("\n"));
if (failed.length) process.exit(1);
