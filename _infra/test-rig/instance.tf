locals {
  # setup.ps1 with its values filled in and its comment and blank lines taken
  # out, gzipped: EC2 caps user data at 16 KB and the script is larger.
  setup_script = replace(replace(templatefile("${path.module}/setup.ps1", {
    region             = var.region
    desktop_user       = var.desktop_user
    password_parameter = var.password_parameter
    display_width      = var.display_width
    display_height     = var.display_height
  }), "/(?m)^[ \\t]*#.*\\r?\\n/", ""), "/(?m)^[ \\t]*\\r?\\n/", "")

  # Two EC2Launch v2 tasks, both at every boot. startSsm first, so that the
  # Systems Manager agent (and so a Session Manager shell) is up while the
  # first-boot set-up runs, rather than after it (user data version 1.1 runs
  # its tasks before the agent otherwise). Then the script, unpacked and run
  # inline as the local system account, so that its exit code 3010 still asks
  # EC2Launch for a restart.
  user_data = <<-EOT
    version: 1.1
    tasks:
    - task: startSsm
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

  max_run_minutes = floor(var.max_run_hours * 60)
}

# What a changed start-up script does to a machine that exists: it replaces
# the machine. The script's set-up steps run once, at first boot, so a new
# script on the old machine would change nothing a reader could see; replacing
# is what `plan` shows ("replaced ... triggered by terraform_data.setup_script")
# and costs a new first-boot set-up (about 40 minutes) and a new desktop
# password. The trigger is the script's own text, not the user data's bytes, so
# a Terraform release that compresses differently replaces nothing.
resource "terraform_data" "setup_script" {
  input = sha256(local.setup_script)
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

  user_data = local.user_data

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    # The start-up script reads max-run-minutes from the instance's tags. The
    # desktop user cannot reach the metadata service at all (setup.ps1).
    instance_metadata_tags = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name = local.name
    # Read by the start-up script at every boot: how long after each boot the
    # machine shuts itself down. A tag, not part of the script, so a change is
    # applied in place and never restarts or replaces the machine.
    max-run-minutes = tostring(local.max_run_minutes)
  }

  lifecycle {
    # A new monthly Windows image changes the parameter's value; the machine
    # that exists is kept. `terraform apply -replace=aws_instance.test_rig`
    # moves it to the newest image (or to var.image_id) on purpose.
    #
    # user_data: a changed script replaces the machine (terraform_data above)
    # rather than being written into the one that exists, which the provider
    # would do by stopping and starting it.
    ignore_changes       = [ami, user_data]
    replace_triggered_by = [terraform_data.setup_script]

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

  lifecycle {
    # A change to the instance itself (a new size, say) is applied by the
    # provider as stop, change, then start, whatever this resource says. Made
    # again after any such change, this resource sets the wanted state again:
    # its creation starts or stops the machine as `running` says, and its
    # removal does nothing to the machine.
    replace_triggered_by = [aws_instance.test_rig]
  }
}
