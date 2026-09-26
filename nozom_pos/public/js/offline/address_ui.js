frappe.provide("nozom_pos");

/**
 * Compact touch-friendly Address pick / add / edit dialogs for POS.
 * Online and offline share the same UI; persistence differs.
 */
nozom_pos.address_ui = (() => {
	const store = () => nozom_pos.offline.address_store;

	function is_online() {
		return !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
	}

	function address_form_fields(seed = {}) {
		return [
			{
				fieldname: "address_title",
				label: __("Address Title"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.address_title || "",
				description: __("e.g. Home, Office, Villa"),
			},
			{
				fieldname: "address_line1",
				label: __("Address Line 1"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.address_line1 || "",
			},
			{
				fieldname: "address_line2",
				label: __("Address Line 2"),
				fieldtype: "Data",
				default: seed.address_line2 || "",
			},
			{
				fieldname: "city",
				label: __("City"),
				fieldtype: "Data",
				reqd: 1,
				default: seed.city || "",
			},
			{
				fieldname: "state",
				label: __("State / Emirate"),
				fieldtype: "Data",
				default: seed.state || "",
			},
			{
				fieldname: "pincode",
				label: __("Postal Code"),
				fieldtype: "Data",
				default: seed.pincode || "",
			},
			{
				fieldname: "country",
				label: __("Country"),
				fieldtype: "Link",
				options: "Country",
				default: seed.country || "",
			},
			{
				fieldname: "phone",
				label: __("Phone"),
				fieldtype: "Data",
				default: seed.phone || "",
			},
			{
				fieldname: "nozom_delivery_location_link",
				label: __("Delivery Location Link"),
				fieldtype: "Data",
				options: "URL",
				default: seed.nozom_delivery_location_link || "",
				description: __("Optional map URL (http/https only)."),
			},
		];
	}

	async function default_country(cart) {
		const company = cart?.events?.get_frm?.()?.doc?.company;
		if (company) {
			try {
				const r = await frappe.db.get_value("Company", company, "country");
				if (r?.message?.country) return r.message.country;
			} catch (e) {
				/* offline */
			}
		}
		return frappe.boot?.sysdefaults?.country || "United Arab Emirates";
	}

	async function save_address_online(customer, values, existing_name = null) {
		const location = store().sanitize_location(values.nozom_delivery_location_link);
		if (cstr(values.nozom_delivery_location_link || "").trim() && !location) {
			throw new Error(__("Delivery Location Link must be an http:// or https:// URL."));
		}
		const country = cstr(values.country || "").trim() || (await default_country());
		const city = cstr(values.city || "").trim() || cstr(values.address_line1 || "").trim() || "N/A";

		const payload = {
			doctype: "Address",
			address_title: values.address_title,
			address_type: "Shipping",
			address_line1: values.address_line1,
			address_line2: values.address_line2 || "",
			city,
			state: values.state || "",
			pincode: values.pincode || "",
			country,
			phone: values.phone || "",
			nozom_delivery_location_link: location,
			is_shipping_address: 1,
			links: [{ link_doctype: "Customer", link_name: customer }],
		};

		if (existing_name) {
			const doc = await frappe.db.get_doc("Address", existing_name);
			Object.assign(doc, payload);
			doc.name = existing_name;
			await frappe.call({
				method: "frappe.client.save",
				args: { doc },
			});
			return existing_name;
		}

		const doc = await frappe.db.insert(payload);
		return doc.name;
	}

	function open_add_edit(cart, { mode = "add", seed = {}, on_saved = null } = {}) {
		const customer = cart.customer_info?.customer;
		if (!customer) {
			frappe.msgprint(__("Select a customer first."));
			return;
		}

		const title = mode === "edit" ? __("Edit Address") : __("Add Address");
		const d = new frappe.ui.Dialog({
			title,
			fields: address_form_fields(seed),
			primary_action_label: __("Save"),
			primary_action: async (values) => {
				const pos_profile = cart.events.get_frm?.()?.doc?.pos_profile;
				try {
					let record = null;
					if (!is_online()) {
						if (mode === "edit" && seed.name) {
							record = await store().update_local(pos_profile, seed.name, values);
						} else {
							record = await store().create_local(pos_profile, customer, values);
						}
					} else {
						const name = await save_address_online(
							customer,
							values,
							mode === "edit" ? seed.name || seed.server_address_name : null
						);
						const fetched = await frappe.db.get_doc("Address", name);
						record = await store().upsert(pos_profile, {
							...fetched,
							customer,
							server_customer_name: customer,
							server_address_name: name,
							server_modified: fetched.modified,
							nozom_delivery_location_link:
								fetched.nozom_delivery_location_link || values.nozom_delivery_location_link,
						});
					}
					d.hide();
					if (on_saved) await on_saved(record);
					// Cart / address UI updates — no success toast
				} catch (e) {
					frappe.msgprint(e.message || __("Could not save address."));
				}
			},
		});
		d.$wrapper.addClass("nozom-pos-centered-dialog nozom-address-dialog");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		d.show();
	}

	function open_change(cart, { on_selected = null } = {}) {
		const customer = cart.customer_info?.customer;
		const customer_name = cart.customer_info?.customer_name || customer;
		if (!customer) {
			frappe.msgprint(__("Select a customer first."));
			return;
		}

		const pos_profile = cart.events.get_frm?.()?.doc?.pos_profile;
		const selected = cart.selected_address_name || cart.customer_info?._selected_address;
		let rows_cache = [];

		const d = new frappe.ui.Dialog({
			title: __("Change Address"),
			fields: [
				{
					fieldname: "hint",
					fieldtype: "HTML",
					options: `<div class="nozom-addr-picker-head"><strong>${frappe.utils.escape_html(
						customer_name
					)}</strong></div>`,
				},
				{
					fieldname: "search",
					label: __("Search"),
					fieldtype: "Data",
					placeholder: __("Title, city, address..."),
				},
				{ fieldname: "list", fieldtype: "HTML" },
			],
			secondary_action_label: __("Add New Address"),
			secondary_action: () => {
				d.hide();
				open_add_edit(cart, {
					mode: "add",
					on_saved: async (record) => {
						if (on_selected) await on_selected(record);
					},
				});
			},
		});

		async function render(term = "") {
			rows_cache = await store().list_for_customer(pos_profile, customer, { search: term });
			const $list = d.fields_dict.list.$wrapper;
			if (!rows_cache.length) {
				$list.html(
					`<div class="nozom-addr-empty">${__("No delivery address")}<br>
					<button type="button" class="btn btn-sm btn-primary nozom-addr-add-empty">${__(
						"Add Address"
					)}</button></div>`
				);
				$list.find(".nozom-addr-add-empty").on("click", () => {
					d.hide();
					open_add_edit(cart, {
						mode: "add",
						on_saved: async (record) => {
							if (on_selected) await on_selected(record);
						},
					});
				});
				return;
			}

			$list.html(
				`<div class="nozom-addr-list">${rows_cache
					.map((r) => {
						const loc = r.nozom_delivery_location_link
							? `<div class="nozom-addr-loc">📍 ${__("Location available")}</div>`
							: "";
						const active = r.name === selected ? "is-selected" : "";
						return `<button type="button" class="nozom-addr-card ${active}" data-name="${frappe.utils.escape_html(
							r.name
						)}">
							<div class="nozom-addr-card__title">${frappe.utils.escape_html(r.address_title)}</div>
							<div class="nozom-addr-card__body">${frappe.utils.escape_html(r.display || r.address_line1)}</div>
							${loc}
						</button>`;
					})
					.join("")}</div>`
			);

			$list.find(".nozom-addr-card").on("click", async function () {
				const name = $(this).attr("data-name");
				const row = rows_cache.find((r) => r.name === name);
				d.hide();
				if (row && on_selected) await on_selected(row);
			});
		}

		d.fields_dict.search.$input.on("input", function () {
			render(this.value);
		});

		d.$wrapper.addClass("nozom-pos-centered-dialog nozom-address-dialog");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		d.show();
		render();
	}

	return { open_add_edit, open_change, address_form_fields };
})();
