erpnext.PointOfSale.ItemDetails = class {
	constructor({ wrapper, events, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.hide_images = settings.hide_images;
		this.allow_rate_change = settings.allow_rate_change;
		this.allow_discount_change = settings.allow_discount_change;
		this.current_item = {};
		this.frm_doctype = settings.frm_doctype;

		this.init_component();
	}

	init_component() {
		this.prepare_dom();
		this.init_child_components();
		this.bind_events();
		this.attach_shortcuts();
	}

	prepare_dom() {
		this.wrapper.append(`<section class="item-details-container"></section>`);

		this.$component = this.wrapper.find(".item-details-container");
	}

	init_child_components() {
		this.$component.html(
			`<div class="item-details-header">
				<div class="label">${__("Item Details")}</div>
				<div class="close-btn">
					<svg width="32" height="32" viewBox="0 0 14 14" fill="none">
						<path d="M4.93764 4.93759L7.00003 6.99998M9.06243 9.06238L7.00003 6.99998M7.00003 6.99998L4.93764 9.06238L9.06243 4.93759" stroke="#8D99A6"/>
					</svg>
				</div>
			</div>
			<div class="item-display">
				<div class="item-name-desc-price">
					<div class="item-name"></div>
					<div class="item-desc"></div>
					<div class="item-price"></div>
				</div>
				<div class="item-image"></div>
			</div>
			<div class="discount-section"></div>
			<div class="form-container"></div>
			<div class="serial-batch-container"></div>`
		);

		this.$item_name = this.$component.find(".item-name");
		this.$item_description = this.$component.find(".item-desc");
		this.$item_price = this.$component.find(".item-price");
		this.$item_image = this.$component.find(".item-image");
		this.$form_container = this.$component.find(".form-container");
		this.$dicount_section = this.$component.find(".discount-section");
		this.$serial_batch_container = this.$component.find(".serial-batch-container");
	}

	compare_with_current_item(item) {
		// returns true if `item` is currently being edited
		return item && item.name == this.current_item.name;
	}

	async toggle_item_details_section(item) {
		const current_item_changed = !this.compare_with_current_item(item);

		// if item is null or highlighted cart item is clicked twice
		const hide_item_details = !Boolean(item) || !current_item_changed;

		if ((!hide_item_details && current_item_changed) || hide_item_details) {
			// if item details is being closed OR if item details is opened but item is changed
			// in both cases, if the current item is a serialized item, then validate and remove the item
			await this.validate_serial_batch_item();
		}

		this.events.toggle_item_selector(!hide_item_details);
		this.toggle_component(!hide_item_details);

		if (item && current_item_changed) {
			this.doctype = item.doctype;
			this.item_meta = frappe.get_meta(this.doctype);
			this.name = item.name;
			this.item_row = item;
			this.currency = this.events.get_frm().doc.currency;

			this.current_item = item;

			this.render_dom(item);
			this.render_discount_dom(item);
			this.render_form(item);
			this.events.highlight_cart_item(item);
		} else {
			this.current_item = {};
		}
	}

	validate_serial_batch_item() {
		const doc = this.events.get_frm().doc;
		const item_row = doc.items.find((item) => item.name === this.name);

		if (!item_row) return;

		const serialized = item_row.has_serial_no;
		const batched = item_row.has_batch_no;
		const no_bundle_selected =
			!item_row.serial_and_batch_bundle && !item_row.serial_no && !item_row.batch_no;

		if ((serialized && no_bundle_selected) || (batched && no_bundle_selected)) {
			frappe.show_alert({
				message: __("Item is removed since no serial / batch no selected."),
				indicator: "orange",
			});
			frappe.utils.play_sound("cancel");
			return this.events.remove_item_from_cart();
		}
	}

	render_dom(item) {
		let { item_name, description, image, price_list_rate } = item;

		function get_description_html() {
			if (description) {
				description =
					description.indexOf("...") === -1 && description.length > 140
						? description.substr(0, 139) + "..."
						: description;
				return description;
			}
			return ``;
		}

		this.$item_name.html(item_name);
		this.$item_description.html(get_description_html());
		this.$item_price.html(format_currency(price_list_rate, this.currency));
		if (!this.hide_images && image) {
			this.$item_image.html(
				`<img
					onerror="cur_pos.item_details.handle_broken_image(this)"
					class="h-full" src="${image}"
					alt="${frappe.get_abbr(item_name)}"
					style="object-fit: cover;">`
			);
		} else {
			this.$item_image.html(`<div class="item-abbr">${frappe.get_abbr(item_name)}</div>`);
		}
	}

	handle_broken_image($img) {
		const item_abbr = $($img).attr("alt");
		$($img).replaceWith(`<div class="item-abbr">${item_abbr}</div>`);
	}

	render_discount_dom(item) {
		if (flt(item.discount_amount) || flt(item.discount_percentage)) {
			const discount_label = flt(item.discount_percentage)
				? `${flt(item.discount_percentage)}% off`
				: `${format_currency(item.discount_amount, this.currency)} off`;
			this.$dicount_section.html(
				`<div class="item-rate">${format_currency(item.price_list_rate, this.currency)}</div>
				<div class="item-discount">${discount_label}</div>`
			);
			this.$item_price.html(format_currency(item.rate, this.currency));
		} else {
			this.$dicount_section.html(``);
		}
	}

	render_form(item) {
		const fields_to_display = this.get_form_fields(item);
		this.$form_container.html("");

		fields_to_display.forEach((fieldname, idx) => {
			this.$form_container.append(
				`<div class="${fieldname}-control" data-fieldname="${fieldname}"></div>`
			);

			const field_meta = this.get_field_meta(fieldname);
			const me = this;

			this[`${fieldname}_control`] = frappe.ui.form.make_control({
				df: {
					...field_meta,
					onchange: function () {
						me.events.form_updated(me.current_item, fieldname, this.value);
					},
				},
				parent: this.$form_container.find(`.${fieldname}-control`),
				render_input: true,
			});
			this[`${fieldname}_control`].set_value(item[fieldname]);
		});

		// Compact order: qty/uom, rate/discount, stock fields, notes, serial/batch
		this.render_item_discount_control(item);
		this.$form_container.find(".item-discount-control").insertAfter(this.$form_container.find(".rate-control"));
		this.$form_container.find(".notes-control").insertAfter(this.$form_container.find(".item-discount-control"));

		this.resize_serial_control(item);
		this.resize_notes_control();
		this.make_auto_serial_selection_btn(item);

		this.bind_custom_control_change_event();
	}

	render_item_discount_control(item) {
		const me = this;
		const has_amount = flt(item.discount_amount) > 0;
		const has_percentage = flt(item.discount_percentage) > 0;
		this.item_discount_type = has_amount && !has_percentage ? "amount" : "percentage";

		this.$form_container.append(
			`<div class="item-discount-control" data-fieldname="item_discount">
				<div class="discount-type-toggle">
					<button type="button" class="discount-type-btn" data-discount-type="percentage">%</button>
					<button type="button" class="discount-type-btn" data-discount-type="amount">${__(
						"Amount"
					)}</button>
				</div>
				<div class="item-discount-value-field"></div>
			</div>`
		);

		this.$form_container
			.find(`.discount-type-btn[data-discount-type="${this.item_discount_type}"]`)
			.addClass("active");

		this.$form_container.find(".item-discount-control .discount-type-btn").on("click", function () {
			me.item_discount_type = $(this).attr("data-discount-type");
			me.$form_container.find(".item-discount-control .discount-type-btn").removeClass("active");
			$(this).addClass("active");
			me.refresh_item_discount_value_field(frappe.get_doc(me.doctype, me.name) || item);
			me.item_discount_value_control && me.item_discount_value_control.set_focus();
		});

		this.refresh_item_discount_value_field(item);
	}

	refresh_item_discount_value_field(item) {
		const me = this;
		const is_amount = this.item_discount_type === "amount";
		const current_value = is_amount ? flt(item.discount_amount) : flt(item.discount_percentage);

		this.$form_container.find(".item-discount-value-field").empty();
		this.item_discount_value_control = frappe.ui.form.make_control({
			df: {
				fieldtype: is_amount ? "Currency" : "Float",
				label: is_amount ? __("Discount Amount") : __("Discount (%)"),
				fieldname: is_amount ? "discount_amount" : "discount_percentage",
				options: is_amount ? this.currency : "",
				onchange: function () {
					me.apply_item_discount(flt(this.value));
				},
			},
			parent: this.$form_container.find(".item-discount-value-field"),
			render_input: true,
		});

		this.item_discount_value_control.df.read_only = !this.allow_discount_change;
		this.item_discount_value_control.refresh();
		this.item_discount_value_control.set_value(current_value);

		if (!this.allow_discount_change) {
			this.$form_container.find(".item-discount-control .discount-type-btn").prop("disabled", true);
		}
	}

	async apply_item_discount(value) {
		value = flt(value);
		const item_row = frappe.get_doc(this.doctype, this.name);
		if (!item_row) return;

		if (this.item_discount_type === "percentage") {
			if (value > 100) {
				frappe.msgprint({
					title: __("Invalid Discount"),
					indicator: "red",
					message: __("Discount cannot be greater than 100%."),
				});
				value = 0;
			}
			// Clear amount first so percentage-based calculation wins
			await frappe.model.set_value(this.doctype, this.name, "discount_amount", 0);
			await this.events.form_updated(this.current_item, "discount_percentage", value);
		} else {
			const max_amount = flt(item_row.price_list_rate || item_row.rate);
			if (max_amount > 0 && value > max_amount) {
				frappe.msgprint({
					title: __("Invalid Discount"),
					indicator: "red",
					message: __("Discount amount cannot be greater than item rate."),
				});
				value = 0;
			}
			await this.events.form_updated(this.current_item, "discount_amount", value);
		}

		const updated = frappe.get_doc(this.doctype, this.name);
		this.render_discount_dom(updated || item_row);
		if (this.item_discount_value_control && updated) {
			const display_value =
				this.item_discount_type === "amount"
					? flt(updated.discount_amount)
					: flt(updated.discount_percentage);
			if (flt(this.item_discount_value_control.get_value()) !== display_value) {
				this.item_discount_value_control.set_value(display_value);
			}
		}
	}

	set_discount_from_numpad(value) {
		this.item_discount_type = "percentage";
		this.$form_container.find(".item-discount-control .discount-type-btn").removeClass("active");
		this.$form_container
			.find('.item-discount-control .discount-type-btn[data-discount-type="percentage"]')
			.addClass("active");

		const item = frappe.get_doc(this.doctype, this.name) || this.current_item;
		this.refresh_item_discount_value_field(item);

		if (value !== "" && value != null) {
			this.item_discount_value_control.set_value(flt(value));
			this.apply_item_discount(flt(value));
		} else {
			this.item_discount_value_control.set_focus();
		}
	}

	get_field_meta(fieldname) {
		const field_meta = this.item_meta.fields.find((df) => df.fieldname === fieldname);
		if (field_meta) {
			return { ...field_meta };
		}

		if (fieldname === "notes") {
			return {
				fieldname: "notes",
				fieldtype: "Data",
				label: __("Item Notes"),
				placeholder: __("Item Notes"),
			};
		}

		return {
			fieldname,
			fieldtype: "Data",
			label: __(frappe.model.unscrub(fieldname)),
		};
	}

	get_form_fields(item) {
		const fields = ["qty", "uom", "rate", "conversion_factor", "warehouse", "actual_qty", "price_list_rate"];
		fields.push("notes");
		if (item.has_serial_no || item.serial_no) fields.push("serial_no");
		if (item.has_batch_no || item.batch_no) fields.push("batch_no");
		return fields;
	}

	resize_serial_control(item) {
		if (item.has_serial_no || item.serial_no) {
			this.$form_container.find(".serial_no-control").find("textarea").css("height", "6rem");
		}
	}

	resize_notes_control() {
		const $notes_input = this.$form_container.find(".notes-control input, .notes-control textarea");
		$notes_input.attr("placeholder", __("Item Notes")).addClass("item-notes-input");
	}

	make_auto_serial_selection_btn(item) {
		const doc = this.events.get_frm().doc;
		if (!doc.is_return && (item.has_serial_no || item.serial_no)) {
			if (!item.has_batch_no) {
				this.$form_container.append(`<div class="grid-filler no-select"></div>`);
			}
			const label = __("Auto Fetch Serial Numbers");
			this.$form_container.append(
				`<div class="btn btn-sm btn-secondary auto-fetch-btn">${label}</div>`
			);
			this.$form_container.find(".serial_no-control").find("textarea").css("height", "6rem");
		}
	}

	bind_custom_control_change_event() {
		const me = this;
		if (this.rate_control) {
			this.rate_control.df.onchange = function () {
				if (this.value || flt(this.value) === 0) {
					me.events.form_updated(me.current_item, "rate", this.value).then(() => {
						const item_row = frappe.get_doc(me.doctype, me.name);
						const doc = me.events.get_frm().doc;
						me.$item_price.html(format_currency(item_row.rate, doc.currency));
						me.render_discount_dom(item_row);
					});
				}
			};
			this.rate_control.df.read_only = !this.allow_rate_change;
			this.rate_control.refresh();
		}

		if (this.discount_percentage_control && !this.allow_discount_change) {
			this.discount_percentage_control.df.read_only = 1;
			this.discount_percentage_control.refresh();
		}

		if (this.discount_amount_control && !this.allow_discount_change) {
			this.discount_amount_control.df.read_only = 1;
			this.discount_amount_control.refresh();
		}

		if (this.warehouse_control) {
			this.warehouse_control.df.reqd = 1;
			this.warehouse_control.df.onchange = function () {
				if (this.value) {
					me.events.form_updated(me.current_item, "warehouse", this.value).then(() => {
						me.item_stock_map = me.events.get_item_stock_map();
						const available_qty = me.item_stock_map[me.item_row.item_code][this.value][0];
						const is_stock_item = Boolean(
							me.item_stock_map[me.item_row.item_code][this.value][1]
						);
						if (available_qty === undefined) {
							me.events.get_available_stock(me.item_row.item_code, this.value).then(() => {
								// item stock map is updated now reset warehouse
								me.warehouse_control.set_value(this.value);
							});
						} else if (available_qty === 0 && is_stock_item) {
							me.warehouse_control.set_value("");
							const bold_item_code = me.item_row.item_code.bold();
							const bold_warehouse = this.value.bold();
							frappe.throw(
								__("Item Code: {0} is not available under warehouse {1}.", [
									bold_item_code,
									bold_warehouse,
								])
							);
						}
						me.actual_qty_control.set_value(available_qty);
					});
				}
			};
			this.warehouse_control.df.get_query = () => {
				return {
					filters: { company: this.events.get_frm().doc.company, is_group: 0 },
				};
			};
			this.warehouse_control.refresh();
		}

		if (this.serial_no_control) {
			this.serial_no_control.df.reqd = 1;
			this.serial_no_control.df.onchange = async function () {
				!me.current_item.batch_no && (await me.auto_update_batch_no());
				me.events.form_updated(me.current_item, "serial_no", this.value);
			};
			this.serial_no_control.refresh();
		}

		if (this.batch_no_control) {
			this.batch_no_control.df.reqd = 1;
			this.batch_no_control.df.get_query = () => {
				return {
					query: "erpnext.controllers.queries.get_batch_no",
					filters: {
						item_code: me.item_row.item_code,
						warehouse: me.item_row.warehouse,
						posting_date: me.events.get_frm().doc.posting_date,
					},
				};
			};
			this.batch_no_control.refresh();
		}

		if (this.uom_control) {
			this.uom_control.df.onchange = function () {
				me.events.form_updated(me.current_item, "uom", this.value);

				const item_row = frappe.get_doc(me.doctype, me.name);
				me.conversion_factor_control.df.read_only = item_row.stock_uom == this.value;
				me.conversion_factor_control.refresh();
			};
			this.uom_control.df.get_query = () => {
				return {
					query: "erpnext.controllers.queries.get_item_uom_query",
					filters: {
						item_code: me.current_item.item_code,
					},
				};
			};
			this.uom_control.refresh();
		}

		const frm_doctype = this.events.get_frm().doc.doctype;

		frappe.model.on(`${frm_doctype} Item`, "*", (fieldname, value, item_row) => {
			const field_control = this[`${fieldname}_control`];
			const item_row_is_being_edited = this.compare_with_current_item(item_row);
			if (
				item_row_is_being_edited &&
				field_control &&
				field_control.get_value() !== value &&
				value == item_row[fieldname]
			) {
				field_control.set_value(value);
				cur_pos.update_cart_html(item_row);
			}
		});
	}

	async auto_update_batch_no() {
		if (this.serial_no_control && this.batch_no_control) {
			const selected_serial_nos = this.serial_no_control
				.get_value()
				.split(`\n`)
				.filter((s) => s);
			if (!selected_serial_nos.length) return;

			// find batch nos of the selected serial no
			const serials_with_batch_no = await frappe.db.get_list("Serial No", {
				filters: { name: ["in", selected_serial_nos] },
				fields: ["batch_no", "name"],
			});
			const batch_serial_map = serials_with_batch_no.reduce((acc, r) => {
				if (!acc[r.batch_no]) {
					acc[r.batch_no] = [];
				}
				acc[r.batch_no] = [...acc[r.batch_no], r.name];
				return acc;
			}, {});
			// set current item's batch no and serial no
			const batch_no = Object.keys(batch_serial_map)[0];
			const batch_serial_nos = batch_serial_map[batch_no].join(`\n`);
			// eg. 10 selected serial no. -> 5 belongs to first batch other 5 belongs to second batch
			const serial_nos_belongs_to_other_batch =
				selected_serial_nos.length !== batch_serial_map[batch_no].length;

			const current_batch_no = this.batch_no_control.get_value();
			current_batch_no != batch_no && (await this.batch_no_control.set_value(batch_no));

			if (serial_nos_belongs_to_other_batch) {
				this.serial_no_control.set_value(batch_serial_nos);
				this.qty_control.set_value(batch_serial_map[batch_no].length);

				delete batch_serial_map[batch_no];
				this.events.clone_new_batch_item_in_frm(batch_serial_map, this.current_item);
			}
		}
	}

	bind_events() {
		this.bind_auto_serial_fetch_event();
		this.bind_fields_to_numpad_fields();

		this.$component.on("click", ".close-btn", () => {
			this.events.close_item_details();
		});
	}

	attach_shortcuts() {
		this.wrapper.find(".close-btn").attr("title", "Esc");
		frappe.ui.keys.on("escape", () => {
			const item_details_visible = this.$component.is(":visible");
			if (item_details_visible) {
				this.events.close_item_details();
			}
		});
	}

	bind_fields_to_numpad_fields() {
		const me = this;
		this.$form_container.on("click", ".input-with-feedback", function () {
			const fieldname = $(this).attr("data-fieldname");
			if (this.last_field_focused != fieldname) {
				me.events.item_field_focused(fieldname);
				this.last_field_focused = fieldname;
			}
		});
	}

	bind_auto_serial_fetch_event() {
		this.$form_container.on("click", ".auto-fetch-btn", () => {
			this.batch_no_control && this.batch_no_control.set_value("");
			let qty = this.qty_control.get_value();
			let conversion_factor = this.conversion_factor_control.get_value();
			let expiry_date = this.item_row.has_batch_no ? this.events.get_frm().doc.posting_date : "";

			let numbers = frappe.call({
				method: "erpnext.stock.doctype.serial_no.serial_no.auto_fetch_serial_number",
				args: {
					qty: qty * conversion_factor,
					item_code: this.current_item.item_code,
					warehouse: this.warehouse_control.get_value() || "",
					batch_nos: this.current_item.batch_no || "",
					posting_date: expiry_date,
					for_doctype: this.frm_doctype,
				},
			});

			numbers.then((data) => {
				let auto_fetched_serial_numbers = data.message;
				let records_length = auto_fetched_serial_numbers.length;
				if (!records_length) {
					const warehouse = this.warehouse_control.get_value().bold();
					const item_code = this.current_item.item_code.bold();
					frappe.msgprint(
						__(
							"Serial numbers unavailable for Item {0} under warehouse {1}. Please try changing warehouse.",
							[item_code, warehouse]
						)
					);
				} else if (records_length < qty) {
					frappe.msgprint(__("Fetched only {0} available serial numbers.", [records_length]));
					this.qty_control.set_value(records_length);
				}
				numbers = auto_fetched_serial_numbers.join(`\n`);
				this.serial_no_control.set_value(numbers);
			});
		});
	}

	toggle_component(show) {
		show ? this.$component.css("display", "flex") : this.$component.css("display", "none");
	}
};
