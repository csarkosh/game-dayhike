# STATUS: INCOMPLETE. This module has never been applied. Do not apply it as
# it is. README.md's first section says where it stands, the known gaps to
# close before a first apply, what only a real machine can settle, and how to
# pick it up. `plan` and `apply` refuse to run until `acknowledge_incomplete`
# is set (variables.tf).
#
# This directory is the Macs' root: the backend, the provider and one call of
# ../modules/scaleway-test-rig-mac/, where the resources and the scripts they
# run are, as _infra/ calls its own modules. It is what a person runs. It has
# its own state (prefix `test-rig-mac`), one provider (Scaleway's), and no
# reference to `_infra/`, `_infra/test-rig-aws-windows/` or `_infra/test-rig-gcp-windows/`.
#
# It is NOT called from _infra/main.tf, and must not be: this state holds each
# Mac's admin password in clear text, which hosting's state must never hold,
# and creating or deleting a day's Macs must never plan against hosting, DNS,
# the signaling service or either Windows machine.

terraform {
  required_version = ">= 1.4" # terraform_data

  # Same bucket as _infra/, _infra/test-rig-aws-windows/ and _infra/test-rig-gcp-windows/, its
  # own prefix, and no reference to any of them: creating and destroying a
  # day's Macs never reads or writes a Windows machine's state, and nothing
  # here can reach hosting.
  #
  # This state holds each Mac's admin password in clear text (see README.md,
  # "The password"). The bucket is private and keeps old versions; a password
  # stops meaning anything when its Mac is deleted at the end of the day.
  backend "gcs" {
    bucket = "fps-csarko-tfstate"
    # The prefix is the state's address, not the directory's name: it keeps
    # the name it was first given, since changing it would leave the state
    # behind.
    prefix = "test-rig-mac"
  }

  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
      # 2.83 exports the server's `password`, `username` and `deletable_at`,
      # which the set-up and the module's deletion guard depend on.
      version = "~> 2.83"
    }
  }
}

# Credentials and project come from the environment only (SCW_ACCESS_KEY,
# SCW_SECRET_KEY, SCW_DEFAULT_PROJECT_ID, SCW_DEFAULT_ORGANIZATION_ID), never
# from a file in the repository.
provider "scaleway" {
  zone   = var.zone
  region = var.region
}

module "test_rig" {
  source = "../modules/scaleway-test-rig-mac"

  zone                     = var.zone
  server_type              = var.server_type
  server_count             = var.server_count
  macos                    = var.macos
  ssh_public_key           = var.ssh_public_key
  auto_delete_after_24h    = var.auto_delete_after_24h
  run_setup_from_terraform = var.run_setup_from_terraform
  allow_vnc                = var.allow_vnc

  providers = {
    scaleway = scaleway
  }
}
