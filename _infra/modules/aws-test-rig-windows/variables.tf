# Every input is passed by _infra/test-rig-aws-windows/, whose variables.tf holds the
# defaults, the validations and the full description of each.

variable "region" {
  description = "AWS region the machine runs in. Chosen once: a plan in another region is refused (main.tf, terraform_data.region)."
  type        = string
}

variable "availability_zone" {
  description = "Zone for the subnet and the machine. Null takes the first zone, by name, that offers both allowed sizes."
  type        = string
}

variable "instance_type" {
  description = "g4dn.xlarge or g6.xlarge; the prices in outputs.tf are for these two."
  type        = string
}

variable "image_id" {
  description = "Image to boot instead of the newest public Windows Server 2025 image. Null uses the public one."
  type        = string
}

variable "disk_size_gb" {
  description = "Size of the gp3 boot disk, in GB."
  type        = number
}

variable "running" {
  description = "true runs the machine; false stops it. Creating or replacing a machine is refused while false."
  type        = bool
}

variable "max_run_hours" {
  description = "Hours after each boot at which the machine shuts itself down, in whole minutes."
  type        = number
}

variable "backstop_stop_schedule" {
  description = "EventBridge Scheduler expression, in UTC, for the daily stop. Null turns it off."
  type        = string
}

variable "desktop_user" {
  description = "The Windows account the machine logs on automatically. Written into the start-up script."
  type        = string
}

variable "password_parameter" {
  description = "Parameter Store name the machine writes the desktop user's password to. Written into the start-up script."
  type        = string
}

variable "display_width" {
  description = "Width in pixels of the console session's display. Written into the start-up script."
  type        = number
}

variable "display_height" {
  description = "Height in pixels of the console session's display. Written into the start-up script."
  type        = number
}

variable "vpc_cidr" {
  description = "Private address range of the machine's network and its one subnet."
  type        = string
}

variable "budget_enabled" {
  description = "Create the monthly budget alert (budget.tf)."
  type        = bool
}

variable "budget_email" {
  description = "Address the budget alert emails. Needed only with budget_enabled."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly amount the budget alerts against, in US dollars."
  type        = number
}

variable "tags" {
  description = "The provider's default tags. The machines of this module are found in AWS by their `purpose` tag."
  type        = map(string)
}
