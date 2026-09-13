output "gcp_project_id" {
  description = "GCP project ID"
  value       = var.gcp_project_id
}

output "signaling_url" {
  description = "Base HTTPS URL of the Cloud Run signaling service"
  value       = module.gcp_signaling.service_url
}

output "signaling_service_name" {
  description = "Cloud Run service name, for `gcloud run deploy`"
  value       = module.gcp_signaling.service_name
}

output "signaling_image_repository" {
  description = "Artifact Registry Docker repository path for the signaling image"
  value       = module.gcp_signaling.image_repository
}

output "hosting_site_id" {
  description = "Firebase Hosting site id, for `firebase deploy`"
  value       = module.gcp_hosting.site_id
}

output "hosting_default_url" {
  description = "The site's own web.app URL, usable before DNS is live"
  value       = module.gcp_hosting.default_url
}

output "hosting_required_dns_updates" {
  description = <<-EOT
    Pending DNS actions Firebase still wants for the custom domain, straight
    from the API. Empty once the domain has fully reconciled — that is the
    success state, not a sign nothing was ever created. Informational only;
    the aws-dns module reads the CNAME target from
    module.gcp_hosting.default_url instead, which stays populated on both
    sides of reconciliation.
  EOT
  value       = module.gcp_hosting.required_dns_updates
}

output "dns_record_fqdn" {
  description = "The CNAME record created for the custom domain"
  value       = module.aws_dns.fqdn
}

output "site_url" {
  description = "Public URL of the game"
  value       = "https://${var.domain_name}${var.site_path}"
}

output "legacy_domain_name" {
  description = "The old hostname; serves only the redirect page"
  value       = var.legacy_domain_name
}

output "downloads_bucket" {
  description = "Public downloads bucket (desktop builds, latest.json)"
  value       = module.gcp_downloads.bucket
}

output "downloads_url" {
  description = "Public base URL of the downloads bucket"
  value       = module.gcp_downloads.url
}
