# STATUS: INCOMPLETE. This module has never been applied. Do not apply it as
# it is. _infra/test-rig-scaleway-mac/README.md's first section says where it stands,
# the known gaps to close before a first apply, what only a real machine can
# settle, and how to pick it up. The root that calls it, _infra/test-rig-scaleway-mac/,
# refuses `plan` and `apply` until `acknowledge_incomplete` is set (its
# variables.tf).
#
# The Macs rented by the day from Scaleway: the login key, the servers, the
# two guards against a surprise bill and the optional set-up. Called by one
# root only, _infra/test-rig-scaleway-mac/, which holds the backend, the provider and
# the state; see its main.tf for why that root is not _infra/. The scripts
# the resources run (setup.sh, scaleway-macs.sh) are in this directory, found
# through path.module.

terraform {
  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
    }
  }
}

locals {
  # Neither resource here takes tags; the name prefix is what identifies the
  # machines in the console and on the invoice.
  name_prefix = "test-rig"

  # Each Mac's Screen Sharing port, which Scaleway picks at random. Taken out
  # of `vnc_url` because that URL also carries the password in clear.
  vnc_ports = [
    for s in scaleway_apple_silicon_server.mac : try(regex(":([0-9]+)/?$", s.vnc_url)[0], "")
  ]
}

# Scaleway installs a project's SSH keys on a Mac at delivery (and its
# scw-agent keeps them current), so the key is registered at project level,
# not per server. It must exist before the servers are created.
resource "scaleway_iam_ssh_key" "login" {
  name       = "${local.name_prefix}-login"
  public_key = var.ssh_public_key
}

data "scaleway_apple_silicon_os" "chosen" {
  count = var.macos != "" ? 1 : 0
  name  = var.macos
}

resource "scaleway_apple_silicon_server" "mac" {
  count = var.server_count

  name = format("%s-%02d", local.name_prefix, count.index + 1)
  type = var.server_type
  zone = var.zone

  # Unset takes Scaleway's default macOS for the type, delivered in minutes;
  # any other version takes about an hour. Read at creation only: changing it
  # later does nothing to a Mac that exists.
  os_id = var.macos != "" ? data.scaleway_apple_silicon_os.chosen[0].id : null

  # The hourly plan. Apple's licence makes the first 24 hours the minimum.
  commitment = "duration_24h"

  # The provider records the server as soon as Scaleway accepts the order,
  # then waits for delivery: 20 minutes by default, while a non-default macOS
  # takes about an hour. A create that times out leaves the Mac billing,
  # recorded as tainted, and with neither guard below.
  timeouts {
    create = "120m"
  }

  depends_on = [scaleway_iam_ssh_key.login]
}

# The two guards against a surprise bill are separate resources, and each is
# replaced whenever its server is (`triggers_replace` on the server id), so a
# re-created Mac (a new day, a changed type or zone, `-replace`) always gets
# fresh ones.

# Refuses `terraform destroy` (or any replacement of the server) until the
# Mac's earliest deletion time plus 10 minutes, taken as the later of Scaleway's
# `deletable_at` and creation + 24 hours, and refuses if either time cannot be
# read. Scaleway documents that a Mac cannot be deleted earlier but not how the
# API says no, and this provider treats a 403 answer to a delete as success and
# forgets the server, which would leave a Mac billing with no record of it here.
# This resource depends on the server, so it is destroyed first and stops the
# whole run before the server is touched. It has no create-time step, so it can
# never be tainted, and a tainted resource's destroy-time step would not run.
resource "terraform_data" "delete_guard" {
  count = var.server_count

  triggers_replace = [scaleway_apple_silicon_server.mac[count.index].id]

  input = {
    server_id    = scaleway_apple_silicon_server.mac[count.index].id
    created_at   = scaleway_apple_silicon_server.mac[count.index].created_at
    deletable_at = scaleway_apple_silicon_server.mac[count.index].deletable_at
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      node -e '
        const { SERVER_ID: id, CREATED_AT: c, DELETABLE_AT: d } = process.env;
        const earliest = Math.max(Date.parse(d), Date.parse(c) + 24 * 3600e3) + 10 * 60e3;
        if (Number.isNaN(earliest)) {
          console.error(`$${id}: cannot read its creation (\"$${c}\") or earliest deletion (\"$${d}\") time. Destroy stopped; nothing was deleted.`);
          process.exit(1);
        }
        if (Date.now() < earliest) {
          console.error(`$${id} may not be deleted before $${new Date(earliest).toISOString()} (24 hours after creation, the Apple licence minimum, plus 10 minutes). Destroy stopped; nothing was deleted.`);
          process.exit(1);
        }
      '
    EOT
    environment = {
      SERVER_ID    = self.input.server_id
      CREATED_AT   = self.input.created_at
      DELETABLE_AT = self.input.deletable_at
    }
  }
}

# Asks Scaleway to delete the Mac by itself at its earliest deletion time
# (`schedule_deletion`, an API field this provider does not expose), reads it
# back and confirms, so a Mac nobody destroys costs one day, not EUR 160 a
# month. scaleway-macs.sh refuses, scheduling nothing, if the earliest
# deletion time is less than 23.5 hours after creation: a scheduled deletion
# would then fire right after delivery. A refusal or a failed call fails the
# apply and taints only this resource; the next apply retries it, and
# delete_guard is untouched either way.
#
# Turning auto_delete_after_24h off removes these resources but cannot
# unschedule a deletion already sent; turning it on schedules the Macs that
# exist.
resource "terraform_data" "auto_delete" {
  count = var.auto_delete_after_24h ? var.server_count : 0

  triggers_replace = [scaleway_apple_silicon_server.mac[count.index].id]

  provisioner "local-exec" {
    working_dir = path.module
    command     = "./scaleway-macs.sh schedule \"$ZONE\" \"$SERVER_ID\""
    environment = {
      ZONE      = var.zone
      SERVER_ID = element(split("/", scaleway_apple_silicon_server.mac[count.index].id), 1)
    }
  }
}

# Off by default: see _infra/test-rig-scaleway-mac/README.md, "Set-up". Runs setup.sh
# against each Mac from this machine, over SSH, once per server. Terraform
# hides the whole output of a provisioner whose environment holds a sensitive
# value, as this one's does.
resource "terraform_data" "setup" {
  count = var.run_setup_from_terraform ? var.server_count : 0

  triggers_replace = [scaleway_apple_silicon_server.mac[count.index].id]

  provisioner "local-exec" {
    working_dir = path.module
    command     = "./setup.sh --to \"$TARGET\""
    environment = {
      TARGET             = "${scaleway_apple_silicon_server.mac[count.index].username}@${scaleway_apple_silicon_server.mac[count.index].ip}"
      TEST_RIG_PASSWORD  = scaleway_apple_silicon_server.mac[count.index].password
      TEST_RIG_VNC_PORT  = local.vnc_ports[count.index]
      TEST_RIG_ALLOW_VNC = var.allow_vnc ? "1" : "0"
    }
  }

  depends_on = [terraform_data.delete_guard, terraform_data.auto_delete]
}
