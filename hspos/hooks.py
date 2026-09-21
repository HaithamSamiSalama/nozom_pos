app_name = "hspos"
app_title = "NOZOM POS"
app_publisher = "Haitham Salama"
app_description = "Haitham POS for ERPNEXT"
app_email = "admin@milenyum.ae"
app_license = "mit"


# POS Assets
app_include_js = []

app_include_css = [
    "hspos.bundle.css",
]

page_js = {
    "point-of-sale": "public/js/point_of_sale.js"
}

override_doctype_class = {
    "Sales Invoice": "hspos.overrides.sales_invoice.SalesInvoice",
    "POS Invoice": "hspos.overrides.sales_invoice.POSInvoice",
}


# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "hspos",
# 		"logo": "/assets/hspos/logo.png",
# 		"title": "Hspos",
# 		"route": "/hspos",
# 		"has_permission": "hspos.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/hspos/css/hspos.css"
# app_include_js = "/assets/hspos/js/hspos.js"

# include js, css files in header of web template
# web_include_css = "/assets/hspos/css/hspos.css"
# web_include_js = "/assets/hspos/js/hspos.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "hspos/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "hspos/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "hspos.utils.jinja_methods",
# 	"filters": "hspos.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "hspos.install.before_install"
# after_install = "hspos.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "hspos.uninstall.before_uninstall"
# after_uninstall = "hspos.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "hspos.utils.before_app_install"
# after_app_install = "hspos.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "hspos.utils.before_app_uninstall"
# after_app_uninstall = "hspos.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "hspos.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "hspos.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"hspos.tasks.all"
# 	],
# 	"daily": [
# 		"hspos.tasks.daily"
# 	],
# 	"hourly": [
# 		"hspos.tasks.hourly"
# 	],
# 	"weekly": [
# 		"hspos.tasks.weekly"
# 	],
# 	"monthly": [
# 		"hspos.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "hspos.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "hspos.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "hspos.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "hspos.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["hspos.utils.before_request"]
# after_request = ["hspos.utils.after_request"]

# Job Events
# ----------
# before_job = ["hspos.utils.before_job"]
# after_job = ["hspos.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"hspos.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


# ---------------------------------------------------------
# NOZOM POS Desktop / Apps entry
# ---------------------------------------------------------

# NOZOM POS desktop application
add_to_apps_screen = [
    {
        "name": "hspos",
        "logo": "/assets/hspos/images/nozom-pos.svg",
        "title": "NOZOM POS",
        "route": "/desk/point-of-sale"
    }
]
