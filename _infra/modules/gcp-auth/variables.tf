variable "project_id" {
  description = "The Firebase project; the GCP project."
  type        = string
}

variable "authorized_domains" {
  description = "Hostnames a sign-in may come from, beside Firebase's own and localhost: the site's."
  type        = list(string)
}
