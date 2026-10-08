const fs = require("fs");
const vm = require("vm");

global.cstr = (value) => (value == null ? "" : String(value));
global.__ = (value) => value;
global.frappe = { provide(path) {
	const parts = String(path).split(".");
	let cursor = global;
	parts.forEach((part) => {
		cursor[part] = cursor[part] || {};
		cursor = cursor[part];
	});
} };

const sharedSource = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/offline/customer_address_shared.js",
	"utf8"
);
vm.runInThisContext(sharedSource);

const storeSource = fs.readFileSync(
	"/Users/haitham/frappe-bench/apps/nozom_pos/nozom_pos/public/js/offline/address_store.js",
	"utf8"
);

global.nozom_pos.offline = {
	qr: { sanitize: (url) => url || "" },
	customer_store: { is_local_id: () => false },
	db: {
		put: async () => {},
		put_many: async () => {},
		get: async () => null,
		get_all: async () => [],
	},
};

vm.runInThisContext(storeSource);

const shared = global.nozom_pos.customer_address;
const store = global.nozom_pos.offline.address_store;

const results = [];
function check(name, ok) {
	results.push({ name, ok });
	if (!ok) console.error("FAIL", name);
}

const customerFields = shared.customer_form_fields({});
check("A customer dialog has no address fields", !customerFields.some((f) => f.fieldname === "address_line1"));
check("B customer type defaults to Individual", customerFields.find((f) => f.fieldname === "customer_type")?.default === "Individual");

const customer = { mobile_no: "0501111111" };
const home = { name: "ADDR-1", address_title: "Home", mobile_no: "0502222222", phone: "" };
const office = { name: "ADDR-2", address_title: "Office", phone: "0503333333" };

check("E address mobile defaults used in delivery phone", shared.delivery_contact_phone(home, customer) === "0502222222");
check("F address phone editable path uses phone field", shared.delivery_contact_phone(office, customer) === "0503333333");
check("H customer default unchanged in master", customer.mobile_no === "0501111111");
check("I snapshot uses address phone", store.snapshot_from_address(home, customer).nozom_customer_phone_snapshot === "0502222222");
check("J fallback to customer phone", store.snapshot_from_address({ name: "A", phone: "" }, customer).nozom_customer_phone_snapshot === "0501111111");

const pickup = shared.snapshot_pickup(customer);
check("K pickup has no shipping address name", !pickup.shipping_address_name);
check("L pickup uses customer default phone", pickup.nozom_customer_phone_snapshot === "0501111111");

const failed = results.filter((r) => !r.ok);
if (failed.length) {
	console.error(`\n${failed.length} failed of ${results.length}`);
	process.exit(1);
}

console.log(`OK ${results.length} customer/address flow checks`);
