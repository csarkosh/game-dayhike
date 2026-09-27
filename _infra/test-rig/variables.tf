variable "region" {
  description = <<-EOT
    AWS region the machine runs in. us-east-1 and us-west-2 both offer both
    machine sizes, at the same prices, and are where this account's quota for
    on-demand G instances is set (it is per region).
  EOT
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = <<-EOT
    Zone for the subnet and the machine. Null (the default) takes the first
    zone, in name order, that offers every size in instance_type's list, so a
    switch of size never moves the machine. Changing it replaces the subnet and
    the machine.
  EOT
  type        = string
  default     = null
}

variable "instance_type" {
  description = <<-EOT
    g4dn.xlarge (default): 4 vCPUs, 16 GiB, one NVIDIA T4 (Turing, 16 GB).
    g6.xlarge: 4 vCPUs, 16 GiB, one NVIDIA L4 (Ada Lovelace, 24 GB). Both are
    on-demand only. Changing it stops and starts the machine; the disk is kept.
  EOT
  type        = string
  default     = "g4dn.xlarge"

  validation {
    condition     = contains(["g4dn.xlarge", "g6.xlarge"], var.instance_type)
    error_message = "instance_type is g4dn.xlarge or g6.xlarge, the two sizes this module's prices and zones were checked for."
  }
}

variable "image_id" {
  description = <<-EOT
    Boot from this image instead of the newest public Windows Server 2025
    image: an image made from this machine once it has been set up (see
    README.md). Null (the default) uses the public image. The machine ignores a
    change here until it is replaced with
    `terraform apply -replace=aws_instance.test_rig`.
  EOT
  type        = string
  default     = null
}

variable "disk_size_gb" {
  description = <<-EOT
    Size of the gp3 boot disk. The public Windows Server 2025 image is 30 GB;
    50 leaves room for the NVIDIA driver (0.75 GB download, about 2 GB
    installed), Chrome and its test profiles, Amazon DCV, Node, Git, the
    repository with its LFS objects, and Windows' page file and updates. README.md
    has the estimate.
  EOT
  type        = number
  default     = 50

  validation {
    condition     = var.disk_size_gb >= 30 && floor(var.disk_size_gb) == var.disk_size_gb
    error_message = "disk_size_gb is a whole number of at least 30, the size of the Windows Server 2025 image."
  }
}

variable "running" {
  description = "true runs the machine; false stops it (billing only its disk) without destroying it."
  type        = bool
  default     = true
}

variable "max_run_hours" {
  description = <<-EOT
    The machine shuts itself down (and so stops) this many hours after each
    boot, so one left running costs at most this many hours. Whole minutes,
    from 0.25 to 24.
  EOT
  type        = number
  default     = 4

  validation {
    condition     = var.max_run_hours >= 0.25 && var.max_run_hours <= 24 && floor(var.max_run_hours * 60) == var.max_run_hours * 60
    error_message = "max_run_hours is between 0.25 and 24 and makes whole minutes, such as 0.5 or 4."
  }
}

variable "backstop_stop_schedule" {
  description = <<-EOT
    When the daily backstop stops the machine if it is still running, as an
    EventBridge Scheduler expression in UTC. The default, 09:00 UTC, is 02:00
    or 01:00 on the US west coast. null (in terraform.tfvars; `-var` cannot
    pass a null) turns the backstop off.
  EOT
  type        = string
  default     = "cron(0 9 * * ? *)"

  validation {
    condition     = var.backstop_stop_schedule == null || can(regex("^(cron|rate)\\(.+\\)$", var.backstop_stop_schedule))
    error_message = "backstop_stop_schedule is null or an EventBridge Scheduler cron(...) or rate(...) expression."
  }
}

variable "desktop_user" {
  description = <<-EOT
    The local, non-administrator Windows account the machine logs on
    automatically at every boot, whose desktop Chrome runs in and which owns
    Amazon DCV's console session. Its password is made on the machine.
  EOT
  type        = string
  default     = "hiker"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.desktop_user)) && !contains(["administrator", "guest", "ssm-user"], var.desktop_user)
    error_message = "desktop_user is 3 to 20 lowercase letters, digits or hyphens, starting with a letter, and not a built-in account."
  }
}

variable "password_parameter" {
  description = <<-EOT
    Parameter Store name the machine writes the desktop user's password to, as
    a SecureString. Not managed by Terraform, so the password never enters
    state; `terraform destroy` leaves it (README.md says how to delete it).
  EOT
  type        = string
  default     = "/test-rig/desktop-password"

  validation {
    condition     = can(regex("^(/[A-Za-z0-9_.-]+)+$", var.password_parameter))
    error_message = "password_parameter is a path such as /test-rig/desktop-password."
  }
}

variable "display_width" {
  description = "Width in pixels of the display DCV gives the console session at start (DCV's console-session-default-layout)."
  type        = number
  default     = 1920

  validation {
    condition     = var.display_width >= 800 && var.display_width <= 4096 && floor(var.display_width) == var.display_width
    error_message = "display_width is a whole number from 800 to 4096, DCV's largest display head."
  }
}

variable "display_height" {
  description = "Height in pixels of the display DCV gives the console session at start."
  type        = number
  default     = 1080

  validation {
    condition     = var.display_height >= 600 && var.display_height <= 2160 && floor(var.display_height) == var.display_height
    error_message = "display_height is a whole number from 600 to 2160."
  }
}

variable "vpc_cidr" {
  description = "Private address range of the machine's network (and its one subnet). Any unused range works."
  type        = string
  default     = "10.70.0.0/24"
}

variable "budget_enabled" {
  description = "Create the monthly budget alert (budget.tf)."
  type        = bool
  default     = false
}

variable "budget_email" {
  description = <<-EOT
    Address the budget alert emails. No default: set it in the git-ignored
    terraform.tfvars, never in a committed file. Read only when budget_enabled.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email))
    error_message = "budget_email is an email address."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly amount the budget alerts against, in US dollars."
  type        = number
  default     = 25
}
