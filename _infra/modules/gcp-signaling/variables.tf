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

variable "registry" {
  description = "Where the rooms live: `firestore`, shared by every instance, or `memory`, this process's own, which needs max_instances = 1."
  type        = string
  default     = "firestore"

  validation {
    condition     = contains(["firestore", "memory"], var.registry)
    error_message = "registry must be firestore or memory."
  }
}

variable "max_instances" {
  description = "The most instances the service scales to. A cost ceiling with the shared registry; must be 1 with the memory one."
  type        = number
  default     = 3

  validation {
    condition     = var.max_instances >= 1
    error_message = "max_instances must be at least 1."
  }
}
