/**
 * Quick CSS safeguards for POS Home + Language top-bar buttons.
 * Run: node --test nozom_pos/tests/test_topbar_home_lang_css.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scss = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "public/scss/nozom_pos.bundle.scss"),
	"utf8"
);

test("language button has auto width and no fixed min-width 52px", () => {
	assert.equal(/min-width:\s*52px/.test(scss), false);
	assert.match(scss, /\.nozom-pos-lang-btn[\s\S]*?width:\s*auto\s*!important/);
	assert.match(scss, /\.nozom-pos-lang-btn[\s\S]*?min-width:\s*0\s*!important/);
	assert.match(scss, /background:\s*var\(--gray-700/);
});

test("home button uses #2563eb with white icon stroke", () => {
	assert.match(scss, /\.nozom-home-btn[\s\S]*?background:\s*#2563eb\s*!important/);
	assert.match(scss, /\.nozom-home-btn[\s\S]*?--icon-stroke:\s*#fff\s*!important/);
	assert.match(scss, /\.nozom-home-btn[\s\S]*?width:\s*auto\s*!important/);
});

test("home and language share compact 28px height with sibling actions", () => {
	assert.match(
		scss,
		/\.nozom-home-btn,\s*\n\s*\.nozom-pos-lang-btn\s*\{[\s\S]*?height:\s*28px\s*!important/
	);
	assert.match(scss, /padding-inline:\s*0\.85rem\s*!important/);
	assert.match(scss, /border-radius:\s*var\(--border-radius-md\)\s*!important/);
});
