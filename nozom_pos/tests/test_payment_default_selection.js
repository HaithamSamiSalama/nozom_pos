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
	provide() {},
	utils: { escape_html: (value) => value },
};
global.nozom_pos = { offline: { payment_modes: { list_from_settings() { return []; } } } };

const source = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/offline/checkout_popup.js",
	"utf8"
);
vm.runInThisContext(source);
const popup = global.nozom_pos.checkout_popup;

function state(modes, outstanding = 100) {
	return {
		precision: 2,
		outstanding,
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
	if (!ok) console.error("FAIL", name);
}

const cardDefault = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
	{ mode_of_payment: "Bank", type: "Bank", account: "Bank - A", default: 0 },
]);
popup.assign_opening_payment(cardDefault);
check("A selected", cardDefault.selected_mode === "Credit Card");
check("A amounts", JSON.stringify(amounts(cardDefault)) === JSON.stringify({ Cash: 0, "Credit Card": 100, Bank: 0 }));

const cashDefault = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 1 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 0 },
]);
popup.assign_opening_payment(cashDefault);
check("B selected", cashDefault.selected_mode === "Cash");
check("B amounts", cashDefault.modes[0].amount === 100 && cashDefault.modes[1].amount === 0);

const noDefault = state([
	{ mode_of_payment: "Bank", type: "Bank", account: "Bank - A", default: 0 },
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
]);
popup.assign_opening_payment(noDefault);
check("C first mode", noDefault.selected_mode === "Bank" && noDefault.modes[0].amount === 100 && noDefault.modes[1].amount === 0);

const split = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: 40 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: 60 },
]);
split.selected_mode = "Credit Card";
const posted = popup.payments_for_server(split);
check(
	"D split rows",
	posted.length === 2 &&
		posted[0].mode_of_payment === "Credit Card" &&
		posted[0].amount === 60 &&
		posted[1].mode_of_payment === "Cash" &&
		posted[1].amount === 40 &&
		split.modes[0].account === "Cash - A" &&
		split.modes[1].account === "Card - A"
);

const transfer = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
]);
popup.assign_opening_payment(transfer);
popup.switch_selected_mode(transfer, "Cash");
check(
	"E transfer",
	transfer.selected_mode === "Cash" && transfer.modes[0].amount === 100 && transfer.modes[1].amount === 0
);

const keepSplit = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0, amount: 40 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1, amount: 60 },
]);
keepSplit.selected_mode = "Credit Card";
popup.switch_selected_mode(keepSplit, "Cash");
check(
	"F keep split",
	keepSplit.selected_mode === "Cash" && keepSplit.modes[0].amount === 40 && keepSplit.modes[1].amount === 60
);

const offline = state([
	{ mode_of_payment: "Cash", type: "Cash", account: "Cash - A", default: 0 },
	{ mode_of_payment: "Credit Card", type: "Bank", account: "Card - A", default: 1 },
]);
popup.assign_opening_payment(offline);
check("G offline default", offline.selected_mode === "Credit Card" && offline.modes[0].amount === 0 && offline.modes[1].amount === 100);

const failed = results.filter((row) => !row.ok);
console.log(results.map((row) => `${row.ok ? "ok" : "FAIL"} ${row.name}`).join("\n"));
if (failed.length) process.exit(1);
