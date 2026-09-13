terraform {
  required_version = ">= 1.0"

  # State lives in GCS, not on disk.
  #
  # It was local at first, which meant it existed in exactly one checkout and
  # belonged to whoever ran `apply`. That state was created inside a git
  # worktree and was deleted along with the worktree when its branch merged:
  # every resource below was alive and healthy in GCP, and Terraform had no
  # record that any of it existed. A concurrent session in its own worktree
  # could not have run `plan` either, for the same reason.
  #
  # The bucket is versioned, so the same accident is now recoverable rather
  # than terminal, and it is deliberately NOT managed by Terraform — a backend
  # cannot bootstrap the bucket it stores itself in. It was created once, by
  # hand:
  #
  #   gcloud storage buckets create gs://fps-csarko-tfstate --project=fps-csarko \
  #     --location=us-west1 --uniform-bucket-level-access --public-access-prevention
  #   gcloud storage buckets update gs://fps-csarko-tfstate --versioning
  backend "gcs" {
    bucket = "fps-csarko-tfstate"
    prefix = "fps"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

provider "google-beta" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

module "gcp_signaling" {
  source = "./modules/gcp-signaling"

  project_id = var.gcp_project_id
  region     = var.gcp_region
  image      = var.signaling_image

  providers = {
    google = google
  }
}

module "gcp_hosting" {
  source = "./modules/gcp-hosting"

  project_id         = var.gcp_project_id
  site_id            = var.hosting_site_id
  domain_name        = var.domain_name
  legacy_domain_name = var.legacy_domain_name

  providers = {
    google      = google
    google-beta = google-beta
  }
}

module "gcp_downloads" {
  source = "./modules/gcp-downloads"

  project_id  = var.gcp_project_id
  bucket_name = "${var.gcp_project_id}-downloads"
  cors_origins = [
    "https://${var.domain_name}",
    "https://${var.legacy_domain_name}",
    module.gcp_hosting.default_url,
    "https://${var.hosting_site_id}.firebaseapp.com",
    "http://localhost:5173",
    # Installed desktop 0.2.0 shells still serve their bundled page from
    # app://fps and read latest.json from it — this entry is the only way they
    # learn a newer shell exists. The bucket is public; retire this when 0.2.0
    # is declared dead. Later shells load the site itself (see desktop/main.cjs).
    "app://fps",
  ]

  providers = {
    google = google
  }
}

# The CNAME target is the site's own default hostname (e.g.
# "fps-csarko.web.app") minus its scheme. This was originally sourced from
# module.gcp_hosting.required_dns_updates instead — filtering its nested
# per-domain records for type == "CNAME" — because that field is what
# Firebase's API explicitly states it wants. Confirmed live in this session
# that it is the wrong steady-state source: required_dns_updates lists only
# *pending* actions, so once the custom domain fully reconciles (cert
# ACTIVE, host ACTIVE, ownership ACTIVE) it goes back to an empty list —
# "nothing left required" — which would fail the aws-dns module's
# empty-target validation on every plan/apply after the first successful
# one, permanently, even though the record is correct and nothing is wrong.
# default_url is populated for the lifetime of the site regardless of
# reconciliation state and names the same host required_dns_updates asked
# for, so it can't drift and it doesn't regress to empty on success.
locals {
  hosting_cname_target = trimprefix(module.gcp_hosting.default_url, "https://")
}

module "aws_dns" {
  source = "./modules/aws-dns"

  zone_name    = var.dns_zone_name
  domain_name  = var.domain_name
  cname_target = local.hosting_cname_target

  providers = {
    aws = aws
  }
}

module "aws_dns_legacy" {
  source = "./modules/aws-dns"

  zone_name    = var.dns_zone_name
  domain_name  = var.legacy_domain_name
  cname_target = local.hosting_cname_target

  providers = {
    aws = aws
  }
}
