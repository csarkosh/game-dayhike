locals {
  # setup.ps1 with its values filled in and its comment and blank lines taken
  # out, gzipped: EC2 caps user data at 16 KB and the script is larger. The
  # user data is a short EC2Launch v2 task, run at every boot as the local
  # system account, that unpacks the script and runs it.
  setup_script = replace(replace(templatefile("${path.module}/setup.ps1", {
    region             = var.region
    desktop_user       = var.desktop_user
    password_parameter = var.password_parameter
    max_run_minutes    = floor(var.max_run_hours * 60)
    display_width      = var.display_width
    display_height     = var.display_height
  }), "/(?m)^[ \\t]*#.*\\r?\\n/", ""), "/(?m)^[ \\t]*\\r?\\n/", "")

  user_data = <<-EOT
    version: 1.1
    tasks:
    - task: executeScript
      inputs:
      - frequency: always
        type: powershell
        runAs: localSystem
        content: |-
          $zip = [Convert]::FromBase64String('${base64gzip(local.setup_script)}')
          $gzip = New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(, $zip)), [IO.Compression.CompressionMode]::Decompress)
          $setup = (New-Object IO.StreamReader($gzip)).ReadToEnd()
          . ([ScriptBlock]::Create($setup))
          exit $exitCode
  EOT
}

resource "aws_instance" "test_rig" {
  ami           = var.image_id != null ? var.image_id : data.aws_ssm_parameter.windows.insecure_value
  instance_type = var.instance_type

  subnet_id                   = aws_subnet.test_rig.id
  vpc_security_group_ids      = [aws_security_group.test_rig.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.test_rig.name

  # A shutdown from inside Windows (setup.ps1's timer, or anyone's) stops the
  # machine and keeps its disk; it never terminates it.
  instance_initiated_shutdown_behavior = "stop"

  # Changing it (a new max_run_hours, say) stops and starts the machine; the
  # script runs at every boot, so the new value takes effect then.
  user_data                   = local.user_data
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = local.name }

  lifecycle {
    # A new monthly Windows image changes the parameter's value; the machine
    # that exists is kept. `terraform apply -replace=aws_instance.test_rig`
    # moves it to the newest image (or to var.image_id) on purpose.
    ignore_changes = [ami]

    precondition {
      condition     = length(local.user_data) <= 16384
      error_message = "The start-up script is ${length(local.user_data)} bytes; EC2 user data is capped at 16384."
    }
  }

  depends_on = [
    aws_iam_role_policy.test_rig,
    aws_iam_role_policy_attachment.ssm_core,
    aws_route_table_association.test_rig,
  ]
}

# Running or stopped, without destroying anything. A stopped machine bills its
# disk and nothing else. When the machine has stopped itself, the next `apply`
# (with running = true) starts it again.
resource "aws_ec2_instance_state" "test_rig" {
  instance_id = aws_instance.test_rig.id
  state       = var.running ? "running" : "stopped"
}
