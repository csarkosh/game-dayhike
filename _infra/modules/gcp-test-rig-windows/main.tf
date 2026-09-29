# The rented Windows machine with an NVIDIA GPU on Google Cloud: the APIs it
# needs, its identity, network, machine, daily stop and optional budget.
# Called by one root only, _infra/test-rig-gcp-windows/, which holds the backend, both
# providers (the default one's labels every resource here carries) and the
# state; see its main.tf for why that root is not _infra/.

terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      # google.billing: the budget's own provider, which names a project to
      # bill the call to (the root's main.tf says why).
      configuration_aliases = [google.billing]
    }
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
