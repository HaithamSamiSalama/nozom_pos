frappe.ui.form.on("POS Profile", {
	refresh(frm) {
		render_nozom_print_logo_preview(frm);
	},

	nozom_print_logo(frm) {
		render_nozom_print_logo_preview(frm);
	},

	nozom_print_logo_size(frm) {
		render_nozom_print_logo_preview(frm);
	},
});

function render_nozom_print_logo_preview(frm) {
	const field = frm.fields_dict.nozom_print_logo_preview;
	if (!field?.$wrapper) return;

	const logo = cstr(frm.doc.nozom_print_logo || "").trim();

	if (!logo) {
		field.$wrapper.html(`
			<div style="
				border:1px dashed var(--border-color);
				border-radius:8px;
				padding:14px;
				text-align:center;
				color:var(--text-muted);
				background:var(--control-bg);
			">
				${__("No print logo selected")}
			</div>
		`);
		return;
	}

	const safe_logo = frappe.utils.escape_html(logo);
	let raw_size = parseInt(frm.doc.nozom_print_logo_size, 10);
	if (isNaN(raw_size) || raw_size <= 0) {
		raw_size = 55;
	} else if (raw_size < 20) {
		raw_size = 20;
	} else if (raw_size > 120) {
		raw_size = 120;
	}

	field.$wrapper.html(`
		<div style="
			border:1px solid var(--border-color);
			border-radius:8px;
			padding:10px;
			background:#fff;
			text-align:center;
			max-width:340px;
		">
			<div style="
				font-size:12px;
				font-weight:600;
				margin-bottom:8px;
				color:var(--text-muted);
			">
				${__("Receipt Logo Preview")} (${raw_size}px)
			</div>

			<img
				src="${safe_logo}"
				alt="${__("Print Logo")}"
				style="
					display:block;
					margin:0 auto;
					max-width:100%;
					max-height:${raw_size}px;
					width:auto;
					height:auto;
					object-fit:contain;
				"
			>
		</div>
	`);
}
