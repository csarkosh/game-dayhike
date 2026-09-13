variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "site_id" {
  description = "Firebase Hosting site id. Must be globally unique."
  type        = string
}

variable "domain_name" {
  description = "Custom domain to serve the site on."
  type        = string
}

variable "legacy_domain_name" {
  type = string
}
