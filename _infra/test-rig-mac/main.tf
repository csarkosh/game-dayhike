terraform {
  required_version = ">= 1.4" # terraform_data

  # Same bucket as _infra/ and _infra/test-rig/, its own prefix, and no
  # reference to either: creating and destroying a day's Macs never reads or
  # writes the Windows machine's state, and nothing here can reach hosting.
  #
  # This state holds each Mac's admin password in clear text (see README.md,
  # "The password"). The bucket is private and keeps old versions; a password
  # stops meaning anything when its Mac is deleted at the end of the day.
  backend "gcs" {
    bucket = "fps-csarko-tfstate"
    prefix = "test-rig-mac"
  }

  required_providers {
    scaleway = {
      source = "scaleway/scaleway"
      # 2.83 exports the server's `password`, `username` and `deletable_at`,
      # which the set-up and the deletion guard below depend on.
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
resource "scaleway_iam_ssh_key" "owner" {
  name       = "${local.name_prefix}-owner"
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
  # any other version takes about an hour.
  os_id = var.macos != "" ? data.scaleway_apple_silicon_os.chosen[0].id : null

  # The hourly plan. Apple's licence makes the first 24 hours the minimum.
  commitment = "duration_24h"

  depends_on = [scaleway_iam_ssh_key.owner]
}

# One per server, holding the two guards against a surprise bill.
#
# On create: asks Scaleway to delete the server by itself at its earliest
# deletion time (`schedule_deletion`, an Apple silicon API field this provider
# does not expose), so a Mac nobody destroys costs one day and not a month.
#
# On destroy: refuses while the server is younger than its earliest deletion
# time. Scaleway documents that a Mac cannot be deleted before then but not how
# the API says no, and this provider treats a 403 answer to a delete as success
# and forgets the server, which would leave a Mac billing with no record of it
# here. Destroying this resource first (it depends on the server) stops the
# whole destroy before the server is touched.
resource "terraform_data" "day_guard" {
  count = var.server_count

  input = {
    server_id    = element(split("/", scaleway_apple_silicon_server.mac[count.index].id), 1)
    zone         = var.zone
    deletable_at = scaleway_apple_silicon_server.mac[count.index].deletable_at
  }

  provisioner "local-exec" {
    # The key goes to curl on its standard input (printf is a shell builtin),
    # never on a command line another process could read.
    command = var.auto_delete_after_24h ? join(" ", [
      "printf 'X-Auth-Token: %s\\n' \"$SCW_SECRET_KEY\" |",
      "curl -fsS -o /dev/null -X PATCH -H @- -H 'Content-Type: application/json'",
      "-d '{\"schedule_deletion\":true}'",
      "\"https://api.scaleway.com/apple-silicon/v1alpha1/zones/$ZONE/servers/$SERVER_ID\"",
      "&& echo \"$SERVER_ID will delete itself at $DELETABLE_AT\"",
    ]) : "echo \"$SERVER_ID: no automatic deletion; only terraform destroy stops its bill\""
    environment = {
      SERVER_ID    = self.input.server_id
      ZONE         = self.input.zone
      DELETABLE_AT = self.input.deletable_at
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      node -e '
        const at = Date.parse(process.env.DELETABLE_AT);
        if (Number.isNaN(at) || Date.now() >= at) process.exit(0);
        console.error(`$${process.env.SERVER_ID} cannot be deleted before $${process.env.DELETABLE_AT} (Apple licence minimum). Destroy stopped; nothing was deleted.`);
        process.exit(1);
      '
    EOT
    environment = {
      SERVER_ID    = self.input.server_id
      DELETABLE_AT = self.input.deletable_at
    }
  }
}

# Off by default: see README.md, "Set-up". Runs setup.sh against each Mac from
# this machine, over SSH, once per server.
resource "terraform_data" "setup" {
  count = var.run_setup_from_terraform ? var.server_count : 0

  triggers_replace = [scaleway_apple_silicon_server.mac[count.index].id]

  provisioner "local-exec" {
    working_dir = path.module
    command     = "./setup.sh --to \"$TARGET\""
    environment = {
      TARGET            = "${scaleway_apple_silicon_server.mac[count.index].username}@${scaleway_apple_silicon_server.mac[count.index].ip}"
      TEST_RIG_PASSWORD = scaleway_apple_silicon_server.mac[count.index].password
      TEST_RIG_VNC_PORT = var.allow_vnc ? local.vnc_ports[count.index] : ""
    }
  }

  depends_on = [terraform_data.day_guard]
}
