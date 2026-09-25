erpnext.PointOfSale.Controller = class {
	constructor(wrapper) {
		this.wrapper = $(wrapper).find(".layout-main-section");
		this.page = wrapper.page;

		this.check_opening_entry();
	}

	fetch_opening_entry() {
		return frappe.call("erpnext.selling.page.point_of_sale.point_of_sale.check_opening_entry", {
			user: frappe.session.user,
		});
	}

	check_opening_entry() {
		this.fetch_opening_entry().then((r) => {
			if (r.message.length) {
				// assuming only one opening voucher is available for the current user
				this.prepare_app_defaults(r.message[0]);
			} else {
				this.create_opening_voucher();
			}
		});
	}

	create_opening_voucher() {
		if (window.nozom_pos?.close_period?.open_period_popup) {
			nozom_pos.close_period.open_period_popup(this, {
				company: frappe.defaults.get_default("company"),
				pos_profile: this.pos_profile,
			});
			return;
		}
		frappe.msgprint(__("Opening Period UI is unavailable."));
	}

	async prepare_app_defaults(data) {
		this.teardown_listener_for_pos_closing();
		this.unlock_closed_pos_workspace();
		this.nozom_period_closed = false;
		this.nozom_close_in_progress = false;
		this.nozom_last_closing = null;

		this.pos_opening = data.name;
		this.company = data.company;
		this.pos_profile = data.pos_profile;
		this.pos_opening_time = data.period_start_date;
		this.item_stock_map = {};
		this.settings = {};

		frappe.db.get_value("Stock Settings", undefined, "allow_negative_stock").then(({ message }) => {
			this.allow_negative_stock = flt(message.allow_negative_stock) || false;
		});

		const invoice_doctype = await frappe.db.get_single_value("POS Settings", "invoice_type");

		frappe.call({
			method: "erpnext.selling.page.point_of_sale.point_of_sale.get_pos_profile_data",
			args: { pos_profile: this.pos_profile },
			callback: (res) => {
				const profile = res.message;
				Object.assign(this.settings, profile);
				this.settings.customer_groups = profile.customer_groups.map((group) => group.name);
				this.settings.frm_doctype = invoice_doctype;
				this.make_app();
			},
		});

		this.fetch_invoice_fields();
		this.setup_listener_for_pos_closing();
		//this.check_outdated_pos_opening_entry();
	}

	async fetch_invoice_fields() {
		this.settings.invoice_fields = new Array();
		const pos_settings = await frappe.db.get_doc("POS Settings", undefined);
		pos_settings.invoice_fields.forEach((field) => {
			this.settings.invoice_fields.push({
				fieldname: field.fieldname,
				label: field.label,
				fieldtype: field.fieldtype,
				reqd: field.reqd,
				options: field.options,
				default_value: field.default_value,
				read_only: field.read_only,
			});
		});
	}

	teardown_listener_for_pos_closing() {
		if (this._poe_event && this._poe_handler) {
			try {
				frappe.realtime.off(this._poe_event, this._poe_handler);
			} catch (e) {
				/* ignore */
			}
		}
		this._poe_event = null;
		this._poe_handler = null;
	}

	/**
	 * ERPNext POS Closing Entry.on_submit publishes realtime `poe_{opening}`.
	 * Stock ERPNext freezes the page and asks for refresh ("POS Closed...").
	 * For NOZOM-managed closes we suppress that and keep the post-close dialog.
	 */
	setup_listener_for_pos_closing() {
		this.teardown_listener_for_pos_closing();
		if (!this.pos_opening) return;

		this._poe_event = `poe_${this.pos_opening}`;
		this._poe_handler = (data) => {
			const route = frappe.get_route_str();
			if (!data || route !== "point-of-sale") return;

			if (data.operation === "Closed") {
				if (this.nozom_close_in_progress || this.nozom_period_closed) {
					this.lock_closed_pos_workspace();
					try {
						frappe.hide_msgprint?.();
					} catch (e) {
						/* ignore */
					}
					try {
						frappe.dom.unfreeze();
					} catch (e) {
						/* ignore */
					}
					return;
				}
			}

			frappe.dom.freeze();
			const title =
				data.operation === "Closed" ? __("POS Closed") : __("POS Opening Entry Cancelled");
			const msg =
				data.operation === "Closed"
					? __("POS has been closed at {0}. Please refresh the page.", [
							frappe.datetime.str_to_user(data.doc?.creation || data.doc?.modified).bold(),
					  ])
					: __("POS Opening Entry has been cancelled. Please refresh the page.");
			frappe.msgprint({
				title: title,
				indicator: "orange",
				message: msg,
				primary_action_label: __("Refresh"),
				primary_action: {
					action() {
						window.location.reload();
					},
				},
			});
		};
		frappe.realtime.on(this._poe_event, this._poe_handler);
	}

	begin_nozom_close() {
		this.nozom_close_in_progress = true;
	}

	complete_nozom_close(closing_payload = {}) {
		this.nozom_close_in_progress = false;
		this.nozom_period_closed = true;
		this.nozom_last_closing = closing_payload;
		this.lock_closed_pos_workspace();
		try {
			frappe.hide_msgprint?.();
		} catch (e) {
			/* ignore */
		}
	}

	fail_nozom_close() {
		this.nozom_close_in_progress = false;
	}

	lock_closed_pos_workspace() {
		const $app = this.wrapper?.find?.(".point-of-sale-app");
		if ($app?.length) {
			$app.addClass("nozom-pos-period-locked");
			$app.attr("aria-disabled", "true");
		}
		this.wrapper?.addClass?.("nozom-pos-period-locked-host");
		try {
			this.cart?.toggle_checkout_btn?.(false);
			this.item_selector?.toggle_component?.(false);
			this.item_details?.toggle_component?.(false);
			this.payment?.toggle_component?.(false);
		} catch (e) {
			/* ignore */
		}
	}

	unlock_closed_pos_workspace() {
		const $app = this.wrapper?.find?.(".point-of-sale-app");
		if ($app?.length) {
			$app.removeClass("nozom-pos-period-locked");
			$app.removeAttr("aria-disabled");
		}
		this.wrapper?.removeClass?.("nozom-pos-period-locked-host");
	}

	//check_outdated_pos_opening_entry() {
	// if (frappe.datetime.get_day_diff(frappe.datetime.get_today(), this.pos_opening_time.slice(0, 10))) {
	// 	frappe.msgprint({
	// 		title: __("Outdated POS Opening Entry"),
	// 		message: __(
	// 			"The current POS opening entry is outdated. Please close it and create a new one."
	// 		),
	// 		indicator: "yellow",
	// 	});
	// }
	//}

	set_opening_entry_status() {
		this.page.set_title_sub(
			`<span class="indicator orange">
				<a class="text-muted" href="#Form/POS%20Opening%20Entry/${this.pos_opening}">
					Opened at ${frappe.datetime.str_to_user(this.pos_opening_time)}
				</a>
			</span>`
		);
	}

	make_app() {
		this.prepare_dom();
		this.prepare_components();
		this.prepare_menu();
		this.prepare_btns();
		this.init_offline_layer();
		this.make_new_invoice().then(() => this.maybe_restore_local_cart());
		// POS-only language (localStorage) — never User/Desk language
		nozom_pos.i18n?.boot_on_pos?.().then(() => {
			this.prepare_btns();
			this.cart?.update_customer_section?.();
		});
	}

	prepare_dom() {
		this.wrapper.append(`<div class="point-of-sale-app"></div>`);

		this.$components_wrapper = this.wrapper.find(".point-of-sale-app");
	}

	init_offline_layer() {
		if (!window.nozom_pos?.offline?.init) return;

		nozom_pos.offline
			.init({
				wrapper: this.wrapper,
				page: this.page,
				pos_profile: this.pos_profile,
				company: this.company,
				pos_opening: this.pos_opening,
				settings: this.settings,
				price_list: this.settings?.selling_price_list,
			})
			.then(async () => {
				if (nozom_pos.offline.network?.is_online?.() && nozom_pos.offline.preload) {
					try {
						await nozom_pos.offline.preload.preload_all(this);
					} catch (e) {
						console.warn("NOZOM POS preload failed:", e);
					}
				}
			})
			.catch((e) => console.warn("NOZOM POS offline init failed:", e));

		$(window).on("beforeunload.nozom_pos_cart", () => {
			if (!window.nozom_pos?.offline?.cart || !this.frm?.doc) return;
			if (this._restoring_local_cart) return;
			nozom_pos.offline.cart.flush_sync(this.frm, this.get_cart_persist_ctx());
		});
	}

	get_cart_persist_ctx() {
		return {
			pos_profile: this.pos_profile,
			company: this.company,
			pos_opening: this.pos_opening,
			user: frappe.session.user,
			settings: this.settings,
		};
	}

	schedule_cart_persist() {
		if (!window.nozom_pos?.offline?.cart || !this.frm?.doc) return;
		if (this._restoring_local_cart) return;

		clearTimeout(this._cart_persist_timer);
		this._cart_persist_timer = setTimeout(() => {
			this.persist_local_cart();
		}, 350);
	}

	async persist_local_cart() {
		if (!window.nozom_pos?.offline?.cart || !this.frm?.doc) return;
		if (this._restoring_local_cart) return;

		try {
			const snapshot = await nozom_pos.offline.cart.save(this.frm, this.get_cart_persist_ctx());
			if (window.nozom_pos?.offline?.status_ui) {
				nozom_pos.offline.status_ui.update({
					cart_saved: Boolean(snapshot?.items?.length || snapshot?.customer),
				});
			}
		} catch (e) {
			console.warn("NOZOM POS cart persist failed:", e);
		}
	}

	async clear_local_cart() {
		if (!window.nozom_pos?.offline?.cart) return;
		try {
			await nozom_pos.offline.cart.clear(this.get_cart_persist_ctx());
			if (window.nozom_pos?.offline?.status_ui) {
				nozom_pos.offline.status_ui.update({ cart_saved: false });
			}
		} catch (e) {
			console.warn("NOZOM POS cart clear failed:", e);
		}
	}

	async maybe_restore_local_cart() {
		if (!window.nozom_pos?.offline?.cart || this._cart_restore_checked) return;
		this._cart_restore_checked = true;

		let snapshot = null;
		try {
			snapshot = await nozom_pos.offline.cart.load(this.get_cart_persist_ctx());
		} catch (e) {
			console.warn("NOZOM POS cart load failed:", e);
			return;
		}

		if (!nozom_pos.offline.cart.has_content(snapshot)) {
			await this.clear_local_cart();
			return;
		}
		if (this.frm?.doc?.items?.length) return;

		const item_count = snapshot.items?.length || 0;
		if (!item_count) {
			await this.clear_local_cart();
			return;
		}

		const customer_label = snapshot.customer_name || snapshot.customer || __("No customer");

		frappe.confirm(
			__(
				"A previous cart was found ({0} items, {1}). Restore it?",
				[item_count, customer_label]
			),
			() => this.restore_local_cart(snapshot),
			() => this.clear_local_cart()
		);
	}

	async restore_local_cart(snapshot) {
		if (!snapshot || !this.frm) return;

		this._restoring_local_cart = true;
		frappe.dom.freeze(__("Restoring cart..."));

		try {
			if (snapshot.customer) {
				await this.frm.set_value("customer", snapshot.customer);
				if (this.cart?.fetch_customer_details) {
					await this.cart.fetch_customer_details(snapshot.customer);
					const preferred =
						snapshot._selected_address ||
						snapshot.shipping_address_name ||
						snapshot.customer_address ||
						null;
					await this.cart.load_default_address_for_customer?.(snapshot.customer, preferred);
					if (snapshot.address_display || snapshot.nozom_delivery_location_link_snapshot) {
						this.cart.apply_address_snapshot_to_doc?.({
							customer_address: snapshot.customer_address || "",
							address_display: snapshot.address_display || "",
							shipping_address_name: snapshot.shipping_address_name || "",
							shipping_address: snapshot.shipping_address || "",
							contact_mobile: snapshot.contact_mobile || "",
							nozom_address_title_snapshot: snapshot.nozom_address_title_snapshot || "",
							nozom_customer_phone_snapshot: snapshot.nozom_customer_phone_snapshot || "",
							nozom_delivery_location_link_snapshot:
								snapshot.nozom_delivery_location_link_snapshot || "",
							_selected_address: preferred,
							_local_address_id: snapshot._local_address_id || null,
						});
					}
					this.cart.events.customer_details_updated(this.cart.customer_info);
					this.cart.update_customer_section();
				}
			}

			for (const item of snapshot.items || []) {
				const row = await this.on_cart_update({
					field: "qty",
					value: item.qty,
					item: {
						item_code: item.item_code,
						batch_no: item.batch_no || null,
						serial_no: item.serial_no || "",
						rate: item.rate,
						uom: item.uom,
						stock_uom: item.stock_uom,
					},
				});

				if (!row || $.isEmptyObject(row)) continue;

				if (item.notes) {
					await frappe.model.set_value(row.doctype, row.name, "notes", item.notes);
				}
				if (flt(item.discount_percentage)) {
					await frappe.model.set_value(
						row.doctype,
						row.name,
						"discount_percentage",
						item.discount_percentage
					);
				} else if (flt(item.discount_amount)) {
					await frappe.model.set_value(
						row.doctype,
						row.name,
						"discount_amount",
						item.discount_amount
					);
				}
				if (flt(item.rate) && flt(row.rate) !== flt(item.rate)) {
					await frappe.model.set_value(row.doctype, row.name, "rate", item.rate);
				}
				this.update_cart_html(row);
			}

			if (snapshot.order_notes) {
				await this.frm.set_value("order_notes", snapshot.order_notes);
				this.cart?.set_order_note_value?.(snapshot.order_notes);
			}

			if (snapshot.nozom_order_number) {
				this.frm.doc.nozom_order_number = snapshot.nozom_order_number;
				try {
					await this.frm.set_value("nozom_order_number", snapshot.nozom_order_number);
				} catch (e) {
					this.frm.doc.nozom_order_number = snapshot.nozom_order_number;
				}
				this.cart?.set_order_number_value?.(snapshot.nozom_order_number);
			}

			if (flt(snapshot.additional_discount_percentage)) {
				await this.frm.set_value(
					"additional_discount_percentage",
					snapshot.additional_discount_percentage
				);
			} else if (flt(snapshot.discount_amount)) {
				await this.frm.set_value("discount_amount", snapshot.discount_amount);
			}

			this.cart?.load_invoice?.();
			if (snapshot._nozom_local_draft_id) {
				this.frm.doc._nozom_local_draft_id = snapshot._nozom_local_draft_id;
			}
			await this.persist_local_cart();
			this.update_draft_btn_state();

			(nozom_pos.notify || frappe.show_alert)({
				message: snapshot._nozom_local_draft_id
					? __("Local Draft loaded for editing.")
					: __("Previous cart restored."),
				indicator: "green",
			});
		} catch (e) {
			console.error(e);
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Could not fully restore the previous cart."),
				indicator: "orange",
			});
		} finally {
			this._restoring_local_cart = false;
			frappe.dom.unfreeze();
		}
	}

	prepare_components() {
		this.init_item_selector();
		this.init_item_details();
		this.init_item_cart();
		this.init_payments();
		this.init_recent_order_list();
		this.init_order_summary();
	}

	prepare_menu() {
		// Three-dot menu removed — Sync Queue is a dedicated top-bar button.
		this.page.clear_menu();
	}

	prepare_btns() {
		this.page.clear_custom_actions();
		this.page.clear_icons();
		this.page.clear_menu();

		const lang = nozom_pos.i18n?.get?.() || "en";
		const lang_label = lang === "ar" ? "EN" : "عربي";
		const lang_title = lang === "ar" ? __("Switch to English") : __("Switch to Arabic");
		const lang_btn = this.page.add_inner_button(lang_label, () => {
			nozom_pos.i18n?.toggle?.();
		});
		lang_btn
			.removeClass("btn-default btn-secondary btn-primary")
			.addClass("nozom-top-action-btn nozom-pos-lang-btn")
			.attr("title", lang_title)
			.attr("aria-label", lang_title)
			.html(`<span class="nozom-pos-lang-label nozom-top-action-label">${lang_label}</span>`);
		this._lang_btn = lang_btn;

		const sync_queue_btn = this.page.add_inner_button(__("Sync Queue"), () => {
			nozom_pos.offline?.status_ui?.open_queue?.() || nozom_pos.offline?.conflict_ui?.open?.();
		});
		sync_queue_btn
			.removeClass("btn-default btn-secondary btn-primary")
			.addClass("nozom-top-action-btn nozom-sync-queue-btn")
			.html(
				`<span class="nozom-top-action-label">${__("Sync Queue")}</span><span class="nozom-sync-queue-count badge" hidden>0</span>`
			);
		this._sync_queue_btn = sync_queue_btn;

		const fullscreen_btn = this.page.add_inner_button(__("Fullscreen"), () => {
			nozom_pos.offline?.status_ui?.toggle_fullscreen?.();
		});
		fullscreen_btn
			.removeClass("btn-default btn-secondary")
			.addClass("nozom-top-action-btn nozom-fullscreen-btn")
			.attr("aria-pressed", "false")
			.html(`<span class="nozom-fullscreen-label nozom-top-action-label">${__("Fullscreen")}</span>`);
		this._fullscreen_btn = fullscreen_btn;

		const close_pos_btn = this.page.add_inner_button(
			__("Close POS"),
			this.close_pos.bind(this)
		);
		close_pos_btn
			.removeClass("btn-default btn-secondary btn-success")
			.addClass("nozom-top-action-btn nozom-close-pos-btn");
		this._close_pos_btn = close_pos_btn;

		this.page.clear_primary_action?.();
		this.page.set_secondary_action(__("Recent Orders"), this.toggle_recent_order.bind(this));
		const recent_btn = this.page.btn_secondary;
		if (recent_btn?.length) {
			recent_btn
				.removeClass("btn-default btn-secondary")
				.addClass("nozom-top-action-btn nozom-recent-orders-btn");
		}

		// Order (right): Language → Sync Queue → Fullscreen → Close POS → Recent Orders
		const $actions = $(this.page.wrapper).find(".page-head .standard-actions, .page-head .custom-actions").first();
		if ($actions.length) {
			[lang_btn, sync_queue_btn, fullscreen_btn, close_pos_btn, recent_btn].forEach(($b) => {
				if ($b?.length) $actions.append($b);
			});
		} else {
			if (fullscreen_btn?.length && sync_queue_btn?.length) {
				sync_queue_btn.insertBefore(fullscreen_btn);
			}
			if (fullscreen_btn?.length && close_pos_btn?.length) {
				fullscreen_btn.insertBefore(close_pos_btn);
			}
			if (lang_btn?.length && sync_queue_btn?.length) {
				lang_btn.insertBefore(sync_queue_btn);
			}
		}

		nozom_pos.i18n?.update_lang_button?.();
		nozom_pos.offline?.status_ui?.bind_fullscreen_button?.(fullscreen_btn);
		nozom_pos.offline?.refresh_status?.();
		this.update_draft_btn_state();

		if (window.nozom_pos?.offline?.guards) {
			nozom_pos.offline.guards.init(this, close_pos_btn);
		}

		if (window.nozom_pos?.offline?.network?.on_change && !this._draft_net_bound) {
			this._draft_net_bound = true;
			nozom_pos.offline.network.on_change(() => this.update_draft_btn_state());
		}
	}

	is_cart_empty() {
		return !(this.frm?.doc?.items || []).some((row) => flt(row.qty));
	}

	is_pos_online() {
		return !window.nozom_pos?.offline?.network || nozom_pos.offline.network.is_online();
	}

	update_draft_btn_state() {
		const has_items = !this.is_cart_empty();
		const online = this.is_pos_online();
		// Draft enabled whenever cart has items — online or offline.
		const draft_enabled = has_items;

		const $btn = this.page?.btn_primary;
		if ($btn?.length) {
			$btn.prop("disabled", !draft_enabled);
			$btn.toggleClass("disabled", !draft_enabled);
			$btn.attr(
				"title",
				!has_items
					? __("Add items to save a draft.")
					: online
					? __("Save current cart as Draft")
					: __("Save Local Draft (offline)")
			);
		}

		this.cart?.update_cart_action_buttons?.({
			has_items,
			online,
			draft_enabled,
		});
	}

	async clear_cart_event() {
		if (!this.$components_wrapper.is(":visible")) return;
		if (this.is_cart_empty()) {
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Cart is already empty."),
				indicator: "orange",
			});
			return;
		}

		return this.cancel_current_order();
	}

	async save_draft_event(opts = {}) {
		if (!opts.from_checkout && !this.$components_wrapper.is(":visible")) return;

		if (this.is_cart_empty()) {
			nozom_pos.notify?.(__("Add items to save a draft."), "orange") ||
				frappe.show_alert({ message: __("Add items to save a draft."), indicator: "orange" });
			return;
		}

		const online = this.is_pos_online();
		frappe.dom.freeze(__("Saving draft..."));
		try {
			if (!online) {
				const record = await nozom_pos.offline.draft_store.save_or_update(
					this.frm,
					this.get_cart_persist_ctx()
				);
				this.frm.doc._nozom_local_draft_id = record.id;
				await this.clear_local_cart?.();
				nozom_pos.notify?.(__("Local Draft saved"), "orange") ||
					frappe.show_alert({ message: __("Local Draft saved"), indicator: "orange" });
				frappe.dom.unfreeze();
				this.load_new_invoice_on_pos();
				this.recent_order_list?.refresh_list?.();
				return;
			}

			// Online: if editing a previously synced local draft, update that server draft
			const local_id = this.frm.doc._nozom_local_draft_id;
			let local_draft = local_id ? await nozom_pos.offline.draft_store.get(local_id) : null;

			if (local_draft?.server_draft_name && local_draft.server_doctype) {
				const server_status = await frappe.db.get_value(
					local_draft.server_doctype,
					local_draft.server_draft_name,
					["docstatus", "status"]
				);
				const meta = server_status?.message || {};
				if (cint(meta.docstatus) !== 0) {
					frappe.throw(
						__("Server draft {0} is no longer editable (status: {1}).", [
							local_draft.server_draft_name,
							meta.status || meta.docstatus,
						])
					);
				}
				await this.sync_draft_invoice_to_frm(
					local_draft.server_doctype,
					local_draft.server_draft_name
				);
			}

			await this.frm.save();
			if (local_draft) {
				await nozom_pos.offline.draft_store.mark_synced(
					local_draft.id,
					this.frm.doc.doctype,
					this.frm.doc.name
				);
				await nozom_pos.offline.draft_store.resolve(local_draft.id);
			}
			await this.clear_local_cart?.();
			nozom_pos.notify?.(__("Draft saved"), "green") ||
				frappe.show_alert({ message: __("Draft saved"), indicator: "green" });
			frappe.dom.unfreeze();
			this.load_new_invoice_on_pos();
			this.recent_order_list?.refresh_list?.();
		} catch (e) {
			frappe.dom.unfreeze();
			console.error(e);
			nozom_pos.notify?.(e.message || __("Could not save draft."), "red") ||
				frappe.show_alert({
					message: e.message || __("Could not save draft."),
					indicator: "red",
				});
			throw e;
		}
	}

	/**
	 * Destructive cancel: clear cart, delete saved Draft if any, start fresh sale.
	 * Does not touch queued offline completed sales.
	 */
	async cancel_current_order(opts = {}) {
		const run = async () => {
			const frm = this.frm;
			const doc = frm?.doc;
			const online = this.is_pos_online();
			const local_draft_id = doc?._nozom_local_draft_id;

			if (local_draft_id && nozom_pos.offline.draft_store) {
				const draft = await nozom_pos.offline.draft_store.get(local_draft_id);
				if (draft?.server_draft_name && online) {
					try {
						await frappe.call({
							method: "frappe.client.delete",
							args: {
								doctype: draft.server_doctype || doc.doctype,
								name: draft.server_draft_name,
							},
							freeze: true,
							freeze_message: __("Deleting draft..."),
						});
					} catch (e) {
						console.warn("Could not delete synced server draft:", e);
					}
				}
				await nozom_pos.offline.draft_store.remove(local_draft_id);
			}

			if (
				online &&
				doc &&
				!frm.is_new() &&
				cint(doc.docstatus) === 0 &&
				doc.name &&
				!String(doc.name).startsWith("new-")
			) {
				await frappe.call({
					method: "frappe.client.delete",
					args: {
						doctype: doc.doctype,
						name: doc.name,
					},
					freeze: true,
					freeze_message: __("Deleting draft..."),
				});
				frappe.model.clear_doc(doc.doctype, doc.name);
			}

			await this.clear_local_cart?.();
			await this.make_new_invoice();
			this.toggle_recent_order_list(false);
			this.toggle_components(true);
			this.payment?.toggle_component?.(false);
			this.cart?.toggle_checkout_btn?.(true);
			this.update_draft_btn_state();
		};

		if (opts.skip_confirm) {
			return run();
		}

		return new Promise((resolve, reject) => {
			frappe.confirm(
				__(
					"Cancel this order? The cart will be cleared and any saved Draft will be permanently deleted."
				),
				() => run().then(resolve).catch(reject),
				() => resolve(false)
			);
		});
	}

	open_form_view() {
		frappe.model.sync(this.frm.doc);
		frappe.set_route("Form", this.frm.doc.doctype, this.frm.doc.name);
	}

	toggle_recent_order() {
		const show = this.recent_order_list.$component.is(":hidden");
		this.page.btn_secondary.get(0).innerText = show ? __("Hide Recent Orders") : __("Recent Orders");
		this.toggle_recent_order_list(show);
	}

	load_new_invoice_on_pos() {
		frappe
			.run_serially([
				() => frappe.dom.freeze(),
				() => this.make_new_invoice(),
				() => this.clear_local_cart(),
				() => this.toggle_recent_order_list(false),
				() => this.toggle_components(true),
				() => this.update_draft_btn_state(),
			])
			.catch((e) => {
				console.error(e);
			})
			.finally(() => {
				nozom_pos.offline?.request?.force_unfreeze?.() || frappe.dom.unfreeze();
			});
	}

	close_pos() {
		if (!this.$components_wrapper.is(":visible")) return;

		if (nozom_pos.offline?.guards?.is_enabled?.()) {
			nozom_pos.offline.guards.show_blocked();
			return;
		}

		// Dedicated Close Period popup — never navigate to ERPNext Closing Entry form
		if (window.nozom_pos?.close_period?.open) {
			nozom_pos.close_period.open(this);
			return;
		}

		frappe.msgprint(__("Close Period UI is unavailable."));
	}

	init_item_selector() {
		this.item_selector = new erpnext.PointOfSale.ItemSelector({
			wrapper: this.$components_wrapper,
			pos_profile: this.pos_profile,
			settings: this.settings,
			events: {
				item_selected: (args) => this.on_cart_update(args),

				get_frm: () => this.frm || {},
			},
		});
	}

	init_item_cart() {
		this.cart = new erpnext.PointOfSale.ItemCart({
			wrapper: this.$components_wrapper,
			settings: this.settings,
			events: {
				get_frm: () => this.frm,

				cart_item_clicked: (item) => {
					const item_row = this.get_item_from_frm(item);
					this.item_details.toggle_item_details_section(item_row);
				},

				numpad_event: (value, action) => this.update_item_field(value, action),

				checkout: () => this.save_and_checkout(),

				edit_cart: () => this.payment.edit_cart(),

				customer_details_updated: (details) => {
					this.item_selector.load_items_data();
					this.customer_details = details;
					// will add/remove LP payment method
					this.payment.render_loyalty_points_payment_mode();
					this.schedule_cart_persist();
				},

				persist_local_cart: () => this.schedule_cart_persist(),

				clear_cart: () => this.clear_cart_event(),

				save_draft: () => this.save_draft_event(),

				open_customer_order: (doctype, name, local_id) => {
					this.cart.toggle_customer_info(false);
					this.toggle_recent_order_list(true);
					if (local_id) {
						this.open_recent_invoice("Local Offline Sale", local_id);
					} else {
						this.open_recent_invoice(doctype, name);
					}
				},
			},
		});
	}

	init_item_details() {
		this.item_details = new erpnext.PointOfSale.ItemDetails({
			wrapper: this.$components_wrapper,
			settings: this.settings,
			events: {
				get_frm: () => this.frm,

				toggle_item_selector: (minimize) => {
					this.item_selector.toggle_component(!minimize);
					this.cart.toggle_numpad(minimize);
				},

				form_updated: (item, field, value) => {
					const item_row = frappe.model.get_doc(item.doctype, item.name);
					if (item_row && item_row[field] != value) {
						const args = {
							field,
							value,
							item: this.item_details.current_item,
						};
						return this.on_cart_update(args);
					}

					return Promise.resolve();
				},

				highlight_cart_item: (item) => {
					const cart_item = this.cart.get_cart_item(item);
				},

				item_field_focused: (fieldname) => {
					this.cart.toggle_numpad_field_edit(fieldname);
				},
				set_value_in_current_cart_item: (selector, value) => {
					this.cart.update_selector_value_in_cart_item(
						selector,
						value,
						this.item_details.current_item
					);
				},
				clone_new_batch_item_in_frm: (batch_serial_map, item) => {
					// called if serial nos are 'auto_selected' and if those serial nos belongs to multiple batches
					// for each unique batch new item row is added in the form & cart
					Object.keys(batch_serial_map).forEach((batch) => {
						const item_to_clone = this.frm.doc.items.find((i) => i.name == item.name);
						const new_row = this.frm.add_child("items", { ...item_to_clone });
						// update new serialno and batch
						new_row.batch_no = batch;
						new_row.serial_no = batch_serial_map[batch].join(`\n`);
						new_row.qty = batch_serial_map[batch].length;
						this.frm.doc.items.forEach((row) => {
							if (item.item_code === row.item_code) {
								this.update_cart_html(row);
							}
						});
					});
				},
				remove_item_from_cart: () => this.remove_item_from_cart(),
				get_item_stock_map: () => this.item_stock_map,
				close_item_details: () => {
					this.item_details.toggle_item_details_section(null);
					this.cart.prev_action = null;
					this.cart.toggle_item_highlight();
				},
				get_available_stock: (item_code, warehouse) => this.get_available_stock(item_code, warehouse),
			},
		});
	}

	init_payments() {
		this.payment = new erpnext.PointOfSale.Payment({
			wrapper: this.$components_wrapper,
			settings: this.settings,
			events: {
				get_frm: () => this.frm || {},

				get_customer_details: () => this.customer_details || {},

				toggle_other_sections: (show) => {
					if (show) {
						this.item_details.$component.is(":visible")
							? this.item_details.$component.css("display", "none")
							: "";
						this.item_selector.toggle_component(false);
					} else {
						this.item_selector.toggle_component(true);
					}
				},

				submit_invoice: () => this.submit_invoice_with_offline_support(),
			},
		});
	}

	/**
	 * Submit without frappe.confirm — Confirm Payment in checkout is the final approval.
	 * Avoids hang when frappe.dom.freeze covers the confirmation dialog.
	 */
	async submit_invoice_without_confirm() {
		const frm = this.frm;
		frappe.validated = true;
		await frm.script_manager.trigger("before_submit");
		if (!frappe.validated) {
			throw new Error(__("Could not submit invoice."));
		}

		return new Promise((resolve, reject) => {
			frm.save(
				"Submit",
				(r) => {
					if (r && r.exc) {
						reject(new Error(__("Could not submit invoice.")));
						return;
					}
					frm.script_manager
						.trigger("on_submit")
						.then(() => resolve(frm))
						.catch((err) => reject(err || new Error(__("Could not submit invoice."))));
				},
				null,
				() => reject(new Error(__("Could not submit invoice.")))
			);
		});
	}

	async submit_invoice_with_offline_support(opts = {}) {
		const from_popup = Boolean(opts.from_checkout_popup);
		const doc = this.frm.doc;
		const network = window.nozom_pos?.offline?.network;
		const queue = window.nozom_pos?.offline?.tx_queue;
		if (network?.ensure_fresh) {
			await network.ensure_fresh();
		}
		const online = !network || network.is_online();

		const print_format = this.frm.pos_print_format || this.settings?.print_format;
		const kitchen_format = this.settings?.print_format_2;
		const letter_head = doc.letter_head;
		const language = doc.language || frappe.boot.lang;
		const total = erpnext.PointOfSale.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || flt(doc.grand_total);
		const tendered = flt(doc.paid_amount);
		const change = flt(doc.change_amount);

		if (!online) {
			if (!queue) {
				const err = new Error(__("Offline queue is unavailable."));
				console.error("NOZOM POS offline queue missing");
				throw err;
			}

			const check = queue.can_queue_sale(doc, this.settings);
			if (!check.ok) {
				console.error("NOZOM POS can_queue_sale failed", check, {
					paid_amount: doc.paid_amount,
					outstanding: doc.outstanding_amount,
					grand_total: doc.grand_total,
					payments: doc.payments,
				});
				const err = new Error(check.reason);
				err.nozom_reason = check.reason;
				throw err;
			}

			if (from_popup) {
				const tx = await queue.enqueue(this.frm, this.get_cart_persist_ctx());
				await this.clear_local_cart();
				if (nozom_pos.offline.sync_worker) {
					await nozom_pos.offline.sync_worker.refresh_ui();
				}
				const outstanding = flt(tx.outstanding_amount);
				return {
					offline: true,
					local_receipt_no: tx.local_receipt_no,
					name: tx.local_receipt_no,
					local_uuid: tx.local_uuid || tx.id,
					tx,
					total,
					tendered: flt(tx.paid_amount),
					paid_amount: flt(tx.paid_amount),
					outstanding_amount: outstanding,
					change: flt(tx.change_amount),
					payment_status: tx.payment_status || queue.payment_label(tx),
					currency: doc.currency,
					nozom_order_number: doc.nozom_order_number || "",
					customer: tx.customer || doc.customer,
					customer_name: tx.customer_name || doc.customer_name,
					contact_mobile: tx.contact_mobile || doc.contact_mobile || "",
					address_display: tx.address_display || doc.address_display || "",
					shipping_address: tx.shipping_address || doc.shipping_address || "",
					nozom_address_title_snapshot:
						tx.nozom_address_title_snapshot || doc.nozom_address_title_snapshot || "",
					nozom_customer_phone_snapshot:
						tx.nozom_customer_phone_snapshot || doc.nozom_customer_phone_snapshot || "",
					nozom_delivery_location_link_snapshot:
						tx.nozom_delivery_location_link_snapshot ||
						doc.nozom_delivery_location_link_snapshot ||
						"",
					has_kitchen: true,
					print_format: null,
					kitchen_format: null,
					letter_head,
					language,
				};
			}

			await this.queue_offline_sale();
			return { offline: true };
		}

		try {
			// Direct submit — no second confirmation dialog
			const request = window.nozom_pos?.offline?.request;
			const submit_promise = from_popup
				? this.submit_invoice_without_confirm()
				: this.frm.savesubmit();
			const r = request
				? await request.with_timeout(submit_promise, 8000, "submit")
				: await submit_promise;
			await this.clear_local_cart();

			const submitted = r.doc || this.frm.doc;
			if (from_popup) {
				return {
					offline: false,
					doctype: submitted.doctype,
					name: submitted.name,
					total: erpnext.PointOfSale.get_invoice_total
						? erpnext.PointOfSale.get_invoice_total(submitted)
						: flt(submitted.rounded_total) || flt(submitted.grand_total),
					tendered: flt(submitted.paid_amount),
					change: flt(submitted.change_amount),
					currency: submitted.currency,
					nozom_order_number: submitted.nozom_order_number || doc.nozom_order_number || "",
					customer: submitted.customer || doc.customer,
					customer_name: submitted.customer_name || doc.customer_name,
					contact_mobile: submitted.contact_mobile || doc.contact_mobile || "",
					address_display: submitted.address_display || doc.address_display || "",
					shipping_address: submitted.shipping_address || doc.shipping_address || "",
					nozom_address_title_snapshot:
						submitted.nozom_address_title_snapshot || doc.nozom_address_title_snapshot || "",
					nozom_customer_phone_snapshot:
						submitted.nozom_customer_phone_snapshot || doc.nozom_customer_phone_snapshot || "",
					nozom_delivery_location_link_snapshot:
						submitted.nozom_delivery_location_link_snapshot ||
						doc.nozom_delivery_location_link_snapshot ||
						"",
					has_kitchen: Boolean(kitchen_format),
					print_format,
					kitchen_format,
					letter_head: submitted.letter_head || letter_head,
					language: submitted.language || language,
				};
			}

			this.toggle_components(false);
			this.toggle_submitted_invoice_summary(true);
			(nozom_pos.notify || frappe.show_alert)({
				indicator: "green",
				message: __("POS invoice {0} created successfully", [submitted.name]),
			});
			return r;
		} catch (e) {
			console.error("NOZOM POS online submit failed:", e);
			window.nozom_pos?.offline?.request?.mark_if_unreachable?.(e);
			network?.mark_unreachable?.({ reason: "submit_failed" });

			if (network && !network.is_online() && queue) {
				const check = queue.can_queue_sale(doc, this.settings);
				if (check.ok) {
					if (from_popup) {
						// Already offline — queue locally without re-entering online path
						const tx = await queue.enqueue(this.frm, this.get_cart_persist_ctx());
						await this.clear_local_cart();
						if (nozom_pos.offline.sync_worker) {
							await nozom_pos.offline.sync_worker.refresh_ui();
						}
						return {
							offline: true,
							local_receipt_no: tx.local_receipt_no,
							name: tx.local_receipt_no,
							local_uuid: tx.local_uuid || tx.id,
							tx,
							total,
							tendered: flt(tx.paid_amount),
							paid_amount: flt(tx.paid_amount),
							outstanding_amount: flt(tx.outstanding_amount),
							change: flt(tx.change_amount),
							payment_status: tx.payment_status || queue.payment_label(tx),
							currency: doc.currency,
							nozom_order_number: doc.nozom_order_number || "",
							customer: tx.customer || doc.customer,
							customer_name: tx.customer_name || doc.customer_name,
							contact_mobile: tx.contact_mobile || doc.contact_mobile || "",
							address_display: tx.address_display || doc.address_display || "",
							shipping_address: tx.shipping_address || doc.shipping_address || "",
							nozom_address_title_snapshot:
								tx.nozom_address_title_snapshot || doc.nozom_address_title_snapshot || "",
							nozom_customer_phone_snapshot:
								tx.nozom_customer_phone_snapshot || doc.nozom_customer_phone_snapshot || "",
							nozom_delivery_location_link_snapshot:
								tx.nozom_delivery_location_link_snapshot ||
								doc.nozom_delivery_location_link_snapshot ||
								"",
							has_kitchen: true,
							print_format: null,
							kitchen_format: null,
							letter_head,
							language,
						};
					}
					await this.queue_offline_sale();
					return { offline: true };
				}
				console.error("NOZOM POS fallback queue rejected", check);
				if (from_popup) {
					const err = new Error(check.reason || e.message);
					err.nozom_reason = check.reason || e.message;
					throw err;
				}
			}
			if (from_popup) throw e;
			return null;
		}
	}

	async queue_offline_sale() {
		const queue = nozom_pos.offline.tx_queue;
		frappe.dom.freeze(__("Saving offline sale..."));
		try {
			const tx = await queue.enqueue(this.frm, this.get_cart_persist_ctx());
			await this.clear_local_cart();

			const local_doc = queue.to_summary_doc(tx);
			this.toggle_components(false);
			this.order_summary.toggle_component(true);
			this.order_summary.load_summary_of(local_doc, true);

			frappe.show_alert({
				indicator: "orange",
				message: __(
					"Sale queued offline as {0}. It will sync when connection returns.",
					[tx.local_receipt_no]
				),
			});
			frappe.utils.play_sound("submit");

			if (nozom_pos.offline.sync_worker) {
				await nozom_pos.offline.sync_worker.refresh_ui();
			}
			this.update_draft_btn_state();
		} catch (e) {
			console.error(e);
			frappe.show_alert({
				message: e.nozom_reason || e.message || __("Could not queue offline sale."),
				indicator: "red",
			});
			frappe.utils.play_sound("error");
		} finally {
			frappe.dom.unfreeze();
		}
	}

	init_recent_order_list() {
		this.recent_order_list = new erpnext.PointOfSale.PastOrderList({
			wrapper: this.$components_wrapper,
			events: {
				get_pos_profile: () => this.pos_profile,
				open_invoice_data: (doctype, name) => this.open_recent_invoice(doctype, name),
				reset_summary: () => this.order_summary.toggle_summary_placeholder(true),
			},
		});
	}

	async open_recent_invoice(doctype, name) {
		if (
			![
				"POS Invoice",
				"Sales Invoice",
				"Local Offline Sale",
				"Local Draft",
			].includes(doctype)
		)
			return;

		if (doctype === "Local Draft" || nozom_pos.offline.draft_store?.is_local_draft_id?.(name)) {
			const draft = await nozom_pos.offline.draft_store.get(name);
			if (!draft) {
				(nozom_pos.notify || frappe.show_alert)({
					message: __("Local Draft not found."),
					indicator: "orange",
				});
				return;
			}
			const local_doc = nozom_pos.offline.draft_store.to_summary_doc(draft);
			this.order_summary.toggle_component(true);
			this.order_summary.load_summary_of(local_doc);
			return;
		}

		// Local pending queue entry
		if (doctype === "Local Offline Sale" || String(name || "").startsWith("LOC-")) {
			const pending = await nozom_pos.offline.tx_queue.list_pending();
			const actionable = (await nozom_pos.offline.tx_queue.list_actionable?.()) || [];
			const tx =
				pending.find((row) => row.local_receipt_no === name || row.id === name) ||
				actionable.find((row) => row.local_receipt_no === name || row.id === name);
			if (!tx) {
				(nozom_pos.notify || frappe.show_alert)({
					message: __("Local offline sale not found."),
					indicator: "orange",
				});
				return;
			}
			const local_doc = nozom_pos.offline.tx_queue.to_summary_doc(tx);
			this.order_summary.toggle_component(true);
			this.order_summary.load_summary_of(local_doc);
			return;
		}

		if (!this.is_pos_online()) {
			const cached = await nozom_pos.offline.catalog.get_recent_order_doc(doctype, name);
			if (!cached) {
				(nozom_pos.notify || frappe.show_alert)({
					message: __("Order details require an online connection."),
					indicator: "orange",
				});
				return;
			}
			this.order_summary.toggle_component(true);
			this.order_summary.load_summary_of(cached);
			return;
		}

		frappe.db.get_doc(doctype, name).then((doc) => {
			nozom_pos.offline.catalog?.cache_recent_order_doc?.(doc);
			this.order_summary.toggle_component(true);
			this.order_summary.load_summary_of(doc);
		});
	}

	init_order_summary() {
		this.order_summary = new erpnext.PointOfSale.PastOrderSummary({
			wrapper: this.$components_wrapper,
			settings: this.settings,
			events: {
				get_frm: () => this.frm,
				get_controller: () => this,

				process_return: (doctype, name) => {
					this.recent_order_list.toggle_component(false);
					frappe.db.get_doc(doctype, name).then((doc) => {
						frappe.run_serially([
							() => frappe.dom.freeze(),
							() => this.make_invoice_frm(doc.doctype),
							() => this.make_return_invoice(doc),
							() => this.cart.load_invoice(),
							() => this.toggle_components(true),
							() => frappe.dom.unfreeze(),
						]);
					});
				},
				edit_order: (doctype, name) => {
					this.toggle_recent_order();
					frappe.run_serially([
						() => this.make_invoice_frm(doctype),
						() => this.sync_draft_invoice_to_frm(doctype, name),
						() => this.frm.refresh(name),
						() => this.frm.call("reset_mode_of_payments"),
						() => this.cart.load_invoice(),
						() => this.toggle_components(true),
					]);
				},
				edit_local_draft: (draft_id) => this.edit_local_draft(draft_id),
				delete_local_draft: (draft_id) => this.delete_local_draft(draft_id),
				delete_order: (doctype, name) => {
					frappe.model.with_doctype(doctype, () => {
						frappe.model.delete_doc(doctype, name, () => {
							this.recent_order_list.refresh_list();
						});
					});
				},
				new_order: () => {
					frappe.run_serially([
						() => frappe.dom.freeze(),
						() => this.make_new_invoice(),
						() => this.clear_local_cart(),
						() => this.toggle_components(true),
						() => frappe.dom.unfreeze(),
					]);
				},
				open_in_form_view: (doctype, name) => {
					frappe.run_serially([
						() => frappe.dom.freeze(),
						() => frappe.set_route("Form", doctype, name),
						() => frappe.dom.unfreeze(),
					]);
				},
			},
		});
	}

	async edit_local_draft(draft_id) {
		const draft = await nozom_pos.offline.draft_store.get(draft_id);
		if (!draft) {
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Local Draft not found."),
				indicator: "orange",
			});
			return;
		}

		this.toggle_recent_order_list(false);
		this.toggle_components(true);
		await this.make_new_invoice();
		this.frm.doc._nozom_local_draft_id = draft.id;

		const snapshot = nozom_pos.offline.draft_store.to_cart_snapshot(draft);
		await this.restore_local_cart(snapshot);
		this.frm.doc._nozom_local_draft_id = draft.id;
	}

	async delete_local_draft(draft_id) {
		const draft = await nozom_pos.offline.draft_store.get(draft_id);
		if (!draft) return;

		const do_delete = async () => {
			if (draft.server_draft_name && this.is_pos_online()) {
				try {
					await frappe.call({
						method: "frappe.client.delete",
						args: {
							doctype: draft.server_doctype || "POS Invoice",
							name: draft.server_draft_name,
						},
						freeze: true,
					});
				} catch (e) {
					frappe.msgprint(
						e.message ||
							__("Could not delete server draft. Local draft will still be removed.")
					);
				}
			}
			await nozom_pos.offline.draft_store.remove(draft.id);
			this.recent_order_list?.refresh_list?.();
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Local Draft deleted."),
				indicator: "orange",
			});
		};

		frappe.confirm(__("Delete this Local Draft permanently?"), () => do_delete());
	}

	toggle_recent_order_list(show) {
		this.frm.doc.docstatus === 1
			? this.toggle_submitted_invoice_summary(!show)
			: this.toggle_components(!show);

		this.recent_order_list.toggle_component(show);
		this.order_summary.toggle_component(show);
	}

	toggle_components(show) {
		this.cart.toggle_component(show);
		this.cart.toggle_numpad(!show);
		this.cart.toggle_checkout_btn(show);
		this.cart.enable_customer_selection();
		this.item_selector.toggle_component(show);

		// do not show item details or payment if recent order is toggled off
		!show ? this.item_details.toggle_component(false) || this.payment.toggle_component(false) : "";
	}

	toggle_submitted_invoice_summary(show) {
		this.order_summary.toggle_component(show);
		this.order_summary.load_summary_of(this.frm.doc, true);
	}

	make_new_invoice() {
		return frappe.run_serially([
			() => frappe.dom.freeze(),
			() => this.make_invoice_frm(this.settings.frm_doctype),
			() => this.set_pos_profile_data(),
			() => this.set_pos_profile_status(),
			() => this.cart.load_invoice(),
			() => this.update_draft_btn_state(),
			() => frappe.dom.unfreeze(),
		]);
	}

	make_invoice_frm(doctype) {
		return new Promise((resolve) => {
			if (this.frm && this.frm.doctype == doctype) {
				this.frm = this.get_new_frm(this.frm, doctype);
				this.frm.doc.items = [];
				this.frm.doc.is_pos = 1;
				if (doctype == "Sales Invoice") this.frm.doc.is_created_using_pos = 1;
				resolve();
			} else {
				frappe.model.with_doctype(doctype, () => {
					this.frm = this.get_new_frm(undefined, doctype);
					this.frm.doc.items = [];
					this.frm.doc.is_pos = 1;
					if (doctype == "Sales Invoice") this.frm.doc.is_created_using_pos = 1;
					resolve();
				});
			}
		});
	}

	get_new_frm(_frm, doctype = this.settings.frm_doctype) {
		const page = $("<div>");
		const frm = _frm || new frappe.ui.form.Form(doctype, page, false);
		const name = frappe.model.make_new_doc_and_get_name(doctype, true);
		frm.refresh(name);

		return frm;
	}

	sync_draft_invoice_to_frm(doctype, invoice) {
		return frappe.db.get_doc(doctype, invoice).then((doc) => {
			frappe.model.sync(doc);
		});
	}

	async make_return_invoice(doc) {
		return frappe.call({
			method:
				doc.doctype == "POS Invoice"
					? "erpnext.accounts.doctype.pos_invoice.pos_invoice.make_sales_return"
					: "erpnext.accounts.doctype.sales_invoice.sales_invoice.make_sales_return",
			args: {
				source_name: doc.name,
				target_doc: this.frm.doc,
			},
			callback: (r) => {
				frappe.model.sync(r.message);
				frappe.get_doc(r.message.doctype, r.message.name).__run_link_triggers = false;
				// Keep update_stock identical to the original invoice so consolidation
				// credit notes pass ERPNext return validation.
				this.frm.doc.update_stock = cint(doc.update_stock);
				this.set_pos_profile_data().then(() => {
					this.frm.doc.update_stock = cint(doc.update_stock);
				});
			},
		});
	}

	set_pos_profile_data() {
		if (this.company && !this.frm.doc.company) this.frm.doc.company = this.company;
		if (
			(this.pos_profile && !this.frm.doc.pos_profile) |
			(this.frm.doc.is_return && this.pos_profile != this.frm.doc.pos_profile)
		) {
			this.frm.doc.pos_profile = this.pos_profile;
		}
		this.frm.doc.set_warehouse = this.settings.warehouse;

		// Respect POS Profile rounding setting (not only Global Defaults)
		if (this.settings.disable_rounded_total != null) {
			this.frm.doc.disable_rounded_total = cint(this.settings.disable_rounded_total);
		}

		if (!this.frm.doc.company) return;

		const offline = !this.is_pos_online();
		if (offline) {
			return this.apply_offline_pos_bootstrap();
		}

		return this.frm
			.trigger("set_pos_data")
			.then(async () => {
				try {
					await nozom_pos.offline?.catalog?.cache_invoice_bootstrap?.(this.frm, {
						pos_profile: this.pos_profile,
						settings: this.settings,
					});
				} catch (e) {
					console.warn("NOZOM POS bootstrap cache failed", e);
				}
			})
			.catch(async (e) => {
				console.warn("NOZOM POS set_pos_data failed; using offline bootstrap", e);
				nozom_pos.offline?.network?.mark_unreachable?.();
				await this.apply_offline_pos_bootstrap();
			});
	}

	async apply_offline_pos_bootstrap() {
		const frm = this.frm;
		const settings = this.settings || {};
		const bootstrap =
			(await nozom_pos.offline?.catalog?.get_invoice_bootstrap?.(this.pos_profile)) || {};
		const config = (await nozom_pos.offline?.catalog?.get_pos_config?.(this.pos_profile)) || {};
		const cfg_settings = config.settings || settings;

		frm.doc.company = this.company || bootstrap.company || frm.doc.company;
		frm.doc.pos_profile = this.pos_profile;
		frm.doc.set_warehouse =
			settings.warehouse || bootstrap.set_warehouse || config.warehouse || frm.doc.set_warehouse;
		frm.doc.currency = bootstrap.currency || cfg_settings.currency || frm.doc.currency;
		frm.doc.selling_price_list =
			bootstrap.selling_price_list ||
			cfg_settings.selling_price_list ||
			settings.selling_price_list ||
			frm.doc.selling_price_list;
		frm.doc.conversion_rate = flt(bootstrap.conversion_rate) || frm.doc.conversion_rate || 1;
		frm.doc.disable_rounded_total = cint(
			settings.disable_rounded_total != null
				? settings.disable_rounded_total
				: bootstrap.disable_rounded_total
		);
		frm.doc.is_pos = 1;
		if (!cint(frm.doc.is_return)) {
			frm.doc.update_stock = 1;
		} else if (frm.doc.return_against) {
			// Do not force profile update_stock=1 onto returns of older sales.
			frm.doc.update_stock = cint(frm.doc.update_stock);
		}

		if (!frm.doc.customer) {
			const customer = bootstrap.customer || cfg_settings.customer || settings.customer;
			if (customer) {
				frm.doc.customer = customer;
				frm.doc.customer_name =
					bootstrap.customer_name || cfg_settings.customer_name || customer;
			}
		}

		// Payments
		const payments =
			(bootstrap.payments && bootstrap.payments.length && bootstrap.payments) ||
			cfg_settings.payments ||
			settings.payments ||
			[];
		if (payments.length && !(frm.doc.payments || []).some((p) => p.mode_of_payment)) {
			frm.clear_table("payments");
			payments.forEach((pay) => {
				if (!pay.mode_of_payment) return;
				const row = frm.add_child("payments");
				row.mode_of_payment = pay.mode_of_payment;
				row.account = pay.account;
				row.type = pay.type;
				row.default = cint(pay.default);
				row.amount = 0;
			});
		}

		// Taxes
		if (bootstrap.taxes?.length && !(frm.doc.taxes || []).length) {
			frm.clear_table("taxes");
			bootstrap.taxes.forEach((t) => {
				const row = frm.add_child("taxes");
				Object.assign(row, {
					charge_type: t.charge_type || "On Net Total",
					account_head: t.account_head,
					description: t.description,
					rate: flt(t.rate),
					cost_center: t.cost_center,
					included_in_print_rate: cint(t.included_in_print_rate),
					tax_amount: 0,
					tax_amount_after_discount_amount: 0,
				});
			});
			frm.doc.taxes_and_charges = bootstrap.taxes_and_charges || frm.doc.taxes_and_charges;
		}

		frm.pos_print_format = bootstrap.print_format || settings.print_format || "";
		frm.set_default_payment = cint(bootstrap.set_default_payment);
		frm.allow_print_before_pay = cint(bootstrap.allow_print_before_pay);

		frm.refresh_field("payments");
		frm.refresh_field("taxes");
		nozom_pos.offline.totals?.recalculate?.(frm);
	}

	set_pos_profile_status() {
		this.page.set_indicator(this.pos_profile, "blue");
	}

	async on_cart_update(args) {
		// Do NOT freeze the whole POS for cart mutations. A dead backend + freeze
		// was leaving cashiers unable to click anything for 30–60s+.
		const network = window.nozom_pos?.offline?.network;
		const request = window.nozom_pos?.offline?.request || {
			with_timeout: (p) => Promise.resolve(p),
			mark_if_unreachable: () => network?.mark_unreachable?.(),
			is_network_failure: () => true,
			force_unfreeze: () => {
				try {
					frappe.dom.unfreeze();
				} catch (e) {
					/* ignore */
				}
			},
		};

		// Local-first: trust current flag. Real request failures mark offline.
		let offline = !this.is_pos_online();
		let item_row = undefined;
		const SERVER_OP_MS = 3000;

		try {
			const warehouse = this.settings?.warehouse || this.frm.doc.set_warehouse;
			if (warehouse) {
				if (offline) {
					this.frm.doc.set_warehouse = warehouse;
				} else if (this.frm.doc.set_warehouse !== warehouse) {
					try {
						await request.with_timeout(
							this.frm.set_value("set_warehouse", warehouse),
							SERVER_OP_MS,
							"warehouse"
						);
					} catch (e) {
						request.mark_if_unreachable(e);
						this.frm.doc.set_warehouse = warehouse;
						offline = !this.is_pos_online();
					}
				}
			}

			let { field, value, item } = args;
			item_row = this.get_item_from_frm(item);
			const item_row_exists = !$.isEmptyObject(item_row);

			const from_selector = field === "qty" && value === "+1";
			if (from_selector) value = flt(item_row.qty) + flt(value);

			if (item_row_exists) {
				if (field === "qty") value = flt(value);

				if (
					["qty", "conversion_factor"].includes(field) &&
					value > 0 &&
					!this.allow_negative_stock &&
					!offline
				) {
					try {
						const qty_needed =
							field === "qty" ? value * item_row.conversion_factor : item_row.qty * value;
						await request.with_timeout(
							this.check_stock_availability(item_row, qty_needed, this.frm.doc.set_warehouse),
							SERVER_OP_MS,
							"stock"
						);
					} catch (e) {
						if (request.is_network_failure(e)) {
							request.mark_if_unreachable(e);
							offline = true;
						} else {
							throw e;
						}
					}
				}

				if (this.is_current_item_being_edited(item_row) || from_selector) {
					if (offline) {
						await this.apply_offline_item_field_update(item_row, field, value, item, from_selector);
					} else {
						try {
							await request.with_timeout(
								frappe.model.set_value(item_row.doctype, item_row.name, field, value),
								SERVER_OP_MS,
								"cart-update"
							);
							if (item.serial_no && from_selector) {
								await request.with_timeout(
									frappe.model.set_value(
										item_row.doctype,
										item_row.name,
										"serial_no",
										item_row.serial_no + `\n${item.serial_no}`
									),
									SERVER_OP_MS,
									"serial"
								);
							}
						} catch (server_err) {
							request.mark_if_unreachable(server_err);
							offline = true;
							await this.apply_offline_item_field_update(
								item_row,
								field,
								value,
								item,
								from_selector
							);
						}
					}
					this.update_cart_html(item_row);
				}
			} else {
				if (!this.frm.doc.customer) return this.raise_customer_selection_alert();

				const { item_code, batch_no, serial_no, rate, uom, stock_uom } = item;

				if (!item_code) return;

				if (offline) {
					const allowed = await this.assert_offline_item_allowed(item);
					if (!allowed) return;
				}

				if (rate == undefined || rate == 0) {
					(nozom_pos.notify || frappe.show_alert)({
						message: __("Price is not set for the item."),
						indicator: "orange",
					});
					frappe.utils.play_sound("error");
					return;
				}
				const new_item = { item_code, batch_no, rate, uom, [field]: value, stock_uom };

				if (serial_no) {
					if (offline) {
						(nozom_pos.notify || frappe.show_alert)({
							message: __("Serial/Batch items require an online connection."),
							indicator: "orange",
						});
						return;
					}
					try {
						await request.with_timeout(
							this.check_serial_no_availablilty(
								item_code,
								this.frm.doc.set_warehouse,
								serial_no
							),
							SERVER_OP_MS,
							"serial-check"
						);
					} catch (e) {
						request.mark_if_unreachable(e);
						(nozom_pos.notify || frappe.show_alert)({
							message: __("Serial/Batch items require an online connection."),
							indicator: "orange",
						});
						return;
					}
					new_item["serial_no"] = serial_no;
				}

				new_item["use_serial_batch_fields"] = 1;
				new_item["warehouse"] = warehouse;
				new_item["price_list_rate"] = flt(rate);
				if (field === "serial_no") new_item["qty"] = value.split(`\n`).length || 0;

				item_row = this.frm.add_child("items", new_item);

				if (field === "qty" && value !== 0 && !this.allow_negative_stock && !offline) {
					try {
						const qty_needed = value * (item_row.conversion_factor || 1);
						await request.with_timeout(
							this.check_stock_availability(item_row, qty_needed, this.frm.doc.set_warehouse),
							SERVER_OP_MS,
							"stock"
						);
					} catch (e) {
						if (request.is_network_failure(e)) {
							request.mark_if_unreachable(e);
							offline = true;
						} else {
							throw e;
						}
					}
				}

				if (offline) {
					await this.apply_offline_new_item_defaults(item_row, item);
				} else {
					try {
						await request.with_timeout(
							this.trigger_new_item_events(item_row),
							SERVER_OP_MS,
							"item-events"
						);
					} catch (server_err) {
						// Bench/server died mid-session — fall back to cached local defaults.
						request.mark_if_unreachable(server_err);
						offline = true;
						await this.apply_offline_new_item_defaults(item_row, item);
					}
				}

				this.update_cart_html(item_row);

				if (this.item_details.$component.is(":visible")) this.edit_item_details_of(item_row);

				if (
					!offline &&
					this.check_serial_batch_selection_needed(item_row) &&
					!this.item_details.$component.is(":visible")
				)
					this.edit_item_details_of(item_row);
			}
		} catch (error) {
			console.error(error);
			request?.force_unfreeze?.();
			(nozom_pos.notify || frappe.show_alert)({
				message: error.message || __("Could not update cart."),
				indicator: "red",
			});
		} finally {
			request?.force_unfreeze?.();
			this.schedule_cart_persist?.();
			return item_row; // eslint-disable-line no-unsafe-finally
		}
	}

	async assert_offline_item_allowed(item) {
		const cached = await nozom_pos.offline.catalog?.get_cached_item?.({
			pos_profile: this.pos_profile,
			price_list: this.frm.doc.selling_price_list || this.settings?.selling_price_list,
			item_code: item.item_code,
			uom: item.uom,
		});

		// ONLY trust has_serial_no / has_batch_no flags — never treat DOM junk
		// like data-serial-no="null" / "undefined" as proof the item is controlled.
		// Missing metadata must NOT block ordinary items offline.
		const has_serial = cint(item.has_serial_no) === 1 || cint(cached?.has_serial_no) === 1;
		const has_batch = cint(item.has_batch_no) === 1 || cint(cached?.has_batch_no) === 1;

		if (has_serial || has_batch) {
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Serial/Batch items require an online connection."),
				indicator: "orange",
			});
			frappe.utils.play_sound("error");
			return false;
		}
		return true;
	}

	async apply_offline_new_item_defaults(item_row, item) {
		const warehouse = this.settings?.warehouse || this.frm.doc.set_warehouse;
		const cached = await nozom_pos.offline.catalog?.get_cached_item?.({
			pos_profile: this.pos_profile,
			price_list: this.frm.doc.selling_price_list || this.settings?.selling_price_list,
			item_code: item_row.item_code,
			uom: item_row.uom,
		});

		const conversion_factor = flt(cached?.conversion_factor) || 1;
		const rate = flt(item_row.rate || item.rate || cached?.price_list_rate);
		const qty = flt(item_row.qty) || 1;

		item_row.item_name = cached?.item_name || item_row.item_code;
		item_row.description = cached?.description || "";
		item_row.stock_uom = item_row.stock_uom || cached?.stock_uom || item_row.uom;
		item_row.uom = item_row.uom || cached?.uom || item_row.stock_uom;
		item_row.conversion_factor = conversion_factor;
		item_row.warehouse = warehouse;
		item_row.price_list_rate = rate;
		item_row.rate = rate;
		item_row.amount = flt(rate * qty);
		item_row.stock_qty = flt(qty * conversion_factor);
		item_row.has_serial_no = 0;
		item_row.has_batch_no = 0;
		item_row.use_serial_batch_fields = 1;

		this.frm.doc.set_warehouse = warehouse;
		if (nozom_pos.offline.totals?.recalculate) {
			nozom_pos.offline.totals.recalculate(this.frm);
		} else {
			this.frm.cscript?.calculate_taxes_and_totals?.();
		}
		this.frm.refresh_field("items");
	}

	async apply_offline_item_field_update(item_row, field, value, item, from_selector) {
		if (field === "qty") {
			item_row.qty = flt(value);
			item_row.stock_qty = flt(item_row.qty) * (flt(item_row.conversion_factor) || 1);
			item_row.amount = flt(item_row.rate) * flt(item_row.qty);
		} else if (field === "rate") {
			item_row.rate = flt(value);
			item_row.amount = flt(item_row.rate) * flt(item_row.qty);
		} else if (field === "discount_percentage") {
			item_row.discount_percentage = flt(value);
			const base = flt(item_row.price_list_rate) || flt(item_row.rate);
			item_row.rate = flt(base * (1 - flt(value) / 100));
			item_row.discount_amount = flt(base - item_row.rate);
			item_row.amount = flt(item_row.rate) * flt(item_row.qty);
		} else if (field === "discount_amount") {
			item_row.discount_amount = flt(value);
			const base = flt(item_row.price_list_rate) || flt(item_row.rate) + flt(value);
			item_row.rate = flt(base - flt(value));
			item_row.amount = flt(item_row.rate) * flt(item_row.qty);
		} else {
			item_row[field] = value;
		}

		if (item?.serial_no && from_selector) {
			item_row.serial_no = (item_row.serial_no || "") + `\n${item.serial_no}`;
		}

		if (!item_row.warehouse) {
			item_row.warehouse = this.settings?.warehouse || this.frm.doc.set_warehouse;
		}

		if (nozom_pos.offline.totals?.recalculate) {
			nozom_pos.offline.totals.recalculate(this.frm);
		} else {
			this.frm.cscript?.calculate_taxes_and_totals?.();
		}
		this.frm.refresh_field("items");
	}

	raise_customer_selection_alert() {
		frappe.dom.unfreeze();
		(nozom_pos.notify || frappe.show_alert)({
			message: __("You must select a customer before adding an item."),
			indicator: "orange",
		});
		frappe.utils.play_sound("error");
	}

	get_item_from_frm({ name, item_code, batch_no, uom, rate }) {
		let item_row = null;
		if (name) {
			item_row = this.frm.doc.items.find((i) => i.name == name);
		} else {
			// if item is clicked twice from item selector
			// then "item_code, batch_no, uom, rate" will help in getting the exact item
			// to increase the qty by one
			const has_batch_no = batch_no !== "null" && batch_no !== null;
			item_row = this.frm.doc.items.find(
				(i) =>
					i.item_code === item_code &&
					(!has_batch_no || (has_batch_no && i.batch_no === batch_no)) &&
					i.uom === uom &&
					i.price_list_rate === flt(rate)
			);
		}

		return item_row || {};
	}

	edit_item_details_of(item_row) {
		this.item_details.toggle_item_details_section(item_row);
	}

	is_current_item_being_edited(item_row) {
		return item_row?.name == this.item_details?.current_item?.name;
	}

	update_cart_html(item_row, remove_item) {
		if (!item_row && !remove_item) return;
		this.cart.update_item_html(item_row, remove_item);
		this.cart.update_totals_section(this.frm);
		this.schedule_cart_persist();
		this.update_draft_btn_state();
	}

	check_serial_batch_selection_needed(item_row) {
		// right now item details is shown for every type of item.
		// if item details is not shown for every item then this fn will be needed
		const serialized = item_row.has_serial_no;
		const batched = item_row.has_batch_no;
		const no_serial_selected = !item_row.serial_no;
		const no_batch_selected = !item_row.batch_no;

		if (
			(serialized && no_serial_selected) ||
			(batched && no_batch_selected) ||
			(serialized && batched && (no_batch_selected || no_serial_selected))
		) {
			return true;
		}
		return false;
	}

	async trigger_new_item_events(item_row) {
		await this.frm.script_manager.trigger("item_code", item_row.doctype, item_row.name);
		await this.frm.script_manager.trigger("qty", item_row.doctype, item_row.name);
	}

	async check_stock_availability(item_row, qty_needed, warehouse) {
		const resp = (await this.get_available_stock(item_row.item_code, warehouse)).message;
		const available_qty = resp[0];
		const is_stock_item = resp[1];
		const is_negative_stock_allowed = resp[2];

		// Do NOT freeze/unfreeze here. Core POS balances these against on_cart_update's
		// outer freeze; our local-first path has no outer freeze, so a trailing
		// frappe.dom.freeze() left the entire POS under a blank overlay.
		const bold_uom = cstr(item_row.stock_uom || "").bold();
		const bold_item_code = cstr(item_row.item_code || "").bold();
		const bold_warehouse = cstr(warehouse || "").bold();
		const bold_available_qty = available_qty.toString().bold();

		if (is_negative_stock_allowed) return;

		if (!(available_qty > 0)) {
			if (is_stock_item) {
				frappe.model.clear_doc(item_row.doctype, item_row.name);
				frappe.throw({
					title: __("Not Available"),
					message: __("Item Code: {0} is not available under warehouse {1}.", [
						bold_item_code,
						bold_warehouse,
					]),
				});
			} else {
				return;
			}
		} else if (is_stock_item && available_qty < qty_needed) {
			frappe.throw({
				message: __(
					"Stock quantity not enough for Item Code: {0} under warehouse {1}. Available quantity {2} {3}.",
					[bold_item_code, bold_warehouse, bold_available_qty, bold_uom]
				),
				indicator: "orange",
			});
			frappe.utils.play_sound("error");
		}
	}

	async check_serial_no_availablilty(item_code, warehouse, serial_no) {
		const method = "erpnext.stock.doctype.serial_no.serial_no.get_pos_reserved_serial_nos";
		const args = { filters: { item_code, warehouse } };
		const res = await frappe.call({ method, args });

		if (res.message.includes(serial_no)) {
			frappe.throw({
				title: __("Not Available"),
				message: __("Serial No: {0} has already been transacted into another POS Invoice.", [
					serial_no.bold(),
				]),
			});
		}
	}

	get_available_stock(item_code, warehouse) {
		const me = this;
		return frappe.call({
			method: "erpnext.accounts.doctype.pos_invoice.pos_invoice.get_stock_availability",
			args: {
				item_code: item_code,
				warehouse: warehouse,
			},
			callback(res) {
				if (!me.item_stock_map[item_code]) me.item_stock_map[item_code] = {};
				me.item_stock_map[item_code][warehouse] = res.message;
			},
		});
	}

	update_item_field(value, field_or_action) {
		if (field_or_action === "checkout") {
			this.item_details.toggle_item_details_section(null);
		} else if (field_or_action === "remove") {
			this.remove_item_from_cart();
		} else if (field_or_action === "discount_percentage") {
			if (!this.item_details.$component.is(":visible")) return;
			this.item_details.set_discount_from_numpad(value);
		} else {
			const field_control = this.item_details[`${field_or_action}_control`];
			if (!field_control) return;
			field_control.set_focus();
			value != "" && field_control.set_value(value);
		}
	}

	remove_item_from_cart() {
		frappe.dom.freeze();
		const { doctype, name, current_item } = this.item_details;

		return frappe.model
			.set_value(doctype, name, "qty", 0)
			.then(() => {
				frappe.model.clear_doc(doctype, name);
				this.update_cart_html(current_item, true);
				this.item_details.toggle_item_details_section(null);
				frappe.dom.unfreeze();
			})
			.catch((e) => console.log(e));
	}

	async save_and_checkout() {
		// Open payment UI first — do NOT save/submit/queue before cashier confirms payment.
		try {
			if (window.nozom_pos?.checkout_popup) {
				this.payment?.toggle_component?.(false);
				this.item_selector?.toggle_component?.(true);
				const opened = nozom_pos.checkout_popup.open(this);
				if (opened === false) {
					this.cart?.toggle_checkout_btn?.(true);
					return false;
				}
				return true;
			}
			// Fallback to classic payment panel
			this.payment.checkout();
			return true;
		} catch (e) {
			console.error(e);
			this.cart?.toggle_checkout_btn?.(true);
			frappe.show_alert({
				message: e.message || __("Could not open checkout."),
				indicator: "red",
			});
			return false;
		}
	}
};
