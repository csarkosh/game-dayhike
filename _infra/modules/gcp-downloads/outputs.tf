output "bucket" {
  description = "Bucket name"
  value       = google_storage_bucket.downloads.name
}

output "url" {
  description = "Public base URL of the bucket"
  value       = "https://storage.googleapis.com/${google_storage_bucket.downloads.name}"
}
