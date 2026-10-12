# Telemetry: the Cloud Run service pages send their events to, and where the
# rows it writes are kept and queried.
#
# The service runs the signaling server's image in its `telemetry` role
# (`server/src/index.ts`): the same build, deployed twice by `npm run
# deploy:server`. It holds nothing between requests, so unlike signaling it
# scales with the traffic — from zero, where it sits whenever nobody plays, to
# the few instances a spike needs — and costs nothing idle.
#
# The rows go nowhere a library or a permission is needed: the process writes
# one JSON line an event to stdout, Cloud Run turns each into a structured log
# entry, and the sink below routes every entry marked `dh: 1` — from this
# service and from signaling's room rows alike — into a log bucket of their
# own, with Log Analytics on so they are queried by SQL in the console and
# through the linked BigQuery dataset. Cloud Logging's first 50 GiB a month and
# every Log Analytics query are free; the bucket's retention past 30 days is a
# cent a GiB-month.

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

# Its own identity, as signaling has. Writing rows to stdout needs no role;
# the admin routes (`server/src/admin.ts`) need three, each read-only: to run
# the saved queries as BigQuery jobs, to read the log bucket's view those
# queries go through, and to read the open rooms from Firestore.
resource "google_service_account" "telemetry" {
  project      = var.project_id
  account_id   = "fps-telemetry"
  display_name = "Day Hike telemetry ingest"
}

resource "google_project_iam_member" "admin_reads" {
  for_each = toset([
    "roles/bigquery.jobUser",
    "roles/logging.viewAccessor",
    "roles/datastore.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.telemetry.email}"
}

# The linked dataset is a BigQuery dataset of its own, and a query of its
# view is refused without read access on it, whatever the log view grants:
# "User does not have permission to query table", as found on the first
# sign-in. Read-only, on this dataset alone.
resource "google_bigquery_dataset_iam_member" "admin_reads_dataset" {
  project    = var.project_id
  dataset_id = google_logging_linked_dataset.telemetry.link_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.telemetry.email}"
}

resource "google_cloud_run_v2_service" "telemetry" {
  project  = var.project_id
  location = var.region
  name     = "fps-telemetry"

  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.telemetry.email

    scaling {
      min_instance_count = 0
      # A cost ceiling, not a capacity need: one instance at this concurrency
      # absorbs a forum-sized spike on its own, since a batch is a few
      # milliseconds of work. Five bounds what a flood could ever bill.
      max_instance_count = var.max_instances
    }

    # A request is one batch, read and answered at once.
    timeout = "30s"

    # Cloud Run's ceiling. The handler does no I/O but the write to stdout, so
    # nothing in it waits on anything a thousand in flight would queue behind.
    max_instance_request_concurrency = 1000

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      env {
        name  = "ROLE"
        value = "telemetry"
      }

      # The admin routes' readers, the project their tokens name, the dataset
      # the queries read, and where the open rooms are (`server/src/index.ts`).
      # No readers, no admin routes.
      env {
        name  = "ADMIN_EMAILS"
        value = join(",", var.admin_emails)
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "TELEMETRY_DATASET"
        value = google_logging_linked_dataset.telemetry.link_id
      }

      env {
        name  = "REGISTRY"
        value = var.registry
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          # The same path and the same reasoning as signaling's probe: the
          # server, this probe and the deploy script's poll agree on it.
          path = "/healthcheck"
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }

  lifecycle {
    # As for signaling: Terraform owns the shape, the deploy script owns the
    # image, and the fields `gcloud run deploy` stamps are left alone.
    ignore_changes = [
      template[0].containers[0].image,
      scaling,
      client,
      client_version,
      deletion_protection,
    ]
  }
}

# Public: a page sends its batch with no account; the service validates the
# batch, the origin and the rate itself.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.telemetry.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---- where the rows live ------------------------------------------------------

# A bucket of its own rather than the project's `_Default`: Log Analytics,
# once enabled on a bucket, cannot be turned off, and the rows' retention is
# their own. A year and a bit, so a build's numbers can be read against the
# one a year before; at this volume the charge is cents.
resource "google_logging_project_bucket_config" "telemetry" {
  project          = var.project_id
  location         = "global"
  bucket_id        = "dayhike-telemetry"
  retention_days   = var.retention_days
  enable_analytics = true
  description      = "Day Hike telemetry rows: what pages report of their sessions, and what signaling sees of its rooms."
}

# Every row either service writes carries `dh: 1` (`server/src/log.ts`);
# nothing else in the project does. The destination is a bucket in the same
# project, which needs no grant to be written to.
resource "google_logging_project_sink" "telemetry" {
  project     = var.project_id
  name        = "dayhike-telemetry"
  destination = "logging.googleapis.com/projects/${var.project_id}/locations/global/buckets/${google_logging_project_bucket_config.telemetry.bucket_id}"
  filter      = "resource.type=\"cloud_run_revision\" AND jsonPayload.dh=1"
}

# The same rows need not also sit in `_Default`, and the telemetry service's
# own request log — one entry a batch, about a kilobyte, which at a spike is
# the larger half of the volume — says nothing a row does not, so the ones
# that succeeded are dropped. A failed request keeps its entry.
resource "google_logging_project_exclusion" "telemetry_duplicates" {
  project     = var.project_id
  name        = "dayhike-telemetry-duplicates"
  description = "Telemetry rows live in their own bucket; successful batch requests are counted there."
  filter      = <<-EOT
    resource.type="cloud_run_revision" AND (
      jsonPayload.dh=1 OR (
        resource.labels.service_name="${google_cloud_run_v2_service.telemetry.name}"
        AND logName="projects/${var.project_id}/logs/run.googleapis.com%2Frequests"
        AND httpRequest.status<400
      )
    )
  EOT
}

# The bucket as a BigQuery dataset, read-only: what Looker Studio, a saved
# query or the admin page later reads. BigQuery's first TiB of queries a
# month is free; the data is the bucket's, stored once.
resource "google_logging_linked_dataset" "telemetry" {
  parent      = "projects/${var.project_id}"
  location    = "global"
  link_id     = "dayhike_telemetry"
  bucket      = google_logging_project_bucket_config.telemetry.id
  description = "Day Hike telemetry, as a dataset."
}

# ---- the budget ------------------------------------------------------------------

# An alert, not a limit, as the test rig's: a budget emails the billing
# account's administrators as spending crosses each threshold and stops
# nothing. The stops are the service's instance ceiling and the batch limits.
#
# Off unless billing_account_id is set. The filter is the project's services
# this module bills: Cloud Run, which both services are, and Cloud Logging. An
# ordinary month is within every free tier, so the amount is small and an
# alert means a spike or a leak worth looking at.

resource "google_project_service" "billingbudgets" {
  count = var.billing_account_id != "" ? 1 : 0

  project            = var.project_id
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "this" {
  count      = var.billing_account_id != "" ? 1 : 0
  project_id = var.project_id
}

resource "google_billing_budget" "telemetry" {
  count    = var.billing_account_id != "" ? 1 : 0
  provider = google.billing

  billing_account = var.billing_account_id
  display_name    = "dayhike-services"

  budget_filter {
    projects = ["projects/${data.google_project.this[0].number}"]
    services = [
      "services/152E-C115-5142", # Cloud Run
      "services/5490-F7B7-8DF6", # Cloud Logging
    ]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.billingbudgets]
}
