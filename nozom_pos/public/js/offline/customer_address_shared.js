frappe.provide("nozom_pos.customer_address");

/**
 * Shared Customer / Address / fulfillment helpers for NOZOM POS (online + offline).
 */
nozom_pos.customer_address = {
	PICKUP_SELECTION_ID: "__NOZOM_STORE_PICKUP__",
	FULFILLMENT_DELIVERY: "Delivery",
	FULFILLMENT_PICKUP: "Pickup from Store",

	is_pickup_selection(name) {
		return name === this.PICKUP_SELECTION_ID;
	},

	customer_form_fields(seed = {}) {
		return [
			{
				fieldname: "customer_name",
				label: __("Customer Name"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.customer_name || "",
			},
			{
				fieldname: "customer_type",
				label: __("Customer Type"),
				fieldtype: "Select",
				options: "Individual\nCompany",
				default: seed.customer_type || "Individual",
				reqd: 1,
			},
			{
				fieldname: "mobile_no",
				label: __("Customer Mobile"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.mobile_no || "",
			},
		];
	},

	delivery_contact_phone(addr, customer_info = {}) {
		if (!addr || this.is_pickup_selection(addr.name)) {
			return cstr(customer_info.mobile_no || "").trim();
		}

		const mobile = cstr(addr.mobile_no || addr.nozom_mobile_no || "").trim();
		const phone = cstr(addr.phone || "").trim();

		return mobile || phone || cstr(customer_info.mobile_no || "").trim();
	},

	snapshot_pickup(customer_info = {}) {
		const phone = cstr(customer_info.mobile_no || "").trim();
		const pickup_title = __("Pickup from Store");

		return {
			customer_address: "",
			address_display: "",
			shipping_address_name: "",
			shipping_address: "",
			contact_mobile: phone,
			nozom_address_title_snapshot: pickup_title,
			nozom_customer_phone_snapshot: phone,
			nozom_delivery_location_link_snapshot: "",
			nozom_fulfillment_method: nozom_pos.customer_address.FULFILLMENT_PICKUP,
			_selected_address: nozom_pos.customer_address.PICKUP_SELECTION_ID,
			_local_address_id: null,
			selected_address_title: pickup_title,
			selected_address_display: "",
			selected_address_phone: phone,
			selected_location_link: "",
		};
	},
};
