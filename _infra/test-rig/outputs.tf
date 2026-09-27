locals {
  gcloud_target = "${google_compute_instance.test_rig.name} --zone=${var.zone} --project=${var.gcp_project_id}"
}

output "instance_name" {
  description = "Name of the machine."
  value       = google_compute_instance.test_rig.name
}

output "zone" {
  description = "Zone the machine runs in."
  value       = var.zone
}

output "ssh_command" {
  description = <<-EOT
    Opens a shell (cmd.exe) on the machine through IAP. The first run pushes a
    key and the guest agent makes a local administrator for it, which takes a
    minute after boot.
  EOT
  value       = "gcloud compute ssh ${local.gcloud_target} --tunnel-through-iap"
}

output "rdp_tunnel_command" {
  description = <<-EOT
    Forwards the machine's Remote Desktop port to localhost:13389 through IAP.
    Point a Remote Desktop client at localhost:13389 while it runs.
  EOT
  value       = "gcloud compute start-iap-tunnel ${local.gcloud_target} 3389 --local-host-port=localhost:13389"
}

output "windows_password_command" {
  description = "Creates (or resets) a Windows account and prints its password, for Remote Desktop."
  value       = "gcloud compute reset-windows-password ${local.gcloud_target}"
}

output "setup_log_command" {
  description = "Prints the machine's serial console, where the start-up script's progress also appears."
  value       = "gcloud compute instances get-serial-port-output ${local.gcloud_target}"
}

output "hourly_price" {
  description = "What the machine costs while it runs and while it is stopped, from Google's list prices."
  value       = <<-EOT
    As of 2026-09-27, us-west1 list prices in USD from the Cloud Billing
    Catalog API (services 6F81-5844-456A Compute Engine, E505-1604-58F8
    Networking). Billed per second while running.

    g2-standard-4 + L4: machine $0.1468/h (spot $0.0881/h), L4 $0.5600/h
    (spot $0.3360/h).
    n1-standard-4 + T4: machine $0.1900/h (spot $0.1140/h), T4 $0.3500/h
    (spot $0.2095/h).
    Windows Server licence: $0.046 per vCPU-hour = $0.184/h on 4 vCPUs,
    not discounted for Spot.
    Cloud NAT while running: $0.0014/h gateway + $0.005/h address +
    $0.045/GiB carried.
    Boot disk, running or stopped: pd-balanced $0.10/GB-month = $5.00 a month
    at 50 GB.

    Running, machine + GPU + licence + NAT: g2 + L4 about $0.90/h ($0.61/h
    spot); n1 + T4 about $0.73/h ($0.51/h spot); the disk on top.
    Stopped: the disk alone.
  EOT
}
