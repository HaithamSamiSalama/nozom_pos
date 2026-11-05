import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

import frappe
from frappe import _
from frappe.query_builder import Table
from frappe.utils import cstr, encode
from frappe.utils.password import get_encryption_key


PBKDF2_ITERATIONS = 210_000
ALGORITHM = "PBKDF2-SHA256"
VERSION = 1

Auth = Table("__Auth")
SUPERVISOR_PASSWORD_FIELD = "nozom_offline_admin_password"


def _require_pos_admin():
	roles = set(frappe.get_roles(frappe.session.user))

	if frappe.session.user == "Administrator" or "System Manager" in roles:
		return

	frappe.throw(
		_("Only an administrator can manage failed offline transactions."),
		frappe.PermissionError,
	)


def _ensure_pos_profile_access(pos_profile: str):
	if not pos_profile:
		frappe.throw(_("POS Profile is required."))

	if not frappe.has_permission("POS Profile", "read", pos_profile):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _read_supervisor_password(pos_profile: str):
	"""Read supervisor password without surfacing Frappe encryption-key msgprint.

	Returns:
	        (password, error_code)
	        error_code is None | "missing" | "decrypt_failed"
	"""
	_ensure_pos_profile_access(pos_profile)

	result = (
		frappe.qb.from_(Auth)
		.select(Auth.password, Auth.encrypted)
		.where(
			(Auth.doctype == "POS Profile")
			& (Auth.name == pos_profile)
			& (Auth.fieldname == SUPERVISOR_PASSWORD_FIELD)
		)
		.limit(1)
	).run()

	if not result or not result[0][0]:
		return None, "missing"

	stored, encrypted = result[0]
	if not cint_or_truthy(encrypted):
		return cstr(stored), None

	try:
		cipher_suite = Fernet(encode(get_encryption_key()))
		return cstr(cipher_suite.decrypt(encode(stored))), None
	except InvalidToken:
		# Corrupt / foreign encryption key — do not call frappe.throw (msgprint).
		return None, "decrypt_failed"
	except Exception:
		return None, "decrypt_failed"


def cint_or_truthy(value):
	try:
		return int(value or 0) == 1
	except Exception:
		return bool(value)


def _decrypt_failed_reason():
	return _(
		"Could not read supervisor password. Open POS Profile, clear and re-save Cashier Supervisor Password, then try again."
	)


@frappe.whitelist()
def get_offline_admin_verifier(pos_profile: str):
	_require_pos_admin()
	_ensure_pos_profile_access(pos_profile)

	password, err = _read_supervisor_password(pos_profile)

	if err == "decrypt_failed":
		frappe.throw(_decrypt_failed_reason())

	if not password:
		return {
			"configured": False,
			"version": VERSION,
		}

	salt = secrets.token_bytes(16)

	verifier = hashlib.pbkdf2_hmac(
		"sha256",
		password.encode("utf-8"),
		salt,
		PBKDF2_ITERATIONS,
	)

	profile = frappe.get_cached_doc("POS Profile", pos_profile)

	return {
		"configured": True,
		"version": VERSION,
		"algorithm": ALGORITHM,
		"iterations": PBKDF2_ITERATIONS,
		"salt": salt.hex(),
		"verifier": verifier.hex(),
		"pos_profile": pos_profile,
		"profile_modified": str(profile.modified),
	}


@frappe.whitelist()
def verify_supervisor_password(pos_profile: str, password: str = None):
	"""Verify cashier supervisor password from POS Profile settings.

	Used to authorize Cancel Invoice and Return from the POS past-order screen.
	Any signed-in user with POS Profile read access may attempt verification.
	"""
	stored, err = _read_supervisor_password(pos_profile)

	if err == "decrypt_failed":
		return {
			"ok": False,
			"reason": _decrypt_failed_reason(),
		}

	if err == "missing" or not stored:
		return {
			"ok": False,
			"reason": _(
				"Supervisor password is not configured for this POS Profile."
			),
		}

	candidate = cstr(password or "")
	if not candidate:
		return {
			"ok": False,
			"reason": _("Supervisor Password is required."),
		}

	# compare_digest requires equal-length inputs; hash both sides first.
	ok = hmac.compare_digest(
		hashlib.sha256(candidate.encode("utf-8")).digest(),
		hashlib.sha256(stored.encode("utf-8")).digest(),
	)
	return {
		"ok": ok,
		"reason": None if ok else _("Invalid supervisor password."),
	}
