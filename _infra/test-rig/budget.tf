# An alert, not a limit: a budget emails as spending crosses each threshold and
# stops nothing (the stops are the machine's own timer and the daily backstop).
# AWS Budgets charges nothing for a budget that only alerts.
#
# Off unless budget_enabled. It counts only costs that carry the tag
# purpose = test-rig: the machine and its disk. AWS counts a tag in billing only
# once it is activated as a cost allocation tag, which is an account-wide
# setting made by hand (see README.md), and only for costs after that: until
# then the budget reads $0.
#
# The amount and thresholds are set so that an alert means something is wrong.
# An ordinary month is four three-hour runs: $12.58 on g4dn.xlarge, $15.93 on
# g6.xlarge. The first alert, at 80 % of the default $30 ($24), is about twice
# that: a machine left running for most of a day ($17.16 until the daily stop)
# on top of an ordinary month passes it; ordinary use never does.
resource "aws_budgets_budget" "test_rig" {
  count = var.budget_enabled ? 1 : 0

  name         = local.name
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  lifecycle {
    precondition {
      condition     = var.budget_email != null
      error_message = "budget_enabled needs budget_email, in the git-ignored terraform.tfvars."
    }
  }

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:purpose$test-rig"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_email == null ? [] : [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_email == null ? [] : [var.budget_email]
  }

  # Warns before the month ends if spending is on course to pass the budget.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_email == null ? [] : [var.budget_email]
  }
}
