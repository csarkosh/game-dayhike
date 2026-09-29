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

  # The start-up script's text and the user data around it, without the
  # compressed payload: a change to either replaces the machine; a Terraform
  # release that compresses differently does not.
  setup_hash = sha256(join("\n", [local.setup_script, replace(local.user_data, base64gzip(local.setup_script), "")]))

  # Everything whose change replaces the machine, recorded on it as the tag
  # `build`, so that a later plan can tell, from the machine that exists, that
  # it is about to be replaced.
  build_key = sha256(jsonencode({ setup = local.setup_hash, vpc_cidr = var.vpc_cidr }))
}

# What a changed start-up script does to a machine that exists: it replaces
# the machine. The script's set-up steps run once, at first boot, so a new
# script on the old machine would change nothing a reader could see; replacing
# is what `plan` shows ("replaced ... triggered by terraform_data.setup_script")
# and costs a new first-boot set-up (about 40 minutes) and a new desktop
# password.
resource "terraform_data" "setup_script" {
  input = local.setup_hash
}

# The machines of this module that exist now, read from AWS at every plan, and
# the build each was made from.
data "aws_instances" "existing" {
  instance_tags        = { Name = local.name, purpose = var.tags.purpose }
  instance_state_names = ["pending", "running", "stopping", "stopped"]
}

data "aws_instance" "existing" {
  for_each    = toset(data.aws_instances.existing.ids == null ? [] : data.aws_instances.existing.ids)
  instance_id = each.key
}

locals {
  # A machine of this module exists, as AWS reports it.
  machine_exists = length(data.aws_instance.existing) > 0

  # A machine exists whose build differs from this one: this apply replaces
  # it. A machine without the tag (every machine this module makes has it; only
  # a hand can remove it) cannot be judged and counts as this build.
  replaces_machine = anytrue([for m in data.aws_instance.existing : lookup(m.tags, "build", local.build_key) != local.build_key])
}

resource "aws_instance" "test_rig" {
  ami           = var.image_id != null ? var.image_id : data.aws_ssm_parameter.windows.insecure_value
  instance_type = var.instance_type

  # No associate_public_ip_address: the public address comes from the
  # subnet's map_public_ip_on_launch (network.tf says why).
  subnet_id              = aws_subnet.test_rig.id
  vpc_security_group_ids = [aws_security_group.test_rig.id]
  iam_instance_profile   = aws_iam_instance_profile.test_rig.name

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
    # What the machine was built from (locals above).
    build = local.build_key
  }

  lifecycle {
    # A new monthly Windows image changes the parameter's value; the machine
    # that exists is kept. `terraform apply
    # -replace=module.test_rig.aws_instance.test_rig` (from _infra/test-rig-aws-windows/)
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

    # A new machine must never be stopped before its first set-up has
    # finished: stopped seconds into Windows' own first boot, EC2 hard-stops it
    # after a few minutes, and it may never boot again. So with running = false
    # the apply is allowed only to stop a machine that already exists and is
    # not being replaced; creating one (a first apply, an apply after a
    # destroy) or replacing one is refused.
    precondition {
      condition     = var.running || (local.machine_exists && !local.replaces_machine)
      error_message = "running is false, and this apply ${local.machine_exists ? "replaces the machine (its start-up script, or vpc_cidr, changed)" : "creates the machine"}. A new machine must never be stopped before its first-boot set-up has finished: stopped in the middle of Windows' own first boot, it may never boot again. Apply with running = true, wait for the set-up to finish (C:\\ProgramData\\test-rig\\verified exists), then apply with running = false."
    }
  }

  depends_on = [
    aws_iam_role_policy.test_rig,
    aws_iam_role_policy_attachments_exclusive.test_rig,
    aws_iam_role_policies_exclusive.test_rig,
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
