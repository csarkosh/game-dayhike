# Every input is passed by _infra/test-rig-gcp/, whose variables.tf holds the
# defaults, the validations and the full description of each.

variable "gcp_project_id" {
  description = "GCP project the machine is rented in."
  type        = string
}

variable "gcp_region" {
  description = "Region of the subnet, the NAT gateway and the daily stop. Must contain var.zone."
  type        = string
}

variable "zone" {
  description = "Zone the machine runs in. A change replaces the machine and its disk."
  type        = string
}

variable "instance_name" {
  description = "Name of the machine and its Windows computer name. A change replaces the machine."
  type        = string
}

variable "machine_type" {
  description = "g2-standard-4 or n1-standard-4; the prices in outputs.tf are for these two."
  type        = string
}

variable "gpu_type" {
  description = "nvidia-l4-vws or nvidia-l4 with g2-standard-4, nvidia-tesla-t4-vws or nvidia-tesla-t4 with n1-standard-4. A change replaces the machine."
  type        = string
}

variable "image" {
  description = "Public Windows Server image family the boot disk starts from."
  type        = string
}

variable "baked_image" {
  description = "Image to boot from instead of var.image. Empty uses var.image."
  type        = string
}

variable "boot_disk_size_gb" {
  description = "Boot disk size, in GB. A change replaces the machine and its disk."
  type        = number
}

variable "boot_disk_type" {
  description = "Boot disk type. A change replaces the machine and its disk."
  type        = string
}

variable "spot" {
  description = "Rent the machine as Spot. A change replaces the machine and its disk."
  type        = bool
}

variable "running" {
  description = "true runs the machine; false stops it. Creating or replacing a machine is refused while false."
  type        = bool
}

variable "max_run_hours" {
  description = "Hours after each start at which Compute Engine stops the machine, in whole minutes. A change replaces the machine."
  type        = number
}

variable "backstop_stop_schedule" {
  description = "Five-field cron expression, in UTC, for the daily stop. Null turns it off."
  type        = string
}

variable "desktop_user" {
  description = "The Windows account the machine logs on automatically. Written into the start-up script."
  type        = string
}

variable "enable_display" {
  description = "Attach Google's virtual display adapter beside the GPU."
  type        = bool
}

variable "subnet_cidr" {
  description = "Internal address range of the machine's subnet."
  type        = string
}

variable "direct_access_cidrs" {
  description = "Addresses allowed to reach SSH and RDP directly, bypassing IAP. Empty allows none."
  type        = list(string)
}

variable "billing_account_id" {
  description = "Billing account to create the monthly budget alert under. Empty creates no budget."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly amount the budget alerts against, in whole US dollars."
  type        = number
}

variable "labels" {
  description = "The provider's default labels. Set on the machine and its disk as well, and the budget counts what carries them."
  type        = map(string)
}
