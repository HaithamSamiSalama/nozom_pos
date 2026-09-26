frappe.provide("nozom_pos");

/**
 * POS-only language preference (en | ar).
 * Never writes User / Desk language — localStorage + in-memory frappe._messages only.
 */
nozom_pos.i18n = (() => {
	const STORAGE_KEY = "nozom_pos_language";
	const SUPPORTED = ["en", "ar"];
	let original_boot_lang = null;
	let original_messages = null;
	let message_cache = {};
	let applying = false;

	function normalize(lang) {
		const v = cstr(lang || "").toLowerCase().slice(0, 2);
		return SUPPORTED.includes(v) ? v : "en";
	}

	function get() {
		try {
			return normalize(localStorage.getItem(STORAGE_KEY) || "en");
		} catch (e) {
			return "en";
		}
	}

	function persist(lang) {
		try {
			localStorage.setItem(STORAGE_KEY, normalize(lang));
		} catch (e) {
			/* ignore */
		}
	}

	function remember_desk_baseline() {
		if (original_boot_lang == null) {
			original_boot_lang = frappe.boot?.lang || "en";
			original_messages = { ...(frappe._messages || {}) };
		}
	}

	function pos_root() {
		return (
			document.querySelector('.page-container[data-page-route="point-of-sale"]') ||
			document.querySelector(".point-of-sale-app")?.closest(".page-container") ||
			document.querySelector(".point-of-sale-app")
		);
	}

	function apply_direction(lang) {
		const root = pos_root();
		if (!root) return;
		root.classList.add("nozom-pos-root");
		root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
		root.setAttribute("lang", lang);
		root.classList.toggle("nozom-pos-rtl", lang === "ar");
		root.classList.toggle("nozom-pos-ltr", lang !== "ar");

		// Dialogs opened from POS
		document.querySelectorAll(".nozom-checkout-dialog, .nozom-pos-centered-dialog, .nozom-customer-dialog, .nozom-address-dialog, .nozom-close-period-dialog, .nozom-open-period-dialog, .nozom-post-close-dialog").forEach((el) => {
			el.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
			el.classList.toggle("nozom-pos-rtl", lang === "ar");
		});
	}

	async function load_messages(lang) {
		lang = normalize(lang);
		if (message_cache[lang]) return message_cache[lang];

		// Prefer cached session payload
		try {
			const raw = sessionStorage.getItem(`nozom_pos_msgs_v3_${lang}`);
			if (raw) {
				message_cache[lang] = JSON.parse(raw);
				return message_cache[lang];
			}
		} catch (e) {
			/* ignore */
		}

		try {
			const r = await frappe.call({
				method: "nozom_pos.api.i18n.get_pos_messages",
				args: { lang },
				freeze: false,
			});
			message_cache[lang] = r.message || {};
			try {
				sessionStorage.setItem(`nozom_pos_msgs_v3_${lang}`, JSON.stringify(message_cache[lang]));
			} catch (e) {
				/* ignore */
			}
			return message_cache[lang];
		} catch (e) {
			console.warn("NOZOM POS i18n load failed", e);
			return {};
		}
	}

	async function apply(lang, { refresh_ui = true } = {}) {
		if (applying) return;
		applying = true;
		remember_desk_baseline();
		lang = normalize(lang);
		persist(lang);
		apply_direction(lang);

		try {
			const msgs = await load_messages(lang);
			// In-memory only — never User.set_value / never Desk preference APIs
			frappe.boot.lang = lang;
			frappe._messages = { ...(original_messages || {}), ...msgs };
		} finally {
			applying = false;
		}

		update_lang_button();
		if (refresh_ui) refresh_pos_ui();
	}

	function restore_desk_language() {
		if (original_boot_lang == null) return;
		frappe.boot.lang = original_boot_lang;
		if (original_messages) frappe._messages = { ...original_messages };
	}

	function refresh_pos_ui() {
		const ctrl = window.cur_pos;
		try {
			ctrl?.prepare_btns?.();
			ctrl?.cart?.refresh_i18n_labels?.();
			ctrl?.cart?.update_customer_section?.();
			ctrl?.cart?.update_totals_section?.(ctrl.frm);
			ctrl?.past_order_list?.refresh_i18n_labels?.() ||
				ctrl?.past_order_list?.make_filter_section?.();
			nozom_pos.offline?.status_ui?.update?.({});
			nozom_pos.offline?.refresh_status?.();
		} catch (e) {
			console.warn("NOZOM POS i18n refresh", e);
		}
	}

	function update_lang_button() {
		const lang = get();
		const $btn = $(".nozom-pos-lang-btn");
		if (!$btn.length) return;
		const label = lang === "ar" ? "EN" : "عربي";
		const title = lang === "ar" ? __("Switch to English") : __("Switch to Arabic");
		$btn.attr("title", title).attr("aria-label", title);
		$btn.find(".nozom-pos-lang-label").text(label);
	}

	async function toggle() {
		const next = get() === "ar" ? "en" : "ar";
		await apply(next, { refresh_ui: true });
	}

	async function boot_on_pos() {
		remember_desk_baseline();
		await apply(get(), { refresh_ui: false });
	}

	return {
		STORAGE_KEY,
		get,
		set: apply,
		apply,
		toggle,
		boot_on_pos,
		restore_desk_language,
		apply_direction,
		update_lang_button,
	};
})();
