# Sign-in for the admin page: Firebase Authentication on the project, and the
# web app whose configuration the page signs in with.
#
# The page (`client/src/admin/`) signs an account in with Google through
# Firebase Auth and sends the ID token to the telemetry service's admin
# routes, which verify it against Google's keys and the allowlist
# (`server/src/adminAuth.ts`). Nothing here costs anything: Firebase Auth's
# Google sign-in is free at any number of accounts, and the allowlist is one.
#
# ONE STEP IS BY HAND. The Google sign-in provider needs an OAuth client, which
# the Firebase console creates when the provider is switched on and which no
# API or Terraform resource creates. After the first apply: Firebase console →
# Authentication → Sign-in method → Google → Enable → Save. Until then the
# page's sign-in button answers with Firebase's "operation not allowed".

terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
      # google.quota: the Identity Toolkit API refuses a user's own credentials
      # unless the call names a project to count its quota against; this alias
      # does (the root's main.tf says how).
      configuration_aliases = [google.quota]
    }
    google-beta = {
      source                = "hashicorp/google-beta"
      configuration_aliases = [google-beta.quota]
    }
  }
}

resource "google_project_service" "identitytoolkit" {
  project            = var.project_id
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# Firebase Auth, initialised, with the domains a sign-in may come from: the
# site, Firebase's own hostnames, and the dev server.
resource "google_identity_platform_config" "this" {
  provider = google.quota
  project  = var.project_id

  authorized_domains = concat(
    ["localhost", "${var.project_id}.firebaseapp.com", "${var.project_id}.web.app"],
    var.authorized_domains,
  )

  depends_on = [google_project_service.identitytoolkit]
}

# The web app: what gives the page its API key. A Firebase web API key is not
# a secret — it names the project to Firebase and is sent by every page that
# signs in — and the allowlist on the server is what guards the data.
resource "google_firebase_web_app" "admin" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Day Hike"

  deletion_policy = "DELETE"
}

data "google_firebase_web_app_config" "admin" {
  provider   = google-beta.quota
  project    = var.project_id
  web_app_id = google_firebase_web_app.admin.app_id
}
