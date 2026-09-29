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
global.erpnext = {};

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

function state(modes, outstanding = 100, isReturn = false) {
	return {
		precision: 2,
		outstanding,
		is_return: isReturn ? 1 : 0,
		doc: { is_return: isReturn ? 1 : 0 },
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

const cardDefault = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
	],
	-100,
	true
);
popup.assign_opening_payment(cardDefault);
check("A selected", cardDefault.selected_mode === "Credit Card");
check(
	"A amounts",
	JSON.stringify(amounts(cardDefault)) === JSON.stringify({ Cash: 0, "Credit Card": -100 })
);

const transfer = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
	],
	-100,
	true
);
popup.assign_opening_payment(transfer);
popup.switch_selected_mode(transfer, "Cash");
check(
	"B transfer",
	transfer.selected_mode === "Cash" && transfer.modes[0].amount === -100 && transfer.modes[1].amount === 0
);

const exact = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: 0 },
	],
	-100,
	true
);
exact.selected_mode = "Credit Card";
popup.apply_exact_amount(exact);
check("C exact", exact.modes[1].amount === -100 && exact.modes[0].amount === 0);

const exactSplit = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: -40 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: 0 },
	],
	-100,
	true
);
exactSplit.selected_mode = "Credit Card";
popup.apply_exact_amount(exactSplit);
check("C remaining", exactSplit.modes[0].amount === -40 && exactSplit.modes[1].amount === -60);

const keypad = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 0 },
	],
	-100,
	true
);
keypad.selected_mode = "Cash";
keypad.buffer = "50";
popup.apply_buffer_to_selected(keypad);
check("D keypad", keypad.modes[0].amount === -50 && keypad.buffer === "50");

const cleared = state(
	[{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: -100 }],
	-100,
	true
);
cleared.selected_mode = "Credit Card";
popup.clear_selected_amount(cleared);
check("E clear", cleared.modes[0].amount === 0 && cleared.buffer === "");

const split = state(
	[
		{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: -40 },
		{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: -60 },
	],
	-100,
	true
);
split.selected_mode = "Credit Card";
const posted = popup.payments_for_server(split);
check(
	"F split rows",
	posted.length === 2 &&
		posted[0].mode_of_payment === "Credit Card" &&
		posted[0].amount === -60 &&
		posted[0].account === "Card - A" &&
		posted[1].mode_of_payment === "Cash" &&
		posted[1].amount === -40 &&
		posted[1].account === "Cash - A"
);

popup.switch_selected_mode(split, "Cash");
check(
	"G keep split",
	split.selected_mode === "Cash" && split.modes[0].amount === -40 && split.modes[1].amount === -60
);

const sale = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
]);
popup.assign_opening_payment(sale);
popup.switch_selected_mode(sale, "Cash");
check("H switch", sale.selected_mode === "Cash" && sale.modes[0].amount === 100 && sale.modes[1].amount === 0);
sale.modes[0].amount = 40;
sale.modes[1].amount = 0;
sale.selected_mode = "Credit Card";
popup.apply_exact_amount(sale);
check("H exact", sale.modes[0].amount === 40 && sale.modes[1].amount === 60);
sale.selected_mode = "Cash";
sale.buffer = "25";
popup.apply_buffer_to_selected(sale);
check("H keypad", sale.modes[0].amount === 25);
const saleSplit = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: 40 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: 60 },
]);
saleSplit.selected_mode = "Credit Card";
const salePosted = popup.payments_for_server(saleSplit);
check(
	"H split",
	salePosted.length === 2 && salePosted[0].amount === 60 && salePosted[1].amount === 40 && salePosted[0].account == null
);

const frm = {
	doc: {
		is_return: 1,
		conversion_rate: 1,
		rounded_total: -100,
		grand_total: -100,
		payments: [],
	},
};
const applied = totals.apply_payments_local(
	frm,
	[
		{ mode_of_payment: "Cash", amount: -40, account: "Cash - A", type: "Cash" },
		{ mode_of_payment: "Credit Card", amount: -60, account: "Card - A", type: "Bank" },
	],
	{ precision: 2, change: 99 }
);
check(
	"I refund rows",
	frm.doc.payments.length === 2 &&
		frm.doc.payments[0].amount === -40 &&
		frm.doc.payments[0].account === "Cash - A" &&
		frm.doc.payments[1].amount === -60 &&
		frm.doc.payments[1].account === "Card - A" &&
		frm.doc.paid_amount === -100 &&
		frm.doc.outstanding_amount === 0 &&
		frm.doc.change_amount === 0 &&
		applied.tendered === -100
);

const saleFrm = {
	doc: {
		is_return: 0,
		conversion_rate: 1,
		rounded_total: 100,
		grand_total: 100,
		payments: [],
	},
};
totals.apply_payments_local(
	saleFrm,
	[
		{ mode_of_payment: "Cash", amount: 40, account: "Cash - A", type: "Cash" },
		{ mode_of_payment: "Credit Card", amount: 0, account: "Card - A", type: "Bank" },
	],
	{ precision: 2, change: 0 }
);
check(
	"I sale partial",
	saleFrm.doc.payments.length === 1 &&
		saleFrm.doc.payments[0].amount === 40 &&
		saleFrm.doc.paid_amount === 40 &&
		saleFrm.doc.outstanding_amount === 60
);

const unpaid = {
	doc: { is_return: 0, conversion_rate: 1, rounded_total: 100, grand_total: 100, payments: [{ amount: 10 }] },
};
totals.apply_payments_local(unpaid, [{ mode_of_payment: "Cash", amount: 0 }], { precision: 2, change: 0 });
check("I sale unpaid", unpaid.doc.payments.length === 0 && unpaid.doc.outstanding_amount === 100);

const failed = results.filter((row) => !row.ok);
console.log(results.map((row) => `${row.ok ? "ok" : "FAIL"} ${row.name}`).join("\n"));
if (failed.length) process.exit(1);
