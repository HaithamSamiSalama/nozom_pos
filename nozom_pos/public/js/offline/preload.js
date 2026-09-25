frappe.provide("nozom_pos.offline");

/**
 * Startup preload of datasets required for real offline selling.
 * Preserves last-known-good cache if a partial refresh fails.
 */
nozom_pos.offline.preload = (() => {
	const PAGE_LENGTH = 80;
	const MAX_PAGES = 25;
	const MAX_CUSTOMERS = 200;

	async function preload_all(controller) {
		if (!controller || !nozom_pos.offline.network?.is_online?.()) {
			return { skipped: true };
		}

		const pos_profile = controller.pos_profile;
		const settings = controller.settings || {};
		const price_list = settings.selling_price_list || controller.frm?.doc?.selling_price_list;
		const catalog = nozom_pos.offline.catalog;
		const summary = {
			items: 0,
			item_groups: 0,
			customers: 0,
			recent_orders: 0,
			errors: [],
		};

		try {
			await catalog.save_pos_config({
				pos_profile,
				company: controller.company,
				pos_opening: controller.pos_opening,
				settings,
				price_list,
			});
		} catch (e) {
			summary.errors.push("pos_config: " + (e.message || e));
		}

		try {
			if (controller.frm?.doc) {
				await catalog.cache_invoice_bootstrap(controller.frm, {
					pos_profile,
					settings,
				});
			}
		} catch (e) {
			summary.errors.push("bootstrap: " + (e.message || e));
		}

		try {
			summary.item_groups = await preload_item_groups(controller, catalog);
		} catch (e) {
			summary.errors.push("item_groups: " + (e.message || e));
		}

		try {
			summary.items = await preload_items(controller, catalog, price_list);
		} catch (e) {
			summary.errors.push("items: " + (e.message || e));
		}

		try {
			summary.customers = await preload_customers(controller, catalog);
		} catch (e) {
			summary.errors.push("customers: " + (e.message || e));
		}

		try {
			summary.recent_orders = await preload_recent_orders(controller, catalog);
		} catch (e) {
			summary.errors.push("recent_orders: " + (e.message || e));
		}

		await catalog.put_meta?.("preload_summary", {
			pos_profile,
			summary,
			cached_at: new Date().toISOString(),
		});

		if (nozom_pos.offline.refresh_status) {
			await nozom_pos.offline.refresh_status();
		}

		console.info("NOZOM POS preload complete", summary);
		return summary;
	}

	async function preload_items(controller, catalog, price_list) {
		const pos_profile = controller.pos_profile;
		const warehouse = controller.settings?.warehouse || controller.frm?.doc?.set_warehouse;
		let start = 0;
		let total = 0;
		let page = 0;

		while (page < MAX_PAGES) {
			const r = await frappe.call({
				method: "erpnext.selling.page.point_of_sale.point_of_sale.get_items",
				args: {
					start,
					page_length: PAGE_LENGTH,
					price_list,
					item_group: "",
					search_term: "",
					pos_profile,
				},
			});
			const items = r.message?.items || [];
			if (!items.length) break;

			await catalog.cache_items({
				pos_profile,
				price_list,
				items,
				warehouse,
			});
			total += items.length;
			if (items.length < PAGE_LENGTH) break;
			start += PAGE_LENGTH;
			page += 1;
		}
		return total;
	}

	async function preload_item_groups(controller, catalog) {
		const parent = controller.settings?.item_groups?.[0]?.name || "All Item Groups";
		let groups = [];
		try {
			const r = await frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Item Group",
					fields: ["name", "parent_item_group", "is_group"],
					filters: { parent_item_group: parent },
					limit_page_length: 200,
					order_by: "name asc",
				},
			});
			groups = r.message || [];
		} catch (e) {
			// Fallback: groups already on settings
			groups = (controller.settings?.item_groups || []).map((g) => ({
				name: g.name || g,
			}));
		}

		await catalog.cache_item_groups(controller.pos_profile, groups);
		return groups.length;
	}

	async function preload_customers(controller, catalog) {
		const groups = controller.settings?.customer_groups || [];
		const filters = [];
		if (groups.length) {
			filters.push(["customer_group", "in", groups]);
		}
		filters.push(["disabled", "=", 0]);

		const r = await frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Customer",
				fields: [
					"name",
					"customer_name",
					"customer_group",
					"territory",
					"image",
					"mobile_no",
					"email_id",
					"tax_id",
					"disabled",
					"primary_address",
					"customer_primary_address",
				],
				filters,
				limit_page_length: MAX_CUSTOMERS,
				order_by: "modified desc",
			},
		});
		const rows = r.message || [];

		// Always include default customer from profile / current doc
		const defaults = [];
		const default_customer =
			controller.settings?.customer || controller.frm?.doc?.customer || null;
		if (default_customer && !rows.find((c) => c.name === default_customer)) {
			defaults.push({
				name: default_customer,
				customer_name: controller.frm?.doc?.customer_name || default_customer,
				tax_id: controller.frm?.doc?.tax_id || "",
			});
		}

		await catalog.cache_customers(controller.pos_profile, [...defaults, ...rows]);

		// Preload addresses for cached customers (multi-address offline support)
		try {
			const names = [...defaults, ...rows].map((c) => c.name).filter(Boolean).slice(0, 80);
			if (names.length && nozom_pos.offline.address_store) {
				const ar = await frappe.call({
					method: "nozom_pos.api.address.get_addresses_for_customers",
					args: { customers: names },
					freeze: false,
				});
				const map = ar.message || {};
				for (const customer_name of Object.keys(map)) {
					await nozom_pos.offline.address_store.cache_many(
						controller.pos_profile,
						customer_name,
						map[customer_name] || []
					);
				}
			}
		} catch (e) {
			console.warn("NOZOM POS address preload failed", e);
		}

		return rows.length + defaults.length;
	}

	async function preload_recent_orders(controller, catalog) {
		const r = await frappe.call({
			method: "nozom_pos.api.orders.get_past_order_list",
			args: { search_term: "", status: "Paid" },
		});
		const rows = r.message || [];
		await catalog.cache_recent_orders(rows, controller.pos_profile);
		return rows.length;
	}

	return { preload_all };
})();
