# `terraform test` from _infra/test-rig. Every run is a plan against a mocked
# AWS provider: nothing is created and no AWS credentials are used.

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

  override_data {
    target = data.aws_iam_policy_document.assume_ec2
    values = { json = "{}" }
  }

  override_data {
    target = data.aws_iam_policy_document.test_rig
    values = { json = "{}" }
  }

  override_data {
    target = data.aws_iam_policy_document.assume_scheduler
    values = { json = "{}" }
  }

  override_data {
    target = data.aws_iam_policy_document.backstop
    values = { json = "{}" }
  }
}

variables {
  budget_email = "alerts@example.com"
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
    condition     = strcontains(local.setup_script, "$MaxRunMinutes = 240")
    error_message = "The stop timer defaults to 4 hours (240 minutes)."
  }

  assert {
    condition     = strcontains(local.setup_script, "Register-ScheduledTask -TaskName 'test-rig-stop'")
    error_message = "The start-up script arms the stop timer."
  }

  assert {
    condition     = length(local.user_data) <= 16384
    error_message = "User data must fit EC2's 16 KB."
  }

  assert {
    condition     = strcontains(local.user_data, "frequency: always") && strcontains(local.user_data, "runAs: localSystem")
    error_message = "The script runs at every boot, as the local system account."
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
    condition     = aws_ec2_instance_state.test_rig.state == "running"
    error_message = "The machine runs by default."
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
    condition     = length(aws_budgets_budget.test_rig) == 0
    error_message = "The budget is off by default."
  }
}

run "stopped" {
  command = plan

  variables {
    running = false
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "running = false stops the machine."
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
    condition     = strcontains(local.setup_script, "$MaxRunMinutes = 90")
    error_message = "max_run_hours reaches the script in minutes."
  }
}

run "budget_on" {
  command = plan

  variables {
    budget_enabled = true
  }

  assert {
    condition     = length(aws_budgets_budget.test_rig) == 1
    error_message = "budget_enabled creates the budget."
  }

  assert {
    condition     = one(aws_budgets_budget.test_rig[0].cost_filter).values == tolist(["user:purpose$test-rig"])
    error_message = "The budget counts only what carries purpose = test-rig."
  }
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
