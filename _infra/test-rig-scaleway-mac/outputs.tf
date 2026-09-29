# The module's outputs, passed up under the same names. Their full
# descriptions are in ../modules/scaleway-test-rig-mac/outputs.tf.

output "macs" {
  description = "Each Mac: address, login, SSH command, Screen Sharing port, and the earliest time it can be deleted."
  value       = module.test_rig.macs
}

output "server_ids" {
  description = "Each Mac's zoned id, for scaleway-macs.sh list to set against the API's own listing."
  value       = module.test_rig.server_ids
}

output "passwords" {
  description = "Each Mac's admin password, in the order of `macs`. Sensitive, but stored in clear in the state; see README.md."
  value       = module.test_rig.passwords
  sensitive   = true
}

output "day_cost" {
  description = "What the Macs cost for their minimum day, from Scaleway's public catalogue."
  value       = module.test_rig.day_cost
}
