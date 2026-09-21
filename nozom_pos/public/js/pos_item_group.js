frappe.provide("erpnext.PointOfSale");

erpnext.PointOfSale.ItemGroupsColumn = class {
	constructor({ wrapper, events }) {
		this.wrapper = wrapper;
		this.events = events;
		this.prepare_dom();
		this.load_groups();
	}

	prepare_dom() {
		// ضع العمود على اليمين
		this.$container = $(`
			<div class="group-box" style="width:180px; flex-shrink:0; border:1px solid #ddd; padding:10px; margin-left:10px; overflow-y:auto;">
				<div class="group-buttons-label" style="font-weight:bold; margin-bottom:10px;">Item Groups</div>
				<div class="item-group-buttons-container" style="display:flex; flex-direction:column; gap:5px;"></div>
			</div>
		`);
		$(this.wrapper).append(this.$container);
		this.$buttons_container = this.$container.find(".item-group-buttons-container");
	}

	load_groups() {
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Item Group",
				fields: ["name"],
				order_by: "name asc",
				limit_page_length: 50
			},
			callback: (r) => {
				if (!r.message) return;
				r.message.forEach(group => {
					const $btn = $(`<button type="button" class="btn btn-secondary" style="width:100%;">${group.name}</button>`);
					$btn.on("click", () => this.events.group_selected(group.name));
					this.$buttons_container.append($btn);
				});
			}
		});
	}
};
