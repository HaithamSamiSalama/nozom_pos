frappe.provide("nozom_pos");

/**
 * POS-only language preference (en | ar).
 *
 * Authoritative state: localStorage key `nozom_pos_language`
 * Never writes User / Desk language.
 * Never uses document.documentElement / body dir as POS direction source.
 *
 * Translation flow:
 * 1. Load POS message table for target language
 * 2. Install into frappe._messages (so __() / pos_t resolve correctly)
 * 3. Apply RTL/LTR on ALL NOZOM-owned roots (never html/body)
 * 4. Retranslate / refresh visible POS components
 */
nozom_pos.i18n = (() => {
	const STORAGE_KEY = "nozom_pos_language";
	const SUPPORTED = ["en", "ar"];
	const BRAND = "NOZOM POS";
	const MSG_CACHE_PREFIX = "nozom_pos_msgs_v5_";

	const POS_SURFACE_SELECTORS = [
		'.page-container[data-page-route="point-of-sale"]',
		".point-of-sale-app",
		".page-head",
		".page-head-content",
		".page-head .standard-actions",
		".page-head .custom-actions",
		".nozom-pos-topbar",
		".nozom-checkout-dialog",
		".nozom-pos-centered-dialog",
		".nozom-customer-dialog",
		".nozom-address-dialog",
		".nozom-close-period-dialog",
		".nozom-open-period-dialog",
		".nozom-post-close-dialog",
		".nozom-conflict-dialog",
		".nozom-touch-payment-dialog",
		".nozom-recent-tx-panel",
	].join(", ");

	let original_boot_lang = null;
	let original_messages = null;
	let message_cache = {};
	let applying = false;
	let pending_apply = null;
	let toggle_token = 0;
	let direction_observer = null;

	function normalize(lang) {
		const v = cstr(lang || "").toLowerCase().slice(0, 2);
		return SUPPORTED.includes(v) ? v : "en";
	}

	function desk_default_lang() {
		return normalize(original_boot_lang || frappe.boot?.lang || "en");
	}

	function has_stored_preference() {
		try {
			const v = localStorage.getItem(STORAGE_KEY);
			return Boolean(v && SUPPORTED.includes(normalize(v)));
		} catch (e) {
			return false;
		}
	}

	function get() {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored && SUPPORTED.includes(normalize(stored))) {
				return normalize(stored);
			}
		} catch (e) {
			/* ignore */
		}
		// First-run only: inherit Desk language once preference is absent
		return desk_default_lang();
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

	function stamp_el(el, lang, dir, is_ar) {
		if (!el) return;
		el.classList.add("nozom-pos-surface");
		el.setAttribute("dir", dir);
		el.setAttribute("lang", lang);
		el.classList.toggle("nozom-pos-rtl", is_ar);
		el.classList.toggle("nozom-pos-ltr", !is_ar);
	}

	/**
	 * POS-local direction only. Never touch html/body/documentElement.
	 * Stamps every NOZOM-owned root including top bar + body-mounted dialogs.
	 */
	function apply_direction(lang) {
		lang = normalize(lang || get());
		const is_ar = lang === "ar";
		const dir = is_ar ? "rtl" : "ltr";
		const root = pos_root();

		if (root) {
			root.classList.add("nozom-pos-root");
			stamp_el(root, lang, dir, is_ar);
		}

		document.querySelectorAll(POS_SURFACE_SELECTORS).forEach((el) => {
			stamp_el(el, lang, dir, is_ar);
		});

		// Nested POS chrome that may sit under page-head after remounts
		if (root) {
			root
				.querySelectorAll(
					".point-of-sale-app, .page-head, .page-head-content, .standard-actions, .custom-actions, .nozom-pos-topbar"
				)
				.forEach((el) => stamp_el(el, lang, dir, is_ar));
		}

		// Body-mounted modals that wrap NOZOM dialogs (Frappe Dialog root)
		document.querySelectorAll(".modal").forEach((modal) => {
			if (
				modal.classList.contains("nozom-pos-surface") ||
				modal.querySelector(
					".nozom-checkout-dialog, .nozom-pos-centered-dialog, .nozom-customer-dialog, .nozom-address-dialog, .nozom-close-period-dialog, .nozom-open-period-dialog, .nozom-post-close-dialog, .nozom-conflict-dialog, .nozom-touch-payment-dialog"
				) ||
				modal.matches(
					".nozom-checkout-dialog, .nozom-pos-centered-dialog, .nozom-customer-dialog, .nozom-address-dialog, .nozom-close-period-dialog, .nozom-open-period-dialog, .nozom-post-close-dialog, .nozom-conflict-dialog, .nozom-touch-payment-dialog"
				)
			) {
				stamp_el(modal, lang, dir, is_ar);
				modal.querySelectorAll(".modal-dialog, .modal-content, .modal-body, .modal-header, .modal-footer").forEach(
					(child) => stamp_el(child, lang, dir, is_ar)
				);
			}
		});
	}

	function ensure_direction_observer() {
		if (direction_observer || typeof MutationObserver === "undefined") return;
		direction_observer = new MutationObserver((mutations) => {
			if (!document.body?.classList?.contains("nozom-pos-page-active")) return;
			let needs = false;
			for (const m of mutations) {
				for (const node of m.addedNodes || []) {
					if (node.nodeType !== 1) continue;
					const el = node;
					if (
						el.matches?.(POS_SURFACE_SELECTORS) ||
						el.classList?.contains("modal") ||
						el.querySelector?.(POS_SURFACE_SELECTORS)
					) {
						needs = true;
						break;
					}
				}
				if (needs) break;
			}
			if (needs) apply_direction(get());
		});
		direction_observer.observe(document.body, { childList: true, subtree: true });
	}

	/**
	 * POS translation helper — resolves from current POS language state.
	 * Brand name is never translated.
	 */
	function t(txt, replace, context = null) {
		if (!txt) return txt;
		if (typeof txt !== "string") return txt;
		if (txt === BRAND) return BRAND;

		let translated = "";
		const key = txt;
		if (context) {
			translated = frappe._messages[`${key}:${context}`];
		}
		if (!translated) {
			translated = frappe._messages[key] || txt;
		}
		if (replace && typeof replace === "object") {
			translated = $.format(translated, replace);
		}
		return translated;
	}

	async function fetch_messages(lang) {
		lang = normalize(lang);
		const r = await frappe.call({
			method: "nozom_pos.api.i18n.get_pos_messages",
			args: { lang },
			freeze: false,
		});
		const msgs = r.message || {};
		if (typeof msgs !== "object" || Array.isArray(msgs)) {
			throw new Error("Invalid POS message payload");
		}
		return msgs;
	}

	async function load_messages(lang) {
		lang = normalize(lang);
		if (message_cache[lang] && Object.keys(message_cache[lang]).length) {
			return message_cache[lang];
		}

		try {
			const raw = sessionStorage.getItem(`${MSG_CACHE_PREFIX}${lang}`);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
					message_cache[lang] = parsed;
					return parsed;
				}
			}
		} catch (e) {
			/* ignore corrupt cache */
		}

		const msgs = await fetch_messages(lang);
		message_cache[lang] = msgs;
		try {
			sessionStorage.setItem(`${MSG_CACHE_PREFIX}${lang}`, JSON.stringify(msgs));
		} catch (e) {
			/* quota — memory cache still valid */
		}
		return msgs;
	}

	/**
	 * Install POS language into frappe._messages so __() and pos_t() agree.
	 * Does NOT mutate frappe.boot.lang — Desk RTL/LTR stays independent.
	 */
	function install_messages(lang, msgs) {
		remember_desk_baseline();
		lang = normalize(lang);
		msgs = msgs || {};

		if (lang === "ar") {
			frappe._messages = { ...(original_messages || {}), ...msgs };
		} else {
			frappe._messages = { ...(original_messages || {}) };
			const ar_table = message_cache.ar || {};
			Object.keys(ar_table).forEach((key) => {
				frappe._messages[key] = key;
			});
			Object.keys(msgs).forEach((key) => {
				frappe._messages[key] = key;
			});
		}

		frappe._messages[BRAND] = BRAND;
		nozom_pos.lock_brand_translations?.();
	}

	async function ensure_ar_table_for_english_reset() {
		if (message_cache.ar && Object.keys(message_cache.ar).length) return;
		try {
			message_cache.ar = await load_messages("ar");
		} catch (e) {
			console.warn("NOZOM POS could not preload Arabic table for EN reset", e);
		}
	}

	async function apply(lang, { refresh_ui = true, persist_preference = true } = {}) {
		lang = normalize(lang);

		if (applying) {
			pending_apply = { lang, refresh_ui, persist_preference };
			return;
		}

		applying = true;
		if (persist_preference || has_stored_preference()) {
			persist(lang);
		}

		try {
			if (lang === "en") {
				await ensure_ar_table_for_english_reset();
			}
			const msgs = await load_messages(lang);
			install_messages(lang, msgs);
			apply_direction(lang);
			ensure_direction_observer();
			update_lang_button();
			if (refresh_ui) {
				refresh_pos_ui();
			}
			nozom_pos.set_brand_page_title?.(window.cur_pos?.page);
		} catch (e) {
			console.error("NOZOM POS i18n apply failed", e);
			apply_direction(lang);
			update_lang_button();
			(nozom_pos.notify || frappe.show_alert)({
				message: __("Could not load POS translations."),
				indicator: "orange",
			});
		} finally {
			applying = false;
		}

		if (pending_apply) {
			const next = pending_apply;
			pending_apply = null;
			if (next.lang !== get()) {
				await apply(next.lang, {
					refresh_ui: next.refresh_ui,
					persist_preference: next.persist_preference,
				});
			} else if (next.refresh_ui) {
				update_lang_button();
				refresh_pos_ui();
			}
		}
	}

	function restore_desk_language() {
		if (original_boot_lang == null) return;
		// Restore Desk message table only — never mutated boot.lang for POS
		if (original_messages) {
			frappe._messages = { ...original_messages };
			nozom_pos.lock_brand_translations?.();
		}
	}

	function refresh_pos_ui() {
		const ctrl = window.cur_pos;
		try {
			ctrl?.prepare_btns?.();
			ctrl?.cart?.refresh_i18n_labels?.();
			ctrl?.cart?.update_customer_section?.();
			ctrl?.cart?.update_totals_section?.(ctrl.frm);
			ctrl?.item_selector?.refresh_i18n_labels?.();
			ctrl?.past_order_list?.refresh_i18n_labels?.();
			ctrl?.order_summary?.refresh_i18n_labels?.();
			nozom_pos.offline?.status_ui?.update?.({});
			nozom_pos.offline?.refresh_status?.();
			nozom_pos.set_brand_page_title?.(ctrl?.page);
			nozom_pos.lock_brand_translations?.();
			apply_direction(get());
		} catch (e) {
			console.warn("NOZOM POS i18n refresh", e);
		}
	}

	function update_lang_button() {
		const lang = get();
		const $btn = $(".nozom-pos-lang-btn");
		if (!$btn.length) return;
		const label = lang === "ar" ? "EN" : "عربي";
		const title = lang === "ar" ? t("Switch to English") : t("Switch to Arabic");
		$btn.prop("disabled", false).attr("title", title).attr("aria-label", title);
		$btn.find(".nozom-pos-lang-label").text(label);
	}

	async function toggle() {
		const token = ++toggle_token;
		const next = get() === "ar" ? "en" : "ar";
		await apply(next, { refresh_ui: true, persist_preference: true });
		if (token === toggle_token) {
			update_lang_button();
		}
	}

	async function boot_on_pos() {
		remember_desk_baseline();
		const lang = get();
		// Persist first-run desk default so subsequent opens are stable
		if (!has_stored_preference()) {
			persist(lang);
		}
		await apply(lang, { refresh_ui: false, persist_preference: true });
		apply_direction(lang);
		ensure_direction_observer();
		update_lang_button();
		nozom_pos.set_brand_page_title?.(window.cur_pos?.page);
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
		refresh_pos_ui,
		t,
		pos_t: t,
	};
})();

// Public alias used by POS components
nozom_pos.t = (...args) => nozom_pos.i18n.t(...args);
nozom_pos.pos_t = nozom_pos.t;
