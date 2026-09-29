# STATUS: INCOMPLETE (README.md's first section). The variable below is the
# guard against applying this module by accident; take it out with the README's
# status block once a day has been run and the known gaps are closed.
variable "acknowledge_incomplete" {
  description = "Must be true for plan or apply to run. This module has never been applied and has known gaps: read README.md's first section before setting it."
  type        = bool
  default     = false

  validation {
    condition     = var.acknowledge_incomplete
    error_message = "This module is incomplete and has never been applied. Read the first section of _infra/test-rig-mac/README.md (the known gaps and how to pick it up), then pass -var acknowledge_incomplete=true."
  }
}

variable "zone" {
  description = "Scaleway zone. fr-par-1 is the only one offering the M4 types (fr-par-3 has M1 and M4 Pro - L)."
  type        = string
  default     = "fr-par-1"
}

variable "region" {
  description = "Region containing var.zone."
  type        = string
  default     = "fr-par"
}

variable "server_type" {
  description = <<-EOT
    Scaleway's commercial type. M4-S: Mac mini M4, 10 CPU cores, 10-core GPU,
    16 GB, 256 GB SSD, EUR 0.22 an hour excl. VAT (public catalogue,
    2026-09-27).
  EOT
  type        = string
  default     = "M4-S"
}

variable "server_count" {
  description = <<-EOT
    How many Macs to rent for the day, to measure in parallel. Named
    test-rig-01, test-rig-02, ... Scaleway allows 2 M4-S per zone to a
    verified organization; more needs a quota increase from Scaleway support
    first, then this limit raised to match.
  EOT
  type        = number
  default     = 1

  validation {
    # A count over the quota would bill the Macs Scaleway accepts and then
    # fail on the next one.
    condition     = var.server_count >= 0 && var.server_count <= 2
    error_message = "At most 2 Macs: Scaleway's M4-S quota is 2 per zone. Ask Scaleway support to raise it (console, Support, new ticket), then raise this limit."
  }
}

variable "macos" {
  description = <<-EOT
    Scaleway OS name, such as macos-tahoe-26.0. Empty (the default) takes
    Scaleway's default macOS for the server type, delivered in minutes; any
    other version takes about an hour. `scw apple-silicon os list` lists the
    names.
  EOT
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = <<-EOT
    The public key to log in with (the contents of an id_*.pub file). No
    default: it identifies a person, so it is set in the git-ignored
    terraform.tfvars, not in a committed file.
  EOT
  type        = string
}

variable "auto_delete_after_24h" {
  description = <<-EOT
    Ask Scaleway to delete each Mac by itself at its earliest deletion time,
    24 hours after creation. On by default so that a forgotten Mac costs one
    day (EUR 5.28), not a month (about EUR 160). Turning it off cannot
    unschedule a deletion already requested.
  EOT
  type        = bool
  default     = true
}

variable "run_setup_from_terraform" {
  description = "Run setup.sh against each Mac as part of apply. Off by default; see README.md."
  type        = bool
  default     = false
}

variable "allow_vnc" {
  description = "Leave Screen Sharing reachable from the internet after set-up. Off: only SSH is reachable."
  type        = bool
  default     = false
}
