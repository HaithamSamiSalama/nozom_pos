/**
 * NOZOM POS brand lock.
 *
 * Desktop Icon and app name stay "NOZOM POS".
 * The POS page title/header is "NOZOM POS".
 * Neither string is translated.
 *
 * Loaded on Desk (app_include_js) and inside the POS bundle.
 */
frappe.provide("nozom_pos");

nozom_pos.BRAND_NAME = "NOZOM POS";
nozom_pos.PAGE_TITLE = "NOZOM POS";

nozom_pos.lock_brand_translations = function lock_brand_translations() {
	const brand = nozom_pos.BRAND_NAME;
	const page_title = nozom_pos.PAGE_TITLE;
	if (!frappe._messages) frappe._messages = {};
	// Identity mapping — these literals stay English even when lang=ar.
	frappe._messages[brand] = brand;
	frappe._messages[page_title] = page_title;

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
	const brand = nozom_pos.PAGE_TITLE;
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

/**
 * Dock Item.icon is an Icon name field; Frappe's sprite helper cannot draw an
 * asset path. When the pin stores the Apps Screen SVG path, render that same
 * asset as an <img> so Desk home / Apps Screen / App Rail stay identical.
 */
nozom_pos.DOCK_ASSET_ICON = "/assets/nozom_pos/images/nozom-pos.svg";

nozom_pos.is_asset_icon = function is_asset_icon(icon) {
	return (
		typeof icon === "string" &&
		(icon.includes("/assets/") || icon.endsWith(".svg") || icon.startsWith("http"))
	);
};

nozom_pos.asset_icon_html = function asset_icon_html(icon, label) {
	const src = frappe.utils.escape_html(icon);
	const alt = frappe.utils.escape_html(label || nozom_pos.BRAND_NAME);
	return `<img class="nozom-pos-dock-asset" src="${src}" alt="${alt}" draggable="false" />`;
};

nozom_pos.patch_dock_asset_icons = function patch_dock_asset_icons() {
	if (window.__nozom_pos_dock_icon_patched) return;
	if (!window.frappe?.ui?.Dock?.prototype?.make_dock_item) return;

	const proto = frappe.ui.Dock.prototype;
	const original = proto.make_dock_item;
	proto.make_dock_item = function make_dock_item_with_asset(entry) {
		const $item = original.call(this, entry);
		if (!$item || !entry?.icon || !nozom_pos.is_asset_icon(entry.icon)) return $item;
		$item.find(".dock-item-icon").html(nozom_pos.asset_icon_html(entry.icon, entry.label));
		return $item;
	};

	// Sidebar header / row icons that reuse the same asset path.
	if (frappe.utils?.icon && !frappe.utils.__nozom_pos_icon_patched) {
		const icon_original = frappe.utils.icon.bind(frappe.utils);
		frappe.utils.icon = function nozom_pos_icon(icon_name, ...rest) {
			if (nozom_pos.is_asset_icon(icon_name)) {
				return nozom_pos.asset_icon_html(icon_name, nozom_pos.BRAND_NAME);
			}
			return icon_original(icon_name, ...rest);
		};
		frappe.utils.__nozom_pos_icon_patched = true;
	}

	window.__nozom_pos_dock_icon_patched = true;
};

nozom_pos.start_brand_watch = function start_brand_watch() {
	if (window.__nozom_brand_watch) return;
	window.__nozom_brand_watch = true;

	nozom_pos.lock_brand_translations();
	nozom_pos.enforce_desktop_icon_brand();
	nozom_pos.patch_dock_asset_icons();

	const run = () => {
		nozom_pos.lock_brand_translations();
		nozom_pos.enforce_desktop_icon_brand();
		nozom_pos.patch_dock_asset_icons();
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
