variable "zone_name" {
  description = "Route53 hosted zone name, e.g. csarko.sh"
  type        = string
}

variable "domain_name" {
  description = "Fully qualified record name to create, e.g. game.csarko.sh"
  type        = string
}

variable "cname_target" {
  description = <<-EOT
    Hostname the CNAME should point at, e.g. fps-csarko.web.app. Sourced from
    the Firebase custom domain's own required_dns_updates output rather than a
    remembered literal, so it can never drift from the site it names. Must not
    be empty — an empty CNAME target is a broken record that looks applied.
  EOT
  type        = string

  validation {
    condition     = length(trimspace(var.cname_target)) > 0
    error_message = "cname_target is empty. Firebase has not returned a CNAME target yet (the custom domain likely hasn't reconciled) — refusing to create a CNAME record with an empty target."
  }
}

variable "ttl" {
  description = "TTL in seconds. Low while the domain is being set up."
  type        = number
  default     = 300
}
