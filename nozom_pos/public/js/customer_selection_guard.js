frappe.provide("nozom_pos.customer_selection");

/**
 * Pure helpers for POS customer Link commit vs search-text separation.
 * Keep ERPNext party lookups from receiving typed fragments like "R".
 */
nozom_pos.customer_selection = (() => {
	function normalize_ref(customer) {
		if (!customer) return null;
		if (typeof customer === "string") {
			const value = customer.trim();
			return value || null;
		}
		return (
			customer.name ||
			customer.customer ||
			customer.server_customer_name ||
			customer.local_customer_id ||
			null
		);
	}

	function is_link_option_value(value) {
		const id = normalize_ref(value);
		return Boolean(id && String(id).includes("__link_option"));
	}

	function is_same_committed_customer(candidate, committed, doc_customer) {
		const id = normalize_ref(candidate);
		if (!id) return false;
		return id === normalize_ref(committed) && id === normalize_ref(doc_customer);
	}

	/**
	 * Decide what to do after an async customer resolve finishes.
	 * @returns {{action: "ignore_stale"|"ignore_empty"|"ignore_option"|"revert"|"commit", customer?: string, previous?: string|null}}
	 */
	function decide_commit_result({
		candidate,
		resolved_name,
		previous,
		token,
		current_token,
	}) {
		if (token !== current_token) {
			return { action: "ignore_stale" };
		}
		const id = normalize_ref(candidate);
		if (!id) {
			return { action: "ignore_empty" };
		}
		if (is_link_option_value(id)) {
			return { action: "ignore_option" };
		}
		const resolved = normalize_ref(resolved_name);
		if (!resolved) {
			return { action: "revert", previous: previous || null };
		}
		return { action: "commit", customer: resolved, previous: previous || null };
	}

	return {
		normalize_ref,
		is_link_option_value,
		is_same_committed_customer,
		decide_commit_result,
	};
})();
