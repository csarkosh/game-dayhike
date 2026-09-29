terraform {
  # 1.7 for the mock providers in tests/.
  required_version = ">= 1.7"

  # Remote state for the same reason as _infra/main.tf (state kept on disk in a
  # worktree dies with the worktree), in the same versioned bucket, under its
  # own prefix. Nothing here reads _infra's state and nothing in _infra reads
  # this one: the two root modules share a bucket and a project and nothing
  # else, so a `terraform destroy` run here can only reach the resources below,
  # never hosting, DNS or the signaling service.
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
  # and only while the machine runs.
  default_labels = local.labels
}

# The billing budget API refuses a user's own credentials unless the call names
# a project to bill it to. Scoped to its own alias so that header is sent for
# the budget only, not for every other call this module makes.
provider "google" {
  alias                 = "billing"
  project               = var.gcp_project_id
  region                = var.gcp_region
  billing_project       = var.gcp_project_id
  user_project_override = true
}

locals {
  labels = {
    purpose = "test-rig"
  }
}

# The APIs this module needs. `disable_on_destroy = false` so a destroy here
# never switches an API off under anything else in the project. Compute Engine
# is already on in fps-csarko; the resource makes a fresh project work too.
resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

# For `gcloud compute ssh --tunnel-through-iap` and `gcloud compute
# start-iap-tunnel`, the only ways in (network.tf).
resource "google_project_service" "iap" {
  service            = "iap.googleapis.com"
  disable_on_destroy = false
}

# Creating a service account needs it.
resource "google_project_service" "iam" {
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# Its own identity rather than the default compute service account, which
# carries project-wide Editor. It can write logs (the start-up script's output
# reaches Cloud Logging through the guest agent) and metrics (the Ops Agent, if
# it is ever installed), and nothing else. The desktop user cannot reach it at
# all: the start-up script blocks the metadata server for that account.
resource "google_service_account" "test_rig" {
  account_id   = "test-rig"
  display_name = "Rented Windows GPU test machine"

  depends_on = [google_project_service.iam]
}

# Project-wide, as Google grants it: whoever controls the machine can also
# write entries under any log name in the project. Accepted; the machine is
# reachable only through IAP.
resource "google_project_iam_member" "test_rig_log_writer" {
  project = var.gcp_project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.test_rig.email}"
}

resource "google_project_iam_member" "test_rig_metric_writer" {
  project = var.gcp_project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.test_rig.email}"
}
