variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique bucket name for public downloads."
  type        = string
}

variable "location" {
  description = "Bucket location. A US region keeps it inside the always-free tier (us-central1, us-east1, us-west1)."
  type        = string
  default     = "US-CENTRAL1"
}

variable "cors_origins" {
  description = "Origins allowed to fetch latest.json with CORS."
  type        = list(string)
}
