terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
  }
}

# Public downloads: the desktop build's .dmg files and the latest.json that
# both the site and the app read. Public by design — every object here is
# something a player is meant to fetch — so uniform bucket-level access plus
# one allUsers grant, and no per-object ACLs to get wrong.
resource "google_storage_bucket" "downloads" {
  project  = var.project_id
  name     = var.bucket_name
  location = var.location

  uniform_bucket_level_access = true
  # "inherited" lets the allUsers grant below take effect. If the project or
  # org enforces public-access prevention, the IAM apply fails loudly — see
  # the plan's pre-apply check.
  public_access_prevention = "inherited"
  force_destroy            = false

  # The landing page reads latest.json with fetch, from the site and (for
  # installed 0.2.0 shells) from app://fps; the .dmg is a navigation and
  # needs no CORS.
  cors {
    origin          = var.cors_origins
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.downloads.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
