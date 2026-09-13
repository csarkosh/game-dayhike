variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run and Artifact Registry."
  type        = string
}

variable "image" {
  description = "Container image to create the service with. The deploy script owns it afterwards."
  type        = string
}
