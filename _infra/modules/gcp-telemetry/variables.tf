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
