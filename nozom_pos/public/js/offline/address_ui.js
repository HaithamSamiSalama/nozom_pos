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

	function address_form_fields(seed = {}, { customer_label = "" } = {}) {
		const fields = [];

		if (customer_label) {
			fields.push({
				fieldname: "linked_customer",
				label: __("Customer"),
				fieldtype: "Data",
				read_only: 1,
				default: customer_label,
			});
		}

		fields.push(
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
				label: __("Emirate"),
				fieldtype: "Select",
				options: [
					"",
					"Abu Dhabi",
					"Dubai",
					"Sharjah",
					"Ajman",
					"Umm Al Quwain",
					"Ras Al Khaimah",
					"Fujairah",
				].join("\n"),
				default: seed.state || "",
			},
			{
				fieldname: "country",
				label: __("Country"),
				fieldtype: "Link",
				options: "Country",
				default: seed.country || "",
			},
			{
				fieldname: "mobile_no",
				label: __("Mobile"),
				fieldtype: "Data",
				default: seed.mobile_no || "",
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
			}
		);

		return fields.filter(
			(field) => !["mobile_no", "phone"].includes(field.fieldname)
		);
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
			nozom_mobile_no: values.mobile_no || "",
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

	function open_add_edit(cart, { mode = "add", seed = {}, on_saved = null, customer_label = "" } = {}) {
		const customer = cart.customer_info?.customer;
		if (!customer) {
			frappe.msgprint(__("Select a customer first."));
			return;
		}

		const contact_mobile = cstr(cart.customer_info?.mobile_no || "").trim();
		const merged_seed = {
			...seed,
			mobile_no: seed.mobile_no || contact_mobile,
			phone: seed.phone || contact_mobile,
		};

		const title = mode === "edit" ? __("Edit Address") : __("Add Address");
		const d = new frappe.ui.Dialog({
			title,
			fields: address_form_fields(merged_seed, {
				customer_label: customer_label || cart.customer_info?.customer_name || customer,
			}),
			primary_action_label: __("Save"),
			secondary_action_label: __("Back"),
			secondary_action: () => d.hide(),
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
							mobile_no: fetched.nozom_mobile_no || values.mobile_no || "",
							nozom_delivery_location_link:
								fetched.nozom_delivery_location_link || values.nozom_delivery_location_link,
						});
					}
					d.hide();
					if (on_saved) await on_saved(record);
				} catch (e) {
					frappe.msgprint(e.message || __("Could not save address."));
				}
			},
		});
		d.$wrapper.addClass("nozom-pos-centered-dialog nozom-address-dialog");
		nozom_pos.i18n?.apply_direction?.(nozom_pos.i18n.get());
		d.show();

		// NOZOM: final compact address labels/actions.
		const address_is_ar = nozom_pos.i18n?.get?.() === "ar";

		if (d.fields_dict.address_title) {
			d.fields_dict.address_title.df.label = address_is_ar
				? "تسمية العنوان"
				: "Address Label";
			d.fields_dict.address_title.refresh();
		}

		if (d.fields_dict.city) {
			d.fields_dict.city.df.label = address_is_ar ? "المدينة" : "City";
			d.fields_dict.city.refresh();
		}

		if (d.fields_dict.state) {
			d.fields_dict.state.df.label = address_is_ar ? "الإمارة" : "Emirate";
			d.fields_dict.state.refresh();
		}

		if (d.fields_dict.country) {
			d.fields_dict.country.df.label = address_is_ar ? "الدولة" : "Country";
			d.fields_dict.country.refresh();
		}

		if (address_is_ar) {
			d.$wrapper.find(".modal-footer .btn-primary").text("حفظ");
			d.$wrapper
				.find(".modal-footer .btn-secondary, .modal-footer .btn-default")
				.filter(":visible")
				.first()
				.text("عودة");
		}

		// NOZOM: address dialog cleanup
		if (d.fields_dict.pincode) {
			d.fields_dict.pincode.df.hidden = 1;
			d.fields_dict.pincode.refresh();
			d.fields_dict.pincode.$wrapper.hide();
		}


		// City + Emirate + Country in one aligned row
		const $city = d.fields_dict.city?.$wrapper;
		const $state = d.fields_dict.state?.$wrapper;
		const $country = d.fields_dict.country?.$wrapper;

		if ($city?.length && $state?.length && $country?.length) {
			let $location_row = d.$wrapper.find(".nozom-address-location-row");

			if (!$location_row.length) {
				$location_row = $('<div class="nozom-address-location-row"></div>');
				$city.before($location_row);
			}

			$location_row.append($city, $state, $country);
		}

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
		const pickup_id = nozom_pos.customer_address.PICKUP_SELECTION_ID;
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
			secondary_action_label: __("Add Address"),
			secondary_action: () => {
				d.hide();
				const contact_mobile = cstr(cart.customer_info?.mobile_no || "").trim();
				open_add_edit(cart, {
					mode: "add",
					seed: {
						mobile_no: contact_mobile,
						phone: contact_mobile,
					},
					on_saved: async (record) => {
						if (on_selected) await on_selected(record);
					},
				});
			},
		});

		function pickup_card() {
			const active = selected === pickup_id ? "is-selected" : "";
			return `<button type="button" class="nozom-addr-card nozom-addr-card--pickup ${active}" data-name="${pickup_id}">
				<div class="nozom-addr-card__title">${frappe.utils.escape_html(__("Pickup from Store"))}</div>
				<div class="nozom-addr-card__body">${frappe.utils.escape_html(
					__("Customer collects the order from the store.")
				)}</div>
			</button>`;
		}

		async function render(term = "") {
			rows_cache = await store().list_for_customer(pos_profile, customer, { search: term });
			const $list = d.fields_dict.list.$wrapper;

			$list.html(
				`<div class="nozom-addr-list">${pickup_card()}${rows_cache
					.map((r) => {
						const loc = r.nozom_delivery_location_link
							? `<div class="nozom-addr-loc">📍 ${__("Location available")}</div>`
							: "";
						const contact = cstr(r.mobile_no || r.phone || "").trim();
						const phone_line = contact
							? `<div class="nozom-addr-phone" dir="ltr">${frappe.utils.escape_html(contact)}</div>`
							: "";
						const active = r.name === selected ? "is-selected" : "";
						return `<button type="button" class="nozom-addr-card ${active}" data-name="${frappe.utils.escape_html(
							r.name
						)}">
							<div class="nozom-addr-card__title">${frappe.utils.escape_html(r.address_title)}</div>
							<div class="nozom-addr-card__body">${frappe.utils.escape_html(r.display || r.address_line1)}</div>
							${phone_line}
							${loc}
						</button>`;
					})
					.join("")}</div>`
			);

			if (!rows_cache.length) {
				$list.append(
					`<div class="nozom-addr-empty">${__("No delivery addresses yet.")}</div>`
				);
			}

			$list.find(".nozom-addr-card").on("click", async function () {
				const name = $(this).attr("data-name");
				d.hide();
				if (name === pickup_id) {
					if (on_selected) {
						await on_selected({ name: pickup_id });
					}
					return;
				}
				const row = rows_cache.find((r) => r.name === name);
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
