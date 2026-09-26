/**
 * NOZOM POS brand lock.
 *
 * The product name is NEVER translated — Arabic or English UI must always show:
 *   NOZOM POS
 *
 * Loaded on Desk (app_include_js) and inside the POS bundle.
 */
frappe.provide("nozom_pos");

nozom_pos.BRAND_NAME = "NOZOM POS";

nozom_pos.lock_brand_translations = function lock_brand_translations() {
	const brand = nozom_pos.BRAND_NAME;
	if (!frappe._messages) frappe._messages = {};
	// Identity mapping — __( "NOZOM POS" ) stays English even when lang=ar.
	frappe._messages[brand] = brand;

	// Desk / apps switcher title from boot
	const apps = frappe.boot?.app_data;
	if (Array.isArray(apps)) {
		apps.forEach((app) => {
			if (
				app?.app_name === "nozom_pos" ||
				cstr(app?.app_title) === brand ||
				cstr(app?.app_title).includes("نوزوم")
			) {
				app.app_title = brand;
			}
		});
	}
};

nozom_pos.set_brand_page_title = function set_brand_page_title(page) {
	const brand = nozom_pos.BRAND_NAME;
	nozom_pos.lock_brand_translations();
	try {
		if (page?.set_title) {
			page.set_title(brand, null, true, brand);
		} else if (frappe.utils?.set_title) {
			frappe.utils.set_title(brand);
		} else {
			document.title = brand;
		}
	} catch (e) {
		try {
			document.title = brand;
		} catch (e2) {
			/* ignore */
		}
	}
};

/**
 * Desktop Icon template uses __(icon.label). After render, force the caption
 * back to the brand literal so Arabic Desk language cannot localize it.
 */
nozom_pos.enforce_desktop_icon_brand = function enforce_desktop_icon_brand() {
	const brand = nozom_pos.BRAND_NAME;
	document.querySelectorAll(`.desktop-icon[data-id="${brand}"]`).forEach((icon) => {
		icon.querySelectorAll(".icon-title").forEach((el) => {
			if (el.textContent !== brand) el.textContent = brand;
			el.setAttribute("data-original-title", brand);
			el.setAttribute("title", brand);
		});
		const img = icon.querySelector("img.app-icon");
		if (img && img.getAttribute("alt") !== brand) {
			img.setAttribute("alt", brand);
		}
	});
};

nozom_pos.start_brand_watch = function start_brand_watch() {
	if (window.__nozom_brand_watch) return;
	window.__nozom_brand_watch = true;

	nozom_pos.lock_brand_translations();
	nozom_pos.enforce_desktop_icon_brand();

	const run = () => {
		nozom_pos.lock_brand_translations();
		nozom_pos.enforce_desktop_icon_brand();
	};

	// Desk desktop icons are rendered async after boot
	$(document).on("page-change.nozom_brand", run);
	setTimeout(run, 0);
	setTimeout(run, 500);
	setTimeout(run, 1500);

	try {
		const root = document.body;
		if (!root || typeof MutationObserver === "undefined") return;
		const obs = new MutationObserver(() => {
			if (document.querySelector(`.desktop-icon[data-id="${nozom_pos.BRAND_NAME}"]`)) {
				nozom_pos.enforce_desktop_icon_brand();
			}
		});
		obs.observe(root, { childList: true, subtree: true });
	} catch (e) {
		/* ignore */
	}
};

$(() => {
	nozom_pos.start_brand_watch();
});
