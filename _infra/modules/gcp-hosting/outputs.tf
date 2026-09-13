output "site_id" {
  description = "Firebase Hosting site id"
  value       = google_firebase_hosting_site.this.site_id
}

output "default_url" {
  description = "The site's own firebaseapp/web.app URL"
  value       = google_firebase_hosting_site.this.default_url
}

output "required_dns_updates" {
  description = "DNS records Firebase requires for this custom domain. Read by the aws-dns module."
  value       = google_firebase_hosting_custom_domain.this.required_dns_updates
}
