output "service_url" {
  description = "Base HTTPS URL of the service"
  value       = google_cloud_run_v2_service.signaling.uri
}

output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.signaling.name
}

output "image_repository" {
  description = "Artifact Registry Docker path, without a tag"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.signaling.repository_id}"
}
