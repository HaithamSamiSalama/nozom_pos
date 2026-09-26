frappe.provide("nozom_pos.offline");

/**
 * Local invoice totals without frm.set_value / server round-trips.
 * Used for offline cart + payment preparation.
 */
nozom_pos.offline.totals = (() => {
	function precision_for(field) {
		try {
			return cint(frappe.meta.get_field_precision?.({ fieldname: field })) || 2;
		} catch (e) {
			return 2;
		}
	}

	function recalculate(frm) {
		if (!frm?.doc) return;
		const doc = frm.doc;
		const p = precision_for("grand_total");

		let net = 0;
		(doc.items || []).forEach((row) => {
			const qty = flt(row.qty);
			const rate = flt(row.rate);
			row.amount = flt(qty * rate, p);
			row.stock_qty = flt(qty * (flt(row.conversion_factor) || 1));
			net += flt(row.amount);
		});

		doc.net_total = flt(net, p);
		doc.total = flt(net, p);
		doc.base_net_total = flt(net * (flt(doc.conversion_rate) || 1), p);

		let discount = 0;
		if (flt(doc.additional_discount_percentage)) {
			discount = flt((net * flt(doc.additional_discount_percentage)) / 100, p);
			doc.discount_amount = discount;
		} else {
			discount = flt(doc.discount_amount, p);
		}

		const taxable = flt(net - discount, p);
		let tax_total = 0;
		(doc.taxes || []).forEach((t) => {
			const rate = flt(t.rate);
			if (rate) {
				const amt = flt((taxable * rate) / 100, p);
				t.tax_amount = amt;
				t.base_tax_amount = amt;
				t.tax_amount_after_discount_amount = amt;
				t.base_tax_amount_after_discount_amount = amt;
				tax_total += amt;
			} else {
				tax_total += flt(t.tax_amount_after_discount_amount || t.tax_amount);
			}
		});

		doc.total_taxes_and_charges = flt(tax_total, p);
		const grand = flt(taxable + tax_total, p);
		doc.grand_total = grand;
		doc.base_grand_total = flt(grand * (flt(doc.conversion_rate) || 1), p);

		if (cint(doc.disable_rounded_total)) {
			doc.rounded_total = grand;
			doc.base_rounded_total = doc.base_grand_total;
		} else {
			doc.rounded_total = flt(Math.round(grand), p);
			doc.base_rounded_total = flt(Math.round(doc.base_grand_total), p);
		}

		// Until payments applied — outstanding equals invoice total
		const paid = flt(doc.paid_amount);
		const total_due = erpnext.PointOfSale?.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || grand;
		doc.outstanding_amount = flt(Math.max(total_due - paid + flt(doc.change_amount), 0), p);
	}

	function apply_payments_local(frm, modes, { precision, change } = {}) {
		const doc = frm.doc;
		const p = precision != null ? precision : 2;

		const positive = (modes || []).filter((row) => flt(row.amount) > 0.0000001);

		// Unpaid / credit — clear payment rows; do not invent Cash = 0.
		if (!positive.length) {
			doc.payments = [];
			doc.paid_amount = 0;
			doc.base_paid_amount = 0;
			doc.change_amount = 0;
			doc.base_change_amount = 0;
			const total_due = erpnext.PointOfSale?.get_invoice_total
				? erpnext.PointOfSale.get_invoice_total(doc)
				: flt(doc.rounded_total) || flt(doc.grand_total);
			doc.outstanding_amount = flt(total_due, p);
			return {
				tendered: 0,
				change: 0,
				outstanding: doc.outstanding_amount,
				total: total_due,
			};
		}

		(modes || []).forEach((row) => {
			const payment = (doc.payments || []).find((x) => x.mode_of_payment === row.mode_of_payment);
			if (!payment) return;
			payment.amount = flt(row.amount, p);
			payment.base_amount = flt(payment.amount * (flt(doc.conversion_rate) || 1), p);
		});

		let tendered = 0;
		(doc.payments || []).forEach((pay) => {
			tendered += flt(pay.amount);
		});
		tendered = flt(tendered, p);

		doc.paid_amount = tendered;
		doc.base_paid_amount = flt(tendered * (flt(doc.conversion_rate) || 1), p);
		doc.change_amount = flt(change || 0, p);
		doc.base_change_amount = flt(doc.change_amount * (flt(doc.conversion_rate) || 1), p);

		const total_due = erpnext.PointOfSale?.get_invoice_total
			? erpnext.PointOfSale.get_invoice_total(doc)
			: flt(doc.rounded_total) || flt(doc.grand_total);
		doc.outstanding_amount = flt(Math.max(total_due - tendered + flt(doc.change_amount), 0), p);

		return {
			tendered,
			change: doc.change_amount,
			outstanding: doc.outstanding_amount,
			total: total_due,
		};
	}

	return { recalculate, apply_payments_local };
})();
