terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
    google-beta = {
      source = "hashicorp/google-beta"
    }
  }
}

resource "google_project_service" "firebase" {
  project            = var.project_id
  service            = "firebase.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firebasehosting" {
  project            = var.project_id
  service            = "firebasehosting.googleapis.com"
  disable_on_destroy = false
}

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.firebase]
}

resource "google_firebase_hosting_site" "this" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.site_id

  depends_on = [
    google_firebase_project.this,
    google_project_service.firebasehosting,
  ]
}

resource "google_firebase_hosting_custom_domain" "this" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.this.site_id
  custom_domain = var.domain_name

  # The certificate cannot issue until DNS points here, and the records to
  # create are an output of this resource — so waiting would deadlock the first
  # apply. A second apply reads these records and creates them in DNS, and
  # issuance completes afterwards.
  wait_dns_verification = false

  cert_preference = "GROUPED"
}

resource "google_firebase_hosting_custom_domain" "legacy" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.this.site_id
  custom_domain = var.legacy_domain_name

  wait_dns_verification = false
  cert_preference       = "GROUPED"
}
