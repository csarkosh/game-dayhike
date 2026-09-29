# The rented Windows machine with an NVIDIA GPU on Google Cloud. This
# directory is its root: the backend, the providers and one call of
# ../modules/gcp-test-rig/, where the resources are, as _infra/ calls its own
# modules. It is what a person runs (`terraform apply -var running=false` and
# the rest, README.md). A resource's address carries the call's name, as in
# module.test_rig.google_compute_instance.test_rig; moved.tf maps the
# addresses the resources had before they moved into the module.
#
# It is NOT called from _infra/main.tf, and must not be: the machine keeps a
# state of its own, so that hosting's state holds nothing of it, starting,
# stopping or replacing it never plans against hosting, DNS or the signaling
# service, and a `terraform destroy` here can only reach the module's
# resources. (Its Windows passwords are kept out of this state too: they are
# made on the machine and read with gcloud.)

terraform {
  # 1.7 for the mock providers in tests/.
  required_version = ">= 1.7"

  # Remote state for the same reason as _infra/main.tf (state kept on disk in a
  # worktree dies with the worktree), in the same versioned bucket, under its
  # own prefix. Nothing here reads _infra's state and nothing in _infra reads
  # this one: the two root modules share a bucket and a project and nothing
  # else.
  backend "gcs" {
    bucket = "fps-csarko-tfstate"
    prefix = "test-rig-gcp"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
  zone    = var.zone

  # Every resource that takes labels gets this one, so the machine's cost can
  # be filtered out of the bill. Networks, firewalls, routers, service
  # accounts and IAM bindings take no labels; of those only NAT costs anything,
  # and only while the machine runs. The module's resources take it from this
  # provider.
  default_labels = local.labels
}

# The billing budget API refuses a user's own credentials unless the call names
# a project to bill it to. Scoped to its own alias so that header is sent for
# the budget only, not for every other call the module makes.
provider "google" {
  alias                 = "billing"
  project               = var.gcp_project_id
  region                = var.gcp_region
  billing_project       = var.gcp_project_id
  user_project_override = true
}

locals {
  labels = { purpose = "test-rig" }
}

module "test_rig" {
  source = "../modules/gcp-test-rig"

  gcp_project_id         = var.gcp_project_id
  gcp_region             = var.gcp_region
  zone                   = var.zone
  instance_name          = var.instance_name
  machine_type           = var.machine_type
  gpu_type               = var.gpu_type
  image                  = var.image
  baked_image            = var.baked_image
  boot_disk_size_gb      = var.boot_disk_size_gb
  boot_disk_type         = var.boot_disk_type
  spot                   = var.spot
  running                = var.running
  max_run_hours          = var.max_run_hours
  backstop_stop_schedule = var.backstop_stop_schedule
  desktop_user           = var.desktop_user
  enable_display         = var.enable_display
  subnet_cidr            = var.subnet_cidr
  direct_access_cidrs    = var.direct_access_cidrs
  billing_account_id     = var.billing_account_id
  monthly_budget_usd     = var.monthly_budget_usd
  labels                 = local.labels

  providers = {
    google         = google
    google.billing = google.billing
  }
}
