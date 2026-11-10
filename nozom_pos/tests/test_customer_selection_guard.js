/**
 * Fast unit checks for POS customer commit vs search-text separation.
 * Run: node nozom_pos/tests/test_customer_selection_guard.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.__ = (value, ...args) => {
	if (!args.length) return value;
	return String(value).replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? "");
};
global.frappe = {
	provide(ns) {
		const parts = String(ns).split(".");
		let cursor = global;
		for (const part of parts) {
			cursor[part] = cursor[part] || {};
			cursor = cursor[part];
		}
	},
};

const guardPath = path.join(
	__dirname,
	"..",
	"public",
	"js",
	"customer_selection_guard.js"
);
vm.runInThisContext(fs.readFileSync(guardPath, "utf8"), { filename: guardPath });

const guard = global.nozom_pos.customer_selection;
const results = [];

function check(name, ok, detail) {
	results.push({ name, ok, detail });
	if (!ok) console.error("FAIL", name, detail || "");
}

check("normalize trims string", guard.normalize_ref("  R  ") === "R");
check("normalize object name", guard.normalize_ref({ name: "CUST-1" }) === "CUST-1");
check("normalize empty -> null", guard.normalize_ref("   ") === null);

check(
	"link option detected",
	guard.is_link_option_value("create_new__link_option") === true
);
check("normal id not link option", guard.is_link_option_value("R") === false);

check(
	"same committed skips duplicate",
	guard.is_same_committed_customer("CUST-1", "CUST-1", "CUST-1") === true
);
check(
	"typed R is not same as committed CUST-1",
	guard.is_same_committed_customer("R", "CUST-1", "CUST-1") === false
);

const revert = guard.decide_commit_result({
	candidate: "R",
	resolved_name: null,
	previous: "CUST-1",
	token: 1,
	current_token: 1,
});
check("invalid R reverts to previous", revert.action === "revert" && revert.previous === "CUST-1");

const stale = guard.decide_commit_result({
	candidate: "CUST-2",
	resolved_name: "CUST-2",
	previous: "CUST-1",
	token: 1,
	current_token: 2,
});
check("stale async ignored", stale.action === "ignore_stale");

const commit = guard.decide_commit_result({
	candidate: "CUST-2",
	resolved_name: { name: "CUST-2" },
	previous: "CUST-1",
	token: 3,
	current_token: 3,
});
check("valid resolve commits", commit.action === "commit" && commit.customer === "CUST-2");

const cartPath = path.join(__dirname, "..", "public", "js", "pos_item_cart.js");
const cartSrc = fs.readFileSync(cartPath, "utf8");
check(
	"onchange uses queue_customer_commit",
	cartSrc.includes("me.queue_customer_commit(this.value)")
);
check(
	"onchange does not call apply_customer_selection directly",
	!/onchange:\s*function\s*\(\)\s*\{[^}]*apply_customer_selection\(this\.value\)/s.test(cartSrc)
);
check("resolve_customer_for_commit exists", cartSrc.includes("resolve_customer_for_commit("));
check("restore keeps previous display", cartSrc.includes("restore_customer_field_display("));
check(
	"online exists check before party mutation path",
	cartSrc.includes('frappe.db.exists("Customer"') || cartSrc.includes("frappe.db.exists('Customer'")
);

const failed = results.filter((r) => !r.ok);
if (failed.length) {
	console.error(`\n${failed.length} failed of ${results.length}`);
	process.exit(1);
}
console.log(`OK ${results.length} customer selection guard checks`);
