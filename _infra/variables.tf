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
