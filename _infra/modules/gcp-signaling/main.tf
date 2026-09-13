terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
  }
}

resource "google_project_service" "run" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  project            = var.project_id
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "signaling" {
  project       = var.project_id
  location      = var.region
  repository_id = "signaling"
  format        = "DOCKER"
  description   = "Container images for the fps signaling server."

  # Storage here is nearly free and still worth bounding. Measured at eight
  # builds: 57 MB total, of which a single 50 MB `node:22-alpine`-plus-deps
  # layer is shared by every image and stored once. The marginal cost of a
  # deploy is under 1 MB, or ~4.5 MB when package.json changes and the deps
  # layer is rebuilt. The free tier is 500 MB and overage is $0.10/GB/month,
  # so this is about tidiness, not the bill.
  #
  # KEEP beats DELETE, so `keep-recent` protects the ten newest versions from
  # both DELETE rules no matter how old they get. Ten is not arbitrary: a
  # deploy now deletes superseded Cloud Run revisions, which makes redeploying
  # an older tag the rollback path — so an image here IS a rollback target, and
  # the keep count is how many deploys back you can still reach. It also
  # guarantees the currently-serving image can never be collected out from
  # under a cold start.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  # Re-pushing a tag leaves the manifest it used to point at untagged and
  # unreachable. These accumulate silently — ten of sixteen manifests were
  # already in this state when the policy was written.
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"

    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.artifactregistry]
}

# Its own identity rather than the default compute service account, which
# carries project-wide editor. This service needs no GCP permissions at all.
resource "google_service_account" "signaling" {
  project      = var.project_id
  account_id   = "fps-signaling"
  display_name = "FPS signaling server"
}

resource "google_cloud_run_v2_service" "signaling" {
  project  = var.project_id
  location = var.region
  name     = "fps-signaling"

  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.signaling.email

    scaling {
      min_instance_count = 0

      # LOAD-BEARING, and not a cost control. RoomRegistry holds rooms in
      # process memory, so a second instance would split a room across two
      # processes and its peers would never discover each other. Raising this
      # breaks multiplayer in a way no test here would catch.
      max_instance_count = 1
    }

    # A signaling socket lives as long as the match, so the request timeout is
    # the match ceiling. 3600s is Cloud Run's maximum, and reaching it is
    # survivable rather than fatal: gameplay runs over WebRTC data channels,
    # not this socket, so the client just reconnects signaling in the
    # background and a returning host reclaims its room within its grace
    # window without the other players seeing anything.
    timeout = "3600s"

    # One instance must therefore hold every concurrent socket: 250 is 50 full
    # games, far past what this needs.
    max_instance_request_concurrency = 250

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          # Not /healthz: Google's frontend on *.run.app intercepts that exact
          # literal path and answers it itself, so external requests never
          # reach the container there. This probe still works either way (it
          # hits the container directly), but the deploy script's post-deploy
          # poll needs a path the public internet can actually reach, so the
          # server, this probe, and the poll must all agree on /healthcheck.
          #
          # Rollout ordering hazard: this path (or any Terraform-owned field
          # of `containers`) is checked against whatever image is *currently
          # live*, because `image` itself is ignored below and owned by
          # `npm run deploy:server`. So changing this path here and running
          # `terraform apply` will roll out a revision that fails its startup
          # probe if the live image doesn't already answer the new path — that
          # failed revision is expected, not a rollback signal, and Cloud Run
          # leaves the previous ready revision serving traffic throughout, so
          # there is no outage. The fix is always the same: `terraform apply`
          # for a change here must be followed immediately by
          # `npm run deploy:server`, which pushes an image that matches, and
          # the next revision then becomes ready normally.
          path = "/healthcheck"
        }
        # 2, not 1, and it is a cold-start latency setting rather than a
        # health one. `min_instance_count = 0` means the first Invite after an
        # idle period waits for a container to boot, and this server logs
        # "signaling server listening" 1.19-1.50 s after Cloud Run's "Starting
        # new instance" (measured over the 2026-09-07 starts). A first probe at
        # 1 s therefore lands on a coin flip: win and the cold start is ~1.3 s,
        # miss and the next attempt is a whole `period_seconds` later, making it
        # ~4.1 s. Both branches are in the logs for that day, and the
        # `startup_latencies` metric shows the same two clusters across a
        # fortnight. Moving the first probe past the boot trades the ~1.3 s best
        # case for a ~2 s worst one, which is the better deal for the only human
        # waiting on it. Revisit if the server's boot time changes.
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }

  lifecycle {
    # Terraform owns the shape of this service; `npm run deploy:server` owns the
    # image tag. Without this, every apply reverts the service to var.image and
    # silently rolls back the last deploy.
    #
    # `scaling` is the service-level block (distinct from template.scaling, which
    # carries the load-bearing max_instance_count = 1). The API reports it with
    # zeroed fields even though the config never declares it, so without this the
    # plan is permanently dirty and real drift becomes impossible to spot.
    #
    # `client` and `client_version` are stamped onto the service by whichever
    # tool last ran `gcloud run deploy` — which is `npm run deploy:server`,
    # deliberately, since it's the tool that owns rollouts here. Terraform's
    # config never declares them, so without this every plan after a deploy
    # wants to strip them, and the next deploy just writes them straight back:
    # a permanent, self-inflicted diff.
    # `deletion_protection` is the same story, found when the lost state was
    # rebuilt by import: the live service has it on, because `gcloud run deploy`
    # turns it on by default, while this config declares it off. Terraform would
    # switch it off on every apply and the next deploy would switch it straight
    # back on. Leaving it on is also the safer of the two — nothing here is
    # meant to be deleted, and `terraform destroy` is never run against this
    # project — so the drift is settled in the live service's favour.
    ignore_changes = [
      template[0].containers[0].image,
      scaling,
      client,
      client_version,
      deletion_protection,
    ]
  }

  depends_on = [google_project_service.run]
}

# Public: the game has no accounts, and the service does its own validation.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.signaling.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
