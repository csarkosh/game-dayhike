# Every input is passed by _infra/test-rig-scaleway-mac/, whose variables.tf holds the
# defaults, the validations and the full description of each, and the
# `acknowledge_incomplete` guard, which this module does not need.

variable "zone" {
  description = "Scaleway zone the Macs are rented in."
  type        = string
}

variable "server_type" {
  description = "Scaleway's commercial type, such as M4-S."
  type        = string
}

variable "server_count" {
  description = "How many Macs to rent for the day. Named test-rig-01, test-rig-02, ..."
  type        = number
}

variable "macos" {
  description = "Scaleway OS name. Empty takes Scaleway's default macOS for the server type."
  type        = string
}

variable "ssh_public_key" {
  description = "The public key to log in with (the contents of an id_*.pub file)."
  type        = string
}

variable "auto_delete_after_24h" {
  description = "Ask Scaleway to delete each Mac by itself at its earliest deletion time."
  type        = bool
}

variable "run_setup_from_terraform" {
  description = "Run setup.sh against each Mac as part of apply."
  type        = bool
}

variable "allow_vnc" {
  description = "Leave Screen Sharing reachable from the internet after set-up."
  type        = bool
}
