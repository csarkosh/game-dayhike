# An alert, not a limit: a budget emails the billing account's administrators
# as spending crosses each threshold and stops nothing. The stop is
# max_run_hours on the machine itself.
#
# Off unless billing_account_id is set. A budget belongs to the billing
# account, not the project, so it needs that account's id (kept out of
# committed files, in the git-ignored terraform.tfvars) and the Billing Account
# Administrator or Costs Manager role on it, and the Cloud Billing Budget API
# enabled in the project, which the resource below does.

resource "google_project_service" "billingbudgets" {
  count = var.billing_account_id != "" ? 1 : 0

  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "this" {
  count = var.billing_account_id != "" ? 1 : 0
}

resource "google_billing_budget" "test_rig" {
  count    = var.billing_account_id != "" ? 1 : 0
  provider = google.billing

  billing_account = var.billing_account_id
  display_name    = "test-rig"

  budget_filter {
    projects = ["projects/${data.google_project.this[0].number}"]

    # Only what carries the machine's label: the machine, its GPU and Windows
    # licence, and its disk. The NAT gateway takes no labels, which leaves a
    # few cents a month outside the count.
    labels = local.labels

    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  # Warns before the month ends if spending is on course to pass the budget.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.billingbudgets]
}
