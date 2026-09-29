# The module's outputs, passed up under the same names. Their full
# descriptions are in ../modules/aws-test-rig/outputs.tf.

output "instance_id" {
  description = "The machine."
  value       = module.test_rig.instance_id
}

output "region" {
  description = "Region the machine runs in."
  value       = module.test_rig.region
}

output "availability_zone" {
  description = "Zone the machine runs in."
  value       = module.test_rig.availability_zone
}

output "shell_command" {
  description = "Opens a PowerShell on the machine through Session Manager."
  value       = module.test_rig.shell_command
}

output "dcv_tunnel_command" {
  description = "Forwards the machine's Amazon DCV port to localhost:8443 through Session Manager."
  value       = module.test_rig.dcv_tunnel_command
}

output "instance_state" {
  description = "The running/stopped setting as Terraform last applied it, and the id of the resource that applied it."
  value       = module.test_rig.instance_state
}

output "build" {
  description = "What the machine is built from, as the instance tag `build`. A change here replaces the machine."
  value       = module.test_rig.build
}

output "desktop_user" {
  description = "The Windows account the machine logs on automatically, and the one to sign in to DCV as."
  value       = module.test_rig.desktop_user
}

output "desktop_password_command" {
  description = "Prints the desktop user's password from Parameter Store."
  value       = module.test_rig.desktop_password_command
}

output "hourly_price" {
  description = "What the machine costs while it runs and while it is stopped."
  value       = module.test_rig.hourly_price
}
