variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the Cloud Run service; the signaling service's, so the two share an image repository."
  type        = string
}

variable "image" {
  description = "Container image to create the service with. The deploy script owns it afterwards."
  type        = string
}

variable "admin_emails" {
  description = "The accounts that may read the admin page's routes (`ADMIN_EMAILS`). Empty serves no admin routes."
  type        = list(string)
  default     = []
}

variable "admin_auth_project" {
  description = <<-EOT
    The Firebase project whose Auth signs the admin page's accounts in, and so
    the issuer the admin routes trust an ID token from (`ADMIN_AUTH_PROJECT`).
    It is another project than this one on purpose: the page lives on the
    shared admin host, admin.csarko.sh, which is the csarko.sh repository's
    and signs every app's visitor in once, on its own project; a token this
    project issued would be refused. Which accounts get in is still this
    module's `admin_emails`.
  EOT
  type        = string
  default     = "csarko-sh"
}

variable "registry" {
  description = "Where the signaling rooms live, for the admin page's live view: `firestore` or `memory` (then the view is empty)."
  type        = string
  default     = "firestore"
}

variable "max_instances" {
  description = "The most instances the service scales to: the ceiling on what a flood can bill."
  type        = number
  default     = 5
}

variable "retention_days" {
  description = "How long the telemetry bucket keeps a row. Past 30 days the charge is a cent a GiB-month."
  type        = number
  default     = 400
}

variable "billing_account_id" {
  description = "Billing account to create the monthly budget alert under. Empty creates no budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly amount the budget alerts against, in whole US dollars."
  type        = number
  default     = 10
}
