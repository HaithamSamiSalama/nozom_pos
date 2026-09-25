frappe.provide("nozom_pos.offline");

/**
 * Print receipt / kitchen ticket from a local offline sale snapshot.
 * Never invents an ERPNext invoice number — shows Local Ref + Pending Sync.
 */
nozom_pos.offline.local_print = (() => {
	function esc(v) {
		return frappe.utils.escape_html(cstr(v || ""));
	}

	function money(amount, currency) {
		try {
			return format_currency(flt(amount), currency);
		} catch (e) {
			return String(flt(amount));
		}
	}

	function payment_status(tx) {
		const total = flt(tx.rounded_total) || flt(tx.grand_total);
		const paid = flt(tx.paid_amount);
		const outstanding = flt(tx.outstanding_amount);
		if (outstanding <= 0.0001 && paid + 0.0001 >= total) return __("Paid");
		if (paid <= 0.0001) return __("Unpaid");
		return __("Partially Paid");
	}

	function open_print_window(title, body_html) {
		const w = window.open("", "_blank", "width=420,height=640");
		if (!w) {
			frappe.msgprint(__("Please allow pop-ups to print."));
			return;
		}
		w.document.open();
		w.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title>
			<style>
				body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;margin:12px;color:#111}
				h1{font-size:16px;margin:0 0 8px}
				h2{font-size:14px;margin:12px 0 6px}
				.meta,.row{display:flex;justify-content:space-between;gap:8px;margin:2px 0}
				.muted{color:#666;font-size:11px}
				table{width:100%;border-collapse:collapse;margin-top:8px}
				th,td{text-align:left;padding:4px 0;border-bottom:1px solid #ddd;vertical-align:top}
				th.qty,td.qty,th.amt,td.amt{text-align:right}
				.notes{font-size:11px;color:#333;margin-top:2px}
				.banner{background:#f5f5f5;border:1px dashed #999;padding:6px 8px;margin:8px 0;font-size:12px}
				@media print{body{margin:0}}
			</style></head><body>${body_html}
			<script>window.onload=function(){setTimeout(function(){window.print();},120);}</script>
			</body></html>`);
		w.document.close();
	}

	function receipt_html(tx) {
		const currency = tx.currency;
		const items = (tx.items || [])
			.map(
				(row) => `<tr>
				<td>${esc(row.item_name || row.item_code)}
					${row.notes ? `<div class="notes">${esc(row.notes)}</div>` : ""}
				</td>
				<td class="qty">${flt(row.qty)}</td>
				<td class="amt">${money(flt(row.qty) * flt(row.rate), currency)}</td>
			</tr>`
			)
			.join("");

		const payments = (tx.payments || [])
			.filter((p) => flt(p.amount) > 0)
			.map(
				(p) =>
					`<div class="row"><span>${esc(__(p.mode_of_payment))}</span><strong>${money(
						p.amount,
						currency
					)}</strong></div>`
			)
			.join("");

		const local_ref = tx.local_receipt_no || tx.local_uuid || tx.id;
		const order_no = cstr(tx.nozom_order_number || "").trim();
		const phone = cstr(tx.nozom_customer_phone_snapshot || tx.contact_mobile || "").trim();
		const title = cstr(tx.nozom_address_title_snapshot || "").trim();
		const address = nozom_pos.address_format?.plain_text?.(
			tx.address_display || tx.shipping_address || "",
			", "
		);
		const address_line = title ? (address ? `${title} — ${address}` : title) : address;
		const location = nozom_pos.offline.qr?.sanitize?.(tx.nozom_delivery_location_link_snapshot);
		const qr_html = location ? nozom_pos.offline.qr.section_html(location) : "";
		const pay = nozom_pos.payment_status?.resolve?.(tx) || {};
		const pay_html = `
			<div class="row"><span>${__("Payment Status")}</span><strong>${esc(pay.label || "")}</strong></div>
			<div class="row"><span>${__("Paid")}</span><strong>${money(pay.paid, currency)}</strong></div>
			<div class="row"><span>${__("Remaining")}</span><strong>${money(
				pay.outstanding,
				currency
			)}</strong></div>
		`;

		return `
			<h1>${__("Sale Receipt")}</h1>
			<div class="banner">
				<div><strong>${__("Local Ref")}:</strong> ${esc(local_ref)}</div>
				<div>${__("Pending Sync")}</div>
				<div>${__("Status")}: ${esc(payment_status(tx))}</div>
			</div>
			<div class="meta"><span>${__("Customer")}</span><strong>${esc(
			tx.customer_name || tx.customer
		)}</strong></div>
			${phone ? `<div class="meta"><span>${__("Phone")}</span><strong>${esc(phone)}</strong></div>` : ""}
			${
				address_line
					? `<div class="meta"><span>${__("Delivery Address")}</span><strong>${esc(
							address_line
					  )}</strong></div>`
					: ""
			}
			${
				order_no
					? `<div class="meta"><span>${__("Order Number")}</span><strong>${esc(
							order_no
					  )}</strong></div>`
					: ""
			}
			<div class="muted">${esc(tx.created_at || tx.queued_at || "")}</div>
			<table>
				<thead><tr><th>${__("Item")}</th><th class="qty">${__("Qty")}</th><th class="amt">${__(
			"Amount"
		)}</th></tr></thead>
				<tbody>${items}</tbody>
			</table>
			<div class="row" style="margin-top:10px"><span>${__("Total")}</span><strong>${money(
			flt(tx.rounded_total) || flt(tx.grand_total),
			currency
		)}</strong></div>
			${pay_html}
			${payments ? `<h2>${__("Payments")}</h2>${payments}` : ""}
			${
				tx.order_notes
					? `<h2>${__("Order Notes")}</h2><div>${esc(tx.order_notes)}</div>`
					: ""
			}
			${qr_html}
		`;
	}

	function kitchen_html(tx) {
		const local_ref = tx.local_receipt_no || tx.local_uuid || tx.id;
		const order_no = cstr(tx.nozom_order_number || "").trim();
		const items = (tx.items || [])
			.map(
				(row) => `<tr>
				<td>${esc(row.item_name || row.item_code)}
					${row.notes ? `<div class="notes">${esc(row.notes)}</div>` : ""}
				</td>
				<td class="qty"><strong>${flt(row.qty)}</strong></td>
			</tr>`
			)
			.join("");

		return `
			<h1>${__("Kitchen Ticket")}</h1>
			<div class="banner">
				<div><strong>${__("Local Ref")}:</strong> ${esc(local_ref)}</div>
				<div>${__("Pending Sync")}</div>
				${order_no ? `<div><strong>${__("Order Number")}:</strong> ${esc(order_no)}</div>` : ""}
			</div>
			<div class="meta"><span>${__("Customer")}</span><strong>${esc(
			tx.customer_name || tx.customer
		)}</strong></div>
			<table>
				<thead><tr><th>${__("Item")}</th><th class="qty">${__("Qty")}</th></tr></thead>
				<tbody>${items}</tbody>
			</table>
			${
				tx.order_notes
					? `<h2>${__("Order Notes")}</h2><div>${esc(tx.order_notes)}</div>`
					: ""
			}
		`;
	}

	function print_receipt(tx) {
		if (!tx) return;
		open_print_window(__("Receipt"), receipt_html(tx));
	}

	function print_kitchen(tx) {
		if (!tx) return;
		open_print_window(__("Kitchen"), kitchen_html(tx));
	}

	return { print_receipt, print_kitchen, payment_status, open_print_window };
})();
