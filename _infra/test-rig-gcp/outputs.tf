locals {
  gcloud_target = "${google_compute_instance.test_rig.name} --zone=${var.zone} --project=${var.gcp_project_id}"

  # us-west1 list prices in USD per hour, as of 2026-09-27, from the Cloud
  # Billing Catalog API (services 6F81-5844-456A Compute Engine and
  # E505-1604-58F8 Networking). The machine is its cores and memory:
  # g2-standard-4 = 4 x $0.024988 + 16 GB x $0.002927 (Spot 4 x $0.014990 +
  # 16 x $0.001756); n1-standard-4 = 4 x $0.031611 + 15 GB x $0.004237 (Spot
  # 4 x $0.018960 + 15 x $0.002541).
  machine_hourly_usd = {
    "g2-standard-4" = { standard = 0.146784, spot = 0.088056 }
    "n1-standard-4" = { standard = 0.189999, spot = 0.113955 }
  }
  gpu_hourly_usd = {
    "nvidia-l4-vws"       = { standard = 0.56004, spot = 0.336 }
    "nvidia-l4"           = { standard = 0.56004, spot = 0.336 }
    "nvidia-tesla-t4-vws" = { standard = 0.35, spot = 0.2095 }
    "nvidia-tesla-t4"     = { standard = 0.35, spot = 0.2095 }
  }
  # "Licensing Fee for NVIDIA Quadro Virtual Workstation (GPU cost)", per GPU,
  # on a -vws GPU only. Not discounted for Spot.
  vws_hourly_usd = endswith(var.gpu_type, "-vws") ? 0.2 : 0
  # "Licensing Fee for Windows Server 2025 Datacenter Edition on VM", $0.046
  # per vCPU; both machines have 4. Not discounted for Spot.
  windows_hourly_usd = 0.046 * 4
  # Cloud NAT while the machine runs: the gateway and the address it holds,
  # plus $0.045 per GiB carried.
  nat_hourly_usd = 0.0014 + 0.005
  # pd-balanced, running or stopped.
  disk_gb_month_usd = 0.1

  pricing = var.spot ? "spot" : "standard"
  running_hourly_usd = (
    local.machine_hourly_usd[var.machine_type][local.pricing] +
    local.gpu_hourly_usd[var.gpu_type][local.pricing] +
    local.vws_hourly_usd + local.windows_hourly_usd + local.nat_hourly_usd
  )
  disk_monthly_usd = var.boot_disk_size_gb * local.disk_gb_month_usd
}

output "instance_name" {
  description = "Name of the machine."
  value       = google_compute_instance.test_rig.name
}

output "instance_id" {
  description = "Compute Engine's numeric id for the machine: a new id is a new machine."
  value       = google_compute_instance.test_rig.instance_id
}

output "zone" {
  description = "Zone the machine runs in."
  value       = var.zone
}

output "build" {
  description = <<-EOT
    What the machine is built from (the settings whose change replaces it),
    as the machine's label `build`. A change here replaces the machine, which
    is refused while running is false (instance.tf).
  EOT
  value       = local.build_key
}

output "ssh_command" {
  description = <<-EOT
    Opens a shell (cmd.exe; run `powershell` for PowerShell) on the machine
    through IAP, as a local administrator the guest agent makes for the key
    gcloud pushes. Works a few minutes after the first boot, once the SSH
    package from first-boot specialisation is running.
  EOT
  value       = "gcloud compute ssh ${local.gcloud_target} --tunnel-through-iap"
}

output "setup_log_command" {
  description = "Follows the start-up script's log on the machine, over SSH through IAP."
  value       = "gcloud compute ssh ${local.gcloud_target} --tunnel-through-iap --command \"powershell -NoProfile -Command Get-Content -Wait -Tail 40 C:\\ProgramData\\test-rig\\setup.log\""
}

output "desktop_user" {
  description = "The Windows account the machine logs on automatically, whose desktop Chrome runs on."
  value       = var.desktop_user
}

output "desktop_password_command" {
  description = <<-EOT
    Prints the desktop user's password, which the machine made at its first
    boot and keeps in a file only SYSTEM and Administrators may read. Needed
    only to sign in as that user by hand, which moves its session off the
    machine's console (README.md).
  EOT
  value       = "gcloud compute ssh ${local.gcloud_target} --tunnel-through-iap --command \"powershell -NoProfile -Command Get-Content C:\\ProgramData\\test-rig\\desktop-password\""
}

output "rdp_tunnel_command" {
  description = <<-EOT
    Forwards the machine's Remote Desktop port to localhost:13389 through IAP.
    Point a Remote Desktop client at localhost:13389 while it runs, and sign
    in as an administrator from admin_password_command, never as the desktop
    user (README.md).
  EOT
  value       = "gcloud compute start-iap-tunnel ${local.gcloud_target} 3389 --local-host-port=localhost:13389"
}

output "admin_password_command" {
  description = "Creates (or resets) a Windows administrator for Remote Desktop and prints its password. The guest agent makes the password; it is never in Terraform state."
  value       = "gcloud compute reset-windows-password ${local.gcloud_target} --user=rdp-admin"
}

output "hourly_price" {
  description = "What the machine costs while it runs and while it is stopped."
  value       = <<-EOT
    As of 2026-09-27, Cloud Billing Catalog API (services 6F81-5844-456A and
    E505-1604-58F8), us-west1 list prices, USD, billed per second while
    running (one-minute minimum), ${local.pricing}.

    ${var.machine_type}:  ${format("$%.4f/h", local.machine_hourly_usd[var.machine_type][local.pricing])}
    ${var.gpu_type} GPU:  ${format("$%.4f/h", local.gpu_hourly_usd[var.gpu_type][local.pricing])}
    RTX Virtual Workstation licence:  ${format("$%.4f/h", local.vws_hourly_usd)}
    Windows Server licence, 4 vCPUs:  ${format("$%.4f/h", local.windows_hourly_usd)}
    Cloud NAT gateway and address:  ${format("$%.4f/h", local.nat_hourly_usd)}, plus $0.045/GiB carried
    Running, all together:  ${format("$%.4f/h", local.running_hourly_usd)}
    ${var.boot_disk_size_gb} GB pd-balanced disk, running or stopped:  ${format("$%.2f/month", local.disk_monthly_usd)}
  EOT
}
