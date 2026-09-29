output "macs" {
  description = "Each Mac: address, login, SSH command, Screen Sharing port, and the earliest time it can be deleted."
  value = [
    for i, s in scaleway_apple_silicon_server.mac : {
      name            = s.name
      ip              = s.ip
      username        = s.username
      ssh             = "ssh ${s.username}@${s.ip}"
      vnc_port        = local.vnc_ports[i]
      earliest_delete = s.deletable_at
    }
  ]
}

output "server_ids" {
  description = "Each Mac's zoned id, for scaleway-macs.sh list to set against the API's own listing."
  value       = [for s in scaleway_apple_silicon_server.mac : s.id]
}

output "passwords" {
  description = <<-EOT
    Each Mac's admin password, in the order of `macs`. setup.sh needs it for
    sudo and automatic login; `terraform output -json passwords` prints it.
    Sensitive, but stored in clear in the state; see
    _infra/test-rig-mac/README.md.
  EOT
  value       = [for s in scaleway_apple_silicon_server.mac : s.password]
  sensitive   = true
}

locals {
  # EUR per hour excluding VAT, Scaleway's public product catalogue
  # (api.scaleway.com/product-catalog/v2alpha1/public-catalog/products),
  # as of 2026-09-27.
  hourly_eur = {
    "M1-M"  = 0.11
    "M2-M"  = 0.17
    "M2-L"  = 0.21
    "M4-S"  = 0.22
    "M4-SP" = 0.24
    "M4-M"  = 0.29
    # In the catalogue (M4 Pro - L, fr-par-1 and fr-par-3), though the API's
    # server-type listing does not offer it to this account today.
    "M4-L"  = 0.44
    "M4-XL" = 0.49
  }
  hourly = lookup(local.hourly_eur, var.server_type, null)
}

output "day_cost" {
  description = "What the Macs cost for their minimum day, from Scaleway's public catalogue."
  value       = local.hourly == null ? "No catalogue price recorded for ${var.server_type}." : <<-EOT
    As of 2026-09-27, Scaleway public catalogue, EUR excluding VAT (not
    charged to a customer outside the EU): ${var.server_type} EUR ${local.hourly}/h,
    billed while the server exists, running or not, 24-hour minimum.
    ${var.server_count} Mac(s) x 24 h x EUR ${local.hourly} = EUR ${format("%.2f", var.server_count * 24 * local.hourly)} for the day.
    Only deletion stops the bill: `terraform destroy` after earliest_delete,
    or Scaleway's own deletion at that time when auto_delete_after_24h is on.
    A Mac left undeleted bills about EUR ${format("%.0f", 730 * local.hourly)} a month; check with
    `../modules/scaleway-test-rig-mac/scaleway-macs.sh list` (from
    _infra/test-rig-mac/) at the end of every day.
  EOT
}
