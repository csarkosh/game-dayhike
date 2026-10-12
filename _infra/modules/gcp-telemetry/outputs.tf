output "service_url" {
  description = "Base HTTPS URL of the telemetry service"
  value       = google_cloud_run_v2_service.telemetry.uri
}

output "service_name" {
  description = "Cloud Run service name, for `gcloud run deploy`"
  value       = google_cloud_run_v2_service.telemetry.name
}

output "log_bucket" {
  description = "The log bucket the rows are routed to"
  value       = google_logging_project_bucket_config.telemetry.bucket_id
}

output "dataset" {
  description = "The linked BigQuery dataset's id, for queries from BigQuery or Looker Studio"
  value       = google_logging_linked_dataset.telemetry.link_id
}
