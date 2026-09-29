# The module's outputs, passed up under the same names. Their full
# descriptions are in ../modules/gcp-test-rig-windows/outputs.tf.

output "instance_name" {
  description = "Name of the machine."
  value       = module.test_rig.instance_name
}

output "instance_id" {
  description = "Compute Engine's numeric id for the machine: a new id is a new machine."
  value       = module.test_rig.instance_id
}

output "zone" {
  description = "Zone the machine runs in."
  value       = module.test_rig.zone
}

output "build" {
  description = "What the machine is built from, as its label `build`. A change here replaces the machine."
  value       = module.test_rig.build
}

output "ssh_command" {
  description = "Opens a shell on the machine through IAP."
  value       = module.test_rig.ssh_command
}

output "setup_log_command" {
  description = "Follows the start-up script's log on the machine, over SSH through IAP."
  value       = module.test_rig.setup_log_command
}

output "desktop_user" {
  description = "The Windows account the machine logs on automatically, whose desktop Chrome runs on."
  value       = module.test_rig.desktop_user
}

output "desktop_password_command" {
  description = "Prints the desktop user's password, which the machine made at its first boot."
  value       = module.test_rig.desktop_password_command
}

output "rdp_tunnel_command" {
  description = "Forwards the machine's Remote Desktop port to localhost:13389 through IAP."
  value       = module.test_rig.rdp_tunnel_command
}

output "admin_password_command" {
  description = "Creates (or resets) a Windows administrator for Remote Desktop and prints its password."
  value       = module.test_rig.admin_password_command
}

output "hourly_price" {
  description = "What the machine costs while it runs and while it is stopped."
  value       = module.test_rig.hourly_price
}
