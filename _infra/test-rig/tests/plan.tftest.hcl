# `terraform test` from _infra/test-rig. Every run is against a mocked AWS
# provider: `plan` and `apply` here create nothing and use no AWS credentials.
# The plan-only runs come first; the apply runs at the end share one mocked
# state, in order.

mock_provider "aws" {
  override_data {
    target = data.aws_partition.current
    values = { partition = "aws" }
  }

  # AWS's documentation placeholder, not a real account.
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "111122223333" }
  }

  override_data {
    target = data.aws_ssm_parameter.windows
    values = { insecure_value = "ami-0123456789abcdef0" }
  }

  override_data {
    target = data.aws_ec2_instance_type_offerings.allowed
    values = { locations = ["us-east-1d", "us-east-1b", "us-east-1a"] }
  }

  # The scheduler checks that its role is an ARN.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
}

run "defaults" {
  command = plan

  assert {
    condition     = aws_instance.test_rig.instance_type == "g4dn.xlarge"
    error_message = "The default machine is g4dn.xlarge."
  }

  assert {
    condition     = aws_instance.test_rig.ami == "ami-0123456789abcdef0"
    error_message = "The machine boots the image the public Windows Server 2025 parameter names."
  }

  assert {
    condition     = aws_instance.test_rig.instance_initiated_shutdown_behavior == "stop"
    error_message = "A shutdown from inside Windows must stop the machine, never terminate it."
  }

  assert {
    condition     = aws_instance.test_rig.tags["max-run-minutes"] == "240" && aws_instance.test_rig.metadata_options[0].instance_metadata_tags == "enabled"
    error_message = "The stop timer's 4 hours (240 minutes) reach the machine as a tag it can read."
  }

  assert {
    condition     = strcontains(local.setup_script, "New-ScheduledTaskTrigger -AtStartup") && strcontains(local.setup_script, "$atStartup.Delay = $plan.Delay")
    error_message = "The stop task has a start-up trigger with a delay."
  }

  assert {
    condition     = strcontains(local.setup_script, "try {\n  Set-StopTimer\n  Protect-Root\n")
    error_message = "The stop timer is armed first, before anything that can take long."
  }

  assert {
    condition     = !strcontains(local.setup_script, "StartWhenAvailable")
    error_message = "The stop task must not start late: a missed shutdown would fire on a later boot."
  }

  assert {
    condition     = length(local.user_data) <= 16384
    error_message = "User data must fit EC2's 16 KB."
  }

  assert {
    condition     = strcontains(local.user_data, "tasks:\n- task: startSsm\n- task: executeScript\n")
    error_message = "The Systems Manager agent starts before the script runs."
  }

  assert {
    condition     = strcontains(local.user_data, "frequency: always") && strcontains(local.user_data, "runAs: localSystem")
    error_message = "The script runs at every boot, as the local system account."
  }

  assert {
    condition     = terraform_data.setup_script.input == sha256(local.setup_script)
    error_message = "A changed script is what replaces the machine."
  }

  assert {
    condition     = aws_instance.test_rig.metadata_options[0].http_tokens == "required"
    error_message = "IMDSv2 is required."
  }

  assert {
    condition = (
      aws_instance.test_rig.root_block_device[0].volume_type == "gp3" &&
      aws_instance.test_rig.root_block_device[0].volume_size == 50 &&
      aws_instance.test_rig.root_block_device[0].encrypted == true &&
      aws_instance.test_rig.root_block_device[0].delete_on_termination == true
    )
    error_message = "The disk is 50 GB gp3, encrypted, and deleted with the machine."
  }

  assert {
    condition     = aws_instance.test_rig.associate_public_ip_address == true
    error_message = "The machine has a public IPv4 address for outbound traffic."
  }

  assert {
    condition     = length(aws_security_group.test_rig.ingress) == 0
    error_message = "The machine's security group admits nothing."
  }

  assert {
    condition     = length(aws_default_security_group.test_rig.ingress) == 0 && length(aws_default_security_group.test_rig.egress) == 0
    error_message = "The VPC's default security group has no rule at all."
  }

  assert {
    condition     = aws_iam_role_policy_attachment.ssm_core.policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    error_message = "The only managed policy is AWS's Session Manager baseline."
  }

  assert {
    condition     = jsondecode(aws_iam_role.test_rig.assume_role_policy).Statement[0].Principal.Service == "ec2.amazonaws.com"
    error_message = "Only EC2 may take the machine's role."
  }

  # What the machine may do: read two buckets and write one parameter.
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.test_rig.policy).Statement : { action = s.Action, resource = s.Resource } if s.Effect == "Allow"
      ] == [
      { action = "s3:GetObject", resource = "arn:aws:s3:::ec2-windows-nvidia-drivers/*" },
      { action = "s3:GetObject", resource = "arn:aws:s3:::dcv-license.us-east-1/*" },
      { action = "ssm:PutParameter", resource = "arn:aws:ssm:us-east-1:111122223333:parameter/test-rig/desktop-password" },
    ]
    error_message = "The instance role allows exactly: read the GRID driver bucket, read DCV's licence bucket, write the password parameter."
  }

  # What it is denied: reading any parameter.
  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.test_rig.policy).Statement : { action = s.Action, resource = s.Resource } if s.Effect == "Deny"
      ] == [
      { action = ["ssm:GetParameter", "ssm:GetParameterHistory", "ssm:GetParameters", "ssm:GetParametersByPath"], resource = "*" },
    ]
    error_message = "The instance role is denied reading every parameter."
  }

  assert {
    condition     = aws_subnet.test_rig.availability_zone == "us-east-1a"
    error_message = "The subnet goes in the first zone, by name, that offers every allowed size."
  }

  assert {
    condition     = length(aws_scheduler_schedule.backstop) == 1 && aws_scheduler_schedule.backstop[0].schedule_expression == "cron(0 9 * * ? *)"
    error_message = "The daily backstop stop is on by default, at 09:00 UTC."
  }

  assert {
    condition     = jsondecode(aws_iam_role.backstop[0].assume_role_policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == "111122223333"
    error_message = "Only this account's scheduler may take the backstop's role."
  }

  assert {
    condition     = length(aws_budgets_budget.test_rig) == 0
    error_message = "The budget is off by default, and needs no email address then."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.state == "running"
    error_message = "The machine runs by default."
  }
}

run "l4" {
  command = plan

  variables {
    instance_type = "g6.xlarge"
  }

  assert {
    condition     = aws_instance.test_rig.instance_type == "g6.xlarge"
    error_message = "g6.xlarge is selectable."
  }

  assert {
    condition     = aws_subnet.test_rig.availability_zone == "us-east-1a"
    error_message = "Changing the size does not move the subnet."
  }
}

run "ninety_minutes" {
  command = plan

  variables {
    max_run_hours = 1.5
  }

  assert {
    condition     = aws_instance.test_rig.tags["max-run-minutes"] == "90"
    error_message = "max_run_hours reaches the machine in minutes."
  }
}

run "budget_on" {
  command = plan

  variables {
    budget_enabled = true
    budget_email   = "alerts@example.com"
  }

  assert {
    condition     = one(aws_budgets_budget.test_rig[0].cost_filter).values == tolist(["user:purpose$test-rig"])
    error_message = "The budget counts only what carries purpose = test-rig."
  }

  assert {
    condition     = aws_budgets_budget.test_rig[0].limit_amount == "30.00"
    error_message = "The budget is $30 a month."
  }

  assert {
    condition     = toset([for n in aws_budgets_budget.test_rig[0].notification : "${n.notification_type}:${n.threshold}"]) == toset(["ACTUAL:80", "ACTUAL:100", "FORECASTED:100"])
    error_message = "The budget alerts at 80 % and 100 % of actual spend and 100 % forecast."
  }
}

run "budget_needs_email" {
  command = plan

  variables {
    budget_enabled = true
  }

  expect_failures = [aws_budgets_budget.test_rig]
}

run "no_backstop" {
  command = plan

  variables {
    backstop_stop_schedule = null
  }

  assert {
    condition     = length(aws_scheduler_schedule.backstop) == 0 && length(aws_iam_role.backstop) == 0
    error_message = "A null schedule removes the backstop and its role."
  }
}

run "rejects_other_sizes" {
  command = plan

  variables {
    instance_type = "g5.xlarge"
  }

  expect_failures = [var.instance_type]
}

run "rejects_other_regions" {
  command = plan

  variables {
    region = "eu-west-1"
  }

  expect_failures = [var.region]
}

run "rejects_no_stop" {
  command = plan

  variables {
    max_run_hours = 0
  }

  expect_failures = [var.max_run_hours]
}

run "rejects_part_minutes" {
  command = plan

  variables {
    max_run_hours = 0.3333
  }

  expect_failures = [var.max_run_hours]
}

# --- Applied against the mocked provider, in order ---------------------------

run "stopped" {
  command = apply

  variables {
    running = false
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "running = false stops the machine."
  }

  assert {
    condition     = aws_instance.test_rig.vpc_security_group_ids == toset([aws_security_group.test_rig.id])
    error_message = "The machine has only its own security group."
  }

  # The backstop may stop this one machine and is pointed at it.
  assert {
    condition     = jsondecode(aws_scheduler_schedule.backstop[0].target[0].input).InstanceIds == [aws_instance.test_rig.id]
    error_message = "The scheduled stop's target is this machine."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.backstop[0].policy).Statement[0].Action == "ec2:StopInstances" &&
      jsondecode(aws_iam_role_policy.backstop[0].policy).Statement[0].Resource == aws_instance.test_rig.arn &&
      length(jsondecode(aws_iam_role_policy.backstop[0].policy).Statement) == 1
    )
    error_message = "The backstop's role may stop this machine and do nothing else."
  }
}

# A new size is applied by the provider as stop, change, start. The machine is
# kept (same id), and the running/stopped setting is made again (a new id from
# the mock), which is what stops it again. A mocked provider cannot show the
# provider's own start and the setting's stop; it shows that Terraform plans
# and applies the setting again, with "stopped", after the change.
run "resized_while_stopped" {
  command = apply

  variables {
    running       = false
    instance_type = "g6.xlarge"
  }

  assert {
    condition     = aws_instance.test_rig.id == run.stopped.instance_id
    error_message = "A new size keeps the machine."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.id != run.stopped.instance_state.id && aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "After a change to the machine, the stopped setting is applied again."
  }
}

# A new timer changes the tag in place: the machine is kept, and the setting is
# applied again all the same.
run "timer_changed_while_stopped" {
  command = apply

  variables {
    running       = false
    instance_type = "g6.xlarge"
    max_run_hours = 1
  }

  assert {
    condition     = aws_instance.test_rig.id == run.stopped.instance_id && aws_instance.test_rig.tags["max-run-minutes"] == "60"
    error_message = "A new timer changes the tag and keeps the machine."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.id != run.resized_while_stopped.instance_state.id && aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "After the tag change, the stopped setting is applied again."
  }
}

# A changed script replaces the machine, and the new one is left stopped.
run "script_changed_while_stopped" {
  command = apply

  variables {
    running       = false
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  assert {
    condition     = aws_instance.test_rig.id != run.stopped.instance_id
    error_message = "A changed script replaces the machine."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.instance_id == aws_instance.test_rig.id && aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "The new machine is left stopped."
  }
}

# The same script again: nothing is replaced.
run "same_script_again" {
  command = apply

  variables {
    running       = false
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  assert {
    condition     = aws_instance.test_rig.id == run.script_changed_while_stopped.instance_id
    error_message = "An unchanged script keeps the machine."
  }
}
