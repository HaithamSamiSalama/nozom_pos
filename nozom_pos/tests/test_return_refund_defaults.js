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
};
global.nozom_pos = { offline: { payment_modes: { list_from_settings() { return []; } } } };
global.erpnext = {
	PointOfSale: {
		get_invoice_total(doc) {
			return flt(doc.rounded_total) || flt(doc.grand_total);
		},
	},
};

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

function returnState(modes, outstanding = -97.5) {
	return {
		precision: 2,
		outstanding,
		is_return: 1,
		doc: { is_return: 1, grand_total: outstanding, rounded_total: outstanding },
		modes: modes.map((mode) => ({ amount: 0, account: "", type: "", default: 0, ...mode })),
		selected_mode: null,
		buffer: "",
		allow_change: true,
	};
}

function amounts(st) {
	return Object.fromEntries(st.modes.map((row) => [row.mode_of_payment, row.amount]));
}

const results = [];
function check(name, ok) {
	results.push({ name, ok });
	if (!ok) console.error("FAIL", name, amounts);
}

// A. Original Cash 97.50 -> return defaults Cash -97.50
const a = returnState(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 0 },
	],
	-97.5
);
popup.assign_return_opening_payments(a, [
	{ mode_of_payment: "Cash", amount: 97.5, account: "Cash - A", type: "Cash", default: 1 },
]);
check(
	"A cash default",
	a.selected_mode === "Cash" &&
		a.modes[0].amount === -97.5 &&
		a.modes[1].amount === 0 &&
		popup.has_entered_payment(a)
);

// B. User can switch refund from Cash to Card
popup.switch_selected_mode(a, "Card");
check(
	"B switch to card",
	a.selected_mode === "Card" && a.modes[0].amount === 0 && a.modes[1].amount === -97.5
);

// C. Return cannot confirm with no refund payment
const c = returnState(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 0 },
	],
	-97.5
);
check("C requires refund", popup.return_requires_refund(c) === true);
check("C unpaid blocked", !popup.has_entered_payment(c) && popup.return_requires_refund(c));

// D. paid_amount becomes -97.50 after apply
const dState = returnState(
	[{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1 }],
	-97.5
);
popup.assign_return_opening_payments(dState, [
	{ mode_of_payment: "Cash", amount: 97.5, account: "Cash - A", type: "Cash", default: 1 },
]);
const dFrm = {
	doc: {
		is_return: 1,
		conversion_rate: 1,
		rounded_total: -97.5,
		grand_total: -97.5,
		payments: [],
	},
};
totals.apply_payments_local(dFrm, dState.modes, { precision: 2, change: 0 });
check(
	"D paid_amount",
	dFrm.doc.paid_amount === -97.5 &&
		dFrm.doc.payments.length === 1 &&
		dFrm.doc.payments[0].amount === -97.5 &&
		dFrm.doc.outstanding_amount === 0
);

// E. Split original payments default as negative rows
const e = returnState(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 1 },
	],
	-100
);
popup.assign_return_opening_payments(e, [
	{ mode_of_payment: "Cash", amount: 40, account: "Cash - A", type: "Cash" },
	{ mode_of_payment: "Card", amount: 60, account: "Card - A", type: "Bank" },
]);
check(
	"E split defaults",
	e.modes[0].amount === -40 && e.modes[1].amount === -60 && popup.has_entered_payment(e)
);

// F. Partial return does not over-refund
const f = returnState(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 1 },
	],
	-50
);
popup.assign_return_opening_payments(f, [
	{ mode_of_payment: "Cash", amount: 40, account: "Cash - A", type: "Cash" },
	{ mode_of_payment: "Card", amount: 60, account: "Card - A", type: "Bank" },
]);
const fTotal = flt(f.modes.reduce((sum, row) => sum + flt(row.amount), 0), 2);
check(
	"F partial cap",
	fTotal === -50 &&
		Math.abs(f.modes[0].amount) <= 40.0000001 &&
		Math.abs(f.modes[1].amount) <= 60.0000001
);

// G. Normal unpaid sale behavior remains unchanged
const g = {
	precision: 2,
	outstanding: 100,
	is_return: 0,
	doc: { is_return: 0 },
	modes: [
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1, amount: 0 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 0, amount: 0 },
	],
	selected_mode: null,
	buffer: "",
	allow_change: true,
};
check("G sale unpaid allowed", popup.return_requires_refund(g) === false);
g.modes[0].amount = 0;
g.modes[1].amount = 0;
check("G sale no payment entered", popup.has_entered_payment(g) === false);
popup.assign_opening_payment(g);
check("G sale still defaults when opening", g.modes[0].amount === 100);

// H. Existing return Exact / switch still works with defaults
const h = returnState(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Card", type: "Bank", account: "Card - A", default: 1 },
	],
	-97.5
);
popup.assign_return_opening_payments(h, [
	{ mode_of_payment: "Cash", amount: 97.5, account: "Cash - A", type: "Cash" },
]);
h.modes[0].amount = 0;
h.selected_mode = "Card";
popup.apply_exact_amount(h);
check("H exact on card", h.modes[1].amount === -97.5 && h.modes[0].amount === 0);

const failed = results.filter((row) => !row.ok);
console.log(results.map((row) => `${row.ok ? "ok" : "FAIL"} ${row.name}`).join("\n"));
if (failed.length) process.exit(1);
