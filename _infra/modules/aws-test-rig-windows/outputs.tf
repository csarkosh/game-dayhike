locals {
  # On-demand, Windows with its licence, shared tenancy. Identical in
  # us-east-1 and us-west-2. As of 2026-09-25, from the AWS Price List API
  # (service AmazonEC2, publication 2026-09-25T17:45:21Z).
  hourly_usd = {
    "g4dn.xlarge" = 0.71
    "g6.xlarge"   = 0.9888
  }

  public_ipv4_hourly_usd = 0.005
  gp3_gb_month_usd       = 0.08

  running_hourly_usd = local.hourly_usd[var.instance_type] + local.public_ipv4_hourly_usd
  disk_monthly_usd   = var.disk_size_gb * local.gp3_gb_month_usd

  ssm = "aws ssm start-session --region ${var.region} --target ${aws_instance.test_rig.id}"
}

output "instance_id" {
  description = "The machine."
  value       = aws_instance.test_rig.id
}

output "region" {
  description = "Region the machine runs in."
  value       = var.region
}

output "availability_zone" {
  description = "Zone the machine runs in."
  value       = aws_subnet.test_rig.availability_zone
}

output "shell_command" {
  description = <<-EOT
    Opens a PowerShell on the machine through Session Manager, as the local
    administrator ssm-user. Needs the Session Manager plugin for the AWS CLI on
    this side. Reachable a few minutes after each start, while the first-boot
    set-up is still running: `Get-Content -Wait C:\ProgramData\test-rig\setup.log`
    follows it.
  EOT
  value       = local.ssm
}

output "dcv_tunnel_command" {
  description = <<-EOT
    Forwards the machine's Amazon DCV port to localhost:8443 through Session
    Manager. While it runs, open https://localhost:8443 in a browser (DCV's web
    client; the certificate is DCV's own, self-signed) or point the DCV client
    at localhost:8443, and sign in as desktop_user with the password below.
  EOT
  value       = "${local.ssm} --document-name AWS-StartPortForwardingSession --parameters portNumber=8443,localPortNumber=8443"
}

output "instance_state" {
  description = <<-EOT
    The running/stopped setting as Terraform last applied it, and the id of
    the resource that applied it (in AWS, the instance id).
    _infra/test-rig-aws-windows/tests/ runs against a mocked provider, which gives each new
    resource a new id, and reads this to see the setting applied again after a
    change to the machine.
  EOT
  value = {
    state = aws_ec2_instance_state.test_rig.state
    id    = aws_ec2_instance_state.test_rig.id
  }
}

output "build" {
  description = <<-EOT
    What the machine is built from (its start-up script and network), as the
    instance tag `build`. A change here replaces the machine, which is refused
    while running is false (instance.tf).
  EOT
  value       = local.build_key
}

output "desktop_user" {
  description = "The Windows account the machine logs on automatically, and the one to sign in to DCV as."
  value       = var.desktop_user
}

output "desktop_password_command" {
  description = "Prints the desktop user's password, which the machine made at its first boot and wrote to Parameter Store."
  value       = "aws ssm get-parameter --region ${var.region} --name ${var.password_parameter} --with-decryption --query Parameter.Value --output text"
}

output "hourly_price" {
  description = "What the machine costs while it runs and while it is stopped."
  value       = <<-EOT
    As of 2026-09-25, AWS Price List API (services AmazonEC2 and AmazonVPC),
    ${var.region}, USD, billed per second while running (one-minute minimum).

    ${var.instance_type}, Windows, on demand:  ${format("$%.4f/h", local.hourly_usd[var.instance_type])}
    Public IPv4 address, while running:  ${format("$%.4f/h", local.public_ipv4_hourly_usd)}
    Running, both together:              ${format("$%.4f/h", local.running_hourly_usd)}
    ${var.disk_size_gb} GB gp3 disk, running or stopped:  ${format("$%.2f/month", local.disk_monthly_usd)} (${format("$%.2f", local.gp3_gb_month_usd)}/GB-month)
    Session Manager, Amazon DCV on EC2, the budget: no charge.
  EOT
}
