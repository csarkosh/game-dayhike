variable "gcp_project_id" {
  description = "GCP project the machine is rented in."
  type        = string
  default     = "fps-csarko"
}

variable "gcp_region" {
  description = "Region of the subnet, the NAT gateway and the daily stop. Must contain var.zone."
  type        = string
  default     = "us-west1"
}

variable "zone" {
  description = <<-EOT
    Zone the machine runs in. us-west1-b offers all four GPU choices below
    (nvidia-l4-vws, nvidia-l4, nvidia-tesla-t4-vws, nvidia-tesla-t4), so
    switching between them never means moving zones. In us-west1, as of
    2026-09-27, us-west1-a offers the same four and us-west1-c the two L4s
    only. A zone outside var.gcp_region also needs gcp_region changed; a
    change of zone replaces the machine.
  EOT
  type        = string
  default     = "us-west1-b"
}

variable "instance_name" {
  description = <<-EOT
    Name of the machine, the name `gcloud compute ssh` takes, and its Windows
    computer name. At most 15 characters: Windows keeps only the first 15 of a
    computer name. Changing it replaces the machine.
  EOT
  type        = string
  default     = "test-rig"

  validation {
    condition     = can(regex("^[a-z]([-a-z0-9]{0,13}[a-z0-9])?$", var.instance_name))
    error_message = "instance_name is 1 to 15 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen."
  }
}

variable "machine_type" {
  description = <<-EOT
    g2-standard-4 (default): 4 vCPUs, 16 GB, with one NVIDIA L4 built in
    (Ada Lovelace, 24 GB GDDR6). The alternative is n1-standard-4: 4 vCPUs,
    15 GB, with one NVIDIA T4 attached through gpu_type (Turing, 16 GB GDDR6).
    Google ends T4 support on 2027-08-01, after which a T4 machine cannot be
    created or started. G2 cannot boot from pd-standard; see boot_disk_type.
    Switching between the two also switches gpu_type, which replaces the
    machine and its disk.
  EOT
  type        = string
  default     = "g2-standard-4"

  validation {
    condition     = contains(["g2-standard-4", "n1-standard-4"], var.machine_type)
    error_message = "machine_type is g2-standard-4 or n1-standard-4, the two sizes this module's prices and zones were checked for."
  }
}

variable "gpu_type" {
  description = <<-EOT
    nvidia-l4-vws (default) with g2-standard-4: the L4 with an NVIDIA RTX
    Virtual Workstation licence, which Google bills with the machine at $0.20
    per GPU-hour (list price as of 2026-09-27). Google documents that without
    that licence the driver gives desktop applications, a browser among them,
    no GPU acceleration. nvidia-l4 (no licence) stays selectable for a control
    run. With n1-standard-4: nvidia-tesla-t4-vws or nvidia-tesla-t4. Each
    -vws type has its own quota (NVIDIA_L4_VWS_GPUS, NVIDIA_T4_VWS_GPUS).
    Changing it replaces the machine and its disk.
  EOT
  type        = string
  default     = "nvidia-l4-vws"

  validation {
    condition     = contains(["nvidia-l4-vws", "nvidia-l4", "nvidia-tesla-t4-vws", "nvidia-tesla-t4"], var.gpu_type)
    error_message = "gpu_type is nvidia-l4-vws, nvidia-l4, nvidia-tesla-t4-vws or nvidia-tesla-t4."
  }
}

variable "image" {
  description = <<-EOT
    Public Windows Server image family the boot disk starts from. Windows
    Server 2025 Datacenter with the desktop (not the -core family: Chrome
    needs a desktop), the newest family Google publishes, and one the NVIDIA
    driver below is built for. The machine keeps the image it was made from:
    a newer image in the family, or a change here, takes effect only when the
    machine is replaced (`terraform apply -replace=google_compute_instance.test_rig`).
  EOT
  type        = string
  default     = "projects/windows-cloud/global/images/family/windows-2025"
}

variable "baked_image" {
  description = <<-EOT
    Boot from this image instead of var.image: an image made from this
    machine's disk once it has been set up, so a later machine starts ready.
    Empty uses var.image. Like var.image, it takes effect when the machine is
    replaced. See README.md for how the image is made.
  EOT
  type        = string
  default     = ""
}

variable "boot_disk_size_gb" {
  description = <<-EOT
    Boot disk size. 50 GB is the floor: the public Windows Server 2025 image
    is 50 GB, and a disk cannot be smaller than its image. It also fits the
    rest with room to spare; README.md has the estimate. Changing it replaces
    the machine and its disk.
  EOT
  type        = number
  default     = 50

  validation {
    condition     = var.boot_disk_size_gb >= 50 && floor(var.boot_disk_size_gb) == var.boot_disk_size_gb
    error_message = "boot_disk_size_gb is a whole number of at least 50, the size of the Windows Server 2025 image."
  }
}

variable "boot_disk_type" {
  description = "pd-balanced: the cheapest disk type G2 machines accept (they take no pd-standard). Changing it replaces the machine and its disk."
  type        = string
  default     = "pd-balanced"
}

variable "spot" {
  description = <<-EOT
    Rent the machine as Spot: about 40 % less for the machine and GPU (the
    Windows and workstation licences are not discounted), but Google can take
    it back at any moment with 30 seconds' notice. It is then stopped, and the
    run that was in progress is started again from the top. Changing it
    replaces the machine and its disk.
  EOT
  type        = bool
  default     = false
}

variable "running" {
  description = <<-EOT
    true runs the machine; false stops it (billing only its disk) without
    destroying it. An apply that would create or replace the machine is
    refused while this is false: a new machine must never be stopped before
    its first-boot set-up has finished.
  EOT
  type        = bool
  default     = true
}

variable "max_run_hours" {
  description = <<-EOT
    Compute Engine stops the machine this many hours after each start, so one
    left running costs at most this many hours. Whole minutes, from 1 to 24:
    at least an hour because the limit also runs during a new machine's
    first-boot set-up (about 40 minutes), which must never be stopped. The
    clock starts again at every start, not at a restart from inside Windows.
    Changing it replaces the machine and its disk (the provider cannot change
    a machine's run limit in place), which is refused while running is false.
  EOT
  type        = number
  default     = 4

  validation {
    condition     = var.max_run_hours >= 1 && var.max_run_hours <= 24 && floor(var.max_run_hours * 60) == var.max_run_hours * 60
    error_message = "max_run_hours is between 1 and 24 and makes whole minutes, such as 1.5 or 4."
  }
}

variable "backstop_stop_schedule" {
  description = <<-EOT
    When the daily backstop stops the machine if it is still running, as a
    cron expression in UTC for a Compute Engine instance schedule. The
    default, 09:00 UTC, is 02:00 or 01:00 on the US west coast. Google starts
    a scheduled stop up to 15 minutes late. null (in terraform.tfvars; `-var`
    cannot pass a null) turns the backstop off.
  EOT
  type        = string
  default     = "0 9 * * *"

  validation {
    condition     = var.backstop_stop_schedule == null || can(regex("^\\S+( \\S+){4}$", var.backstop_stop_schedule))
    error_message = "backstop_stop_schedule is null or a five-field cron expression such as \"0 9 * * *\"."
  }
}

variable "desktop_user" {
  description = <<-EOT
    The local, non-administrator Windows account the machine logs on
    automatically at every boot, whose desktop Chrome runs in. Its password
    is made on the machine. It is written into the start-up script, which a
    change updates in place; the new account is made at the next boot.
  EOT
  type        = string
  default     = "hiker"

  validation {
    # Windows: a local user name is at most 20 characters. The built-in and
    # Google-made accounts are refused.
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.desktop_user)) && !contains(["administrator", "guest", "defaultaccount", "wdagutilityaccount"], var.desktop_user)
    error_message = "desktop_user is 3 to 20 lowercase letters, digits or hyphens, starting with a letter, and not a built-in account."
  }
}

variable "enable_display" {
  description = <<-EOT
    Attach Google's virtual display adapter beside the GPU. Off: Google offers
    it for machines that "don't need the performance of a GPU", and a second
    adapter is one more thing Chrome could pick. The first run's probe reports
    the display adapters Windows sees.
  EOT
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
  description = <<-EOT
    Monthly amount the budget alerts against, in whole US dollars. At the
    default, $45, the first alert (80 %, $36) is about twice an ordinary month
    of four three-hour runs ($18.26): reaching it means a machine left running
    for most of a day, or twice the usual use.
  EOT
  type        = number
  default     = 45

  validation {
    condition     = var.monthly_budget_usd >= 1 && floor(var.monthly_budget_usd) == var.monthly_budget_usd
    error_message = "monthly_budget_usd is a whole number of US dollars, at least 1."
  }
}
