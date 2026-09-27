variable "gcp_project_id" {
  description = "GCP project the machine is rented in."
  type        = string
}

variable "gcp_region" {
  description = "Region of the subnet and the NAT gateway. Must contain var.zone."
  type        = string
  default     = "us-west1"
}

variable "zone" {
  description = <<-EOT
    Zone the machine runs in. us-west1-b offers both machine choices below
    (G2 with L4, and N1 with T4), so switching between them never means moving
    zones. Near us-west1, as of 2026-09-27, G2 is offered in us-west1-a,
    us-west1-b, us-west4-a and us-west4-c; N1 with T4 in us-west1-a,
    us-west1-b, us-west2-b, us-west2-c, us-west3-b, us-west4-a and us-west4-b.
    us-west1-c offers neither. A zone outside var.gcp_region also needs
    gcp_region changed.
  EOT
  type        = string
  default     = "us-west1-b"
}

variable "instance_name" {
  description = "Name of the machine, and the name `gcloud compute ssh` takes."
  type        = string
  default     = "test-rig"
}

variable "machine_type" {
  description = <<-EOT
    g2-standard-4 (default): 4 vCPUs, 16 GB, with one NVIDIA L4 built in
    (Ada Lovelace, 24 GB GDDR6). The alternative is n1-standard-4: 4 vCPUs,
    15 GB, with one NVIDIA T4 attached through gpu_type (Turing, 16 GB GDDR6).
    Google ends T4 support on 2027-08-01, after which a T4 machine cannot be
    created or started. G2 cannot boot from pd-standard; see boot_disk_type.
    Changing it, or gpu_type, replaces the machine and its disk.
  EOT
  type        = string
  default     = "g2-standard-4"
}

variable "gpu_type" {
  description = <<-EOT
    nvidia-l4 with g2-standard-4, nvidia-tesla-t4 with n1-standard-4. The
    -vws variants (nvidia-l4-vws, nvidia-tesla-t4-vws) add an NVIDIA RTX
    Virtual Workstation licence at $0.20 per GPU-hour (list price as of
    2026-09-27); see README.md for when that would be needed.
  EOT
  type        = string
  default     = "nvidia-l4"
}

variable "gpu_count" {
  description = "GPUs attached. g2-standard-4 takes exactly one."
  type        = number
  default     = 1

  validation {
    condition     = var.gpu_count >= 1 && floor(var.gpu_count) == var.gpu_count
    error_message = "gpu_count is a whole number of at least 1."
  }
}

variable "image" {
  description = <<-EOT
    Public Windows Server image family the boot disk starts from. Windows
    Server 2025 Datacenter with the desktop (not the -core family: Chrome
    needs a desktop), the newest family Google publishes, and one the NVIDIA
    driver Google's script installs is built for.
  EOT
  type        = string
  default     = "projects/windows-cloud/global/images/family/windows-2025"
}

variable "baked_image" {
  description = <<-EOT
    Boot from this image instead of var.image: an image made from this
    machine's disk once it has been set up, so a later machine starts ready.
    Empty uses var.image. See README.md for how the image is made.
  EOT
  type        = string
  default     = ""
}

variable "boot_disk_size_gb" {
  description = <<-EOT
    Boot disk size. 50 GB is the floor: the public Windows Server 2025 image
    is 50 GB, and a disk cannot be smaller than its image. It also fits the
    rest with room to spare; README.md has the estimate.
  EOT
  type        = number
  default     = 50

  validation {
    condition     = var.boot_disk_size_gb >= 50
    error_message = "The Windows Server 2025 image needs a boot disk of at least 50 GB."
  }
}

variable "boot_disk_type" {
  description = "pd-balanced: the cheapest disk type G2 machines accept (they take no pd-standard)."
  type        = string
  default     = "pd-balanced"
}

variable "spot" {
  description = <<-EOT
    Rent the machine as Spot: about 40 % less for the machine and GPU
    (the Windows licence is not discounted), but Google can take it back at
    any moment with 30 seconds' notice. It is then stopped, and the run that
    was in progress is started again from the top.
  EOT
  type        = bool
  default     = false
}

variable "running" {
  description = "true runs the machine; false stops it (billing only its disk) without destroying it."
  type        = bool
  default     = true
}

variable "max_run_hours" {
  description = <<-EOT
    The machine stops itself this many hours after each start, so one left
    running costs at most this many hours. 0 turns the limit off.
  EOT
  type        = number
  default     = 4

  validation {
    # Google takes the limit in whole seconds.
    condition     = var.max_run_hours >= 0 && floor(var.max_run_hours * 3600) == var.max_run_hours * 3600
    error_message = "max_run_hours is 0 (no limit) or a positive number of hours that makes whole seconds, such as 0.25 or 4."
  }
}

variable "enable_display" {
  description = "Attach Google's virtual display adapter. Off unless the probe in README.md shows Chrome needs it."
  type        = bool
  default     = false
}

variable "subnet_cidr" {
  description = "Internal address range of the machine's subnet. Private; any unused range works."
  type        = string
  default     = "10.60.0.0/24"
}

variable "direct_access_cidrs" {
  description = <<-EOT
    Addresses allowed to reach SSH and RDP directly, bypassing IAP. Empty
    (the default) allows none. Set it only in the git-ignored
    terraform.tfvars, never in a committed file.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.direct_access_cidrs : !contains(["0.0.0.0/0", "::/0"], c)])
    error_message = "direct_access_cidrs may not open SSH and RDP to the whole internet (0.0.0.0/0 or ::/0)."
  }
}

variable "billing_account_id" {
  description = <<-EOT
    Billing account to create the monthly budget alert under, as
    XXXXXX-XXXXXX-XXXXXX. Empty (the default) creates no budget. Set it only in
    the git-ignored terraform.tfvars.
  EOT
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly amount the budget alerts against, in whole US dollars."
  type        = number
  default     = 30
}
