variable "aws_region" {
  description = "AWS region for the Route53 provider. Route53 is global; this only anchors the provider."
  type        = string
  default     = "us-east-1"
}

variable "gcp_project_id" {
  description = "GCP project that holds hosting and signaling."
  type        = string
}

variable "gcp_region" {
  description = "GCP region for Cloud Run and Artifact Registry."
  type        = string
  default     = "us-west1"
}

variable "domain_name" {
  description = "Public hostname for the site."
  type        = string
  default     = "games.csarko.sh"
}

variable "legacy_domain_name" {
  description = "The hostname the game used to live on. Kept as a second custom domain that serves the redirect page."
  type        = string
  default     = "game.csarko.sh"
}

variable "site_path" {
  description = "Path under domain_name the game is served from, no trailing slash."
  type        = string
  default     = "/dayhike"
}

variable "dns_zone_name" {
  description = "Route53 hosted zone that contains domain_name. Trailing dot optional."
  type        = string
  default     = "csarko.sh"
}

variable "hosting_site_id" {
  description = "Firebase Hosting site id. Globally unique across all of Firebase."
  type        = string
  default     = "fps-csarko"
}

variable "signaling_image" {
  description = <<-EOT
    Container image for the signaling service. Defaults to Google's hello
    image so the very first apply can create the service before any image of
    ours exists; `npm run deploy:server` replaces it and Terraform then ignores
    the tag. Do not point this at a real tag — it would fight the deploy script.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "telemetry_image" {
  description = <<-EOT
    Container image for the telemetry service: the signaling image in its
    `telemetry` role. As `signaling_image`, it defaults to Google's hello image
    so the first apply can create the service; `npm run deploy:server`
    replaces it on every deploy and Terraform then ignores the tag.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "billing_account_id" {
  description = <<-EOT
    Billing account to create the monthly budget alert for Cloud Run and
    Cloud Logging under, as XXXXXX-XXXXXX-XXXXXX. Empty (the default) creates
    no budget. Set it only in the git-ignored terraform.tfvars.
  EOT
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = <<-EOT
    Monthly amount the budget alerts against, in whole US dollars. An ordinary
    month of both services and the telemetry rows is within every free tier,
    so the first alert, at half of this, means a spike or a leak to look at.
  EOT
  type        = number
  default     = 10
}

variable "admin_emails" {
  description = <<-EOT
    The Google accounts that may read the admin page, as addresses. Set in
    the git-ignored terraform.tfvars, not here. Empty (the default) serves
    no admin routes at all.
  EOT
  type        = list(string)
  default     = []
}

variable "admin_auth_project" {
  description = <<-EOT
    The Firebase project the admin page signs in on, whose ID tokens the
    telemetry service's admin routes trust (`ADMIN_AUTH_PROJECT`). The page
    lives on the shared admin host at admin.csarko.sh, the csarko.sh
    repository's, which signs in on its own project; so this is `csarko-sh`,
    not `gcp_project_id`. Change it only if that host moves projects.
  EOT
  type        = string
  default     = "csarko-sh"
}

variable "telemetry_ignore_ips" {
  description = <<-EOT
    The owner's own addresses, or CIDR prefixes, v4 and v6, whose telemetry
    rows the service marks `tester` and `owner`, so the owner's play is no
    part of the numbers while its errors are kept. Set only in the
    git-ignored terraform.tfvars: the repository is public and these are a
    home's. Empty (the default) marks nothing.
  EOT
  type        = list(string)
  default     = []
  sensitive   = true
}

variable "signaling_registry" {
  description = "Where the signaling rooms live: `firestore` (shared, lets the service scale) or `memory` (one instance only)."
  type        = string
  default     = "firestore"
}

variable "signaling_max_instances" {
  description = "The most signaling instances to run. A cost ceiling with the Firestore registry; must be 1 with the memory one."
  type        = number
  default     = 3
}
