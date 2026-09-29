# `terraform test` from _infra/test-rig. Every run is against a mocked AWS
# provider: `plan` and `apply` here create nothing and use no AWS credentials.
# The plan-only runs come first; the apply runs at the end share one mocked
# state, in order.
#
# The resources are in ../modules/aws-test-rig/, and an assertion can name a
# resource, a local or a precondition of the configuration a run tests only,
# never one inside a module it calls. So the runs that read the machine test
# that module directly (their `module` block), with the addresses it declares;
# the runs of this root's variable validations test this root. The module takes
# every input from the variables below, pinned to this root's defaults, which
# tests/variables.test.mjs checks, with this root passing each one on
# unchanged.

# Every variable pinned to its default, so that a terraform.tfvars in this
# directory (git-ignored, a person's own) cannot change what a run tests, and
# the module's inputs as this root sets them.
variables {
  region                 = "us-east-1"
  availability_zone      = null
  instance_type          = "g4dn.xlarge"
  image_id               = null
  disk_size_gb           = 50
  running                = true
  max_run_hours          = 4
  backstop_stop_schedule = "cron(0 9 * * ? *)"
  desktop_user           = "hiker"
  password_parameter     = "/test-rig/desktop-password"
  display_width          = 1920
  display_height         = 1080
  vpc_cidr               = "10.70.0.0/24"
  budget_enabled         = false
  budget_email           = null
  monthly_budget_usd     = 30
  tags                   = { purpose = "test-rig" }
}

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

  # As AWS reports it, a machine of this module exists, without a build tag
  # (a test cannot hand the mock this module's build, a hash of the script;
  # an untagged machine counts as this build). A run that needs no machine,
  # or one of an earlier build, says so.
  override_data {
    target = data.aws_instances.existing
    values = { ids = ["i-0123456789abcdef0"] }
  }

  override_data {
    target = data.aws_instance.existing
    values = { tags = { Name = "test-rig", purpose = "test-rig" } }
  }

  # The same answers at the addresses a run of this root (no `module` block)
  # reads them at, so that its plan goes through the module as the runs above
  # it do. `terraform validate` warns that half of these targets do not exist:
  # each half exists in the runs of one configuration only.
  override_data {
    target = module.test_rig.data.aws_partition.current
    values = { partition = "aws" }
  }

  override_data {
    target = module.test_rig.data.aws_caller_identity.current
    values = { account_id = "111122223333" }
  }

  override_data {
    target = module.test_rig.data.aws_ssm_parameter.windows
    values = { insecure_value = "ami-0123456789abcdef0" }
  }

  override_data {
    target = module.test_rig.data.aws_ec2_instance_type_offerings.allowed
    values = { locations = ["us-east-1d", "us-east-1b", "us-east-1a"] }
  }

  override_data {
    target = module.test_rig.data.aws_instances.existing
    values = { ids = ["i-0123456789abcdef0"] }
  }

  override_data {
    target = module.test_rig.data.aws_instance.existing
    values = { tags = { Name = "test-rig", purpose = "test-rig" } }
  }

  # The scheduler checks that its role is an ARN.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
}

run "defaults" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

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
    condition     = strcontains(local.setup_script, "$exitCode = 0\nSet-StopTimer\ntry {\n  New-Item")
    error_message = "The stop timer is armed first, before anything else can fail, the log included."
  }

  # New-LocalUser: "-Description ... The maximum length is 48 characters."
  # Read from the rendered script, so it runs without PowerShell.
  assert {
    condition = length(regexall("New-LocalUser [^\n]*-Description '([^']*)'", local.setup_script)) >= 1 && alltrue([
      for m in regexall("-Description '([^']*)'", local.setup_script) : length(m[0]) <= 48
    ])
    error_message = "Every -Description passed to New-LocalUser is at most 48 characters (Windows' limit)."
  }

  # Windows Installer: once any feature is named on the command line, only
  # the features named are installed, and ADDLOCAL is evaluated before REMOVE.
  # A REMOVE with no ADDLOCAL on a first install installs nothing and turns
  # into the package's uninstall path.
  assert {
    condition = length(regexall("(?m)^.*Install-Msi .*$", local.setup_script)) >= 1 && !anytrue([
      for line in regexall("(?m)^.*Install-Msi .*$", local.setup_script) : strcontains(line, "REMOVE=") && !strcontains(line, "ADDLOCAL=")
    ])
    error_message = "An MSI is installed with REMOVE= but no ADDLOCAL=: on a first install that installs nothing."
  }

  # The feature names passed to Amazon DCV server's MSI are the package's own:
  # the thirteen in the Feature table of nice-dcv-server-x64-Release-2025.0-20103.msi.
  assert {
    condition = alltrue([
      for name in flatten([for m in regexall("(?:ADDLOCAL|REMOVE)=([A-Za-z0-9,]+)", local.setup_script) : split(",", m[0])]) :
      contains([
        "ALL", "server", "webClient", "webrtc", "webauthn", "VC2017Redist", "iddDriver", "webcamDriver", "gamepadDriver",
        "audioMicDriver", "audioSpkDriver", "printerDriver", "virtualSmartcardDriver", "usbDriver",
      ], name)
    ])
    error_message = "A feature name passed to the DCV MSI is not one of the package's thirteen (2025.0-20103)."
  }

  assert {
    condition     = strcontains(local.setup_script, "'ADDLOCAL=server,webClient,VC2017Redist'") && !strcontains(local.setup_script, "iddDriver'")
    error_message = "DCV is installed with exactly the server, the web client and the runtime, and without the indirect display driver."
  }

  # An earlier attempt's MSI log is moved aside before the next install writes
  # its own (msiexec's /l*v overwrites).
  assert {
    condition     = length(regexall("(?s)function Install-Msi.*?if \\(Test-Path \\$msiLog\\) \\{ Move-Item \\$msiLog .*?Invoke-Installer 'msiexec.exe'", local.setup_script)) == 1
    error_message = "Install-Msi moves an earlier log aside before it runs msiexec."
  }

  # The console must be display_width x display_height with nobody connected:
  # the script asks DCV for it and the verification boot fails otherwise.
  assert {
    condition = (
      strcontains(local.setup_script, "$DisplayWidth = 1920\n$DisplayHeight = 1080") &&
      strcontains(local.setup_script, "@('set-display-layout', '--session', 'console', \"$want+0+0\")") &&
      strcontains(local.setup_script, "if ($size -ne \"$($DisplayWidth)x$($DisplayHeight)\") { throw \"The console is $size, not $($DisplayWidth)x$($DisplayHeight)\" }")
    )
    error_message = "The script sets the console to display_width x display_height and fails the verification boot if it is not."
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
    condition     = terraform_data.setup_script.input == local.setup_hash && local.setup_hash != sha256(local.setup_script)
    error_message = "A changed script, or a changed wrapper around it in the user data, is what replaces the machine."
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
    condition     = aws_subnet.test_rig.map_public_ip_on_launch == true
    error_message = "The machine's public IPv4 address comes from its subnet."
  }

  assert {
    condition     = length(aws_security_group.test_rig.ingress) == 0
    error_message = "The machine's security group admits nothing."
  }

  assert {
    condition     = length(aws_default_security_group.test_rig.ingress) == 0 && length(aws_default_security_group.test_rig.egress) == 0
    error_message = "The VPC's default security group has no rule at all."
  }

  # AWS's provider reads associate_public_ip_address back as false from a
  # stopped machine and replaces the machine on the difference; it must never
  # be set on the instance.
  assert {
    condition     = !strcontains(file("${path.module}/instance.tf"), "associate_public_ip_address =")
    error_message = "associate_public_ip_address must not be set on the instance: a stopped machine would be replaced."
  }

  assert {
    condition     = aws_iam_role_policy_attachments_exclusive.test_rig.policy_arns == toset(["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"])
    error_message = "The role's managed policies are exactly AWS's Session Manager baseline."
  }

  assert {
    condition     = aws_iam_role_policies_exclusive.test_rig.policy_names == toset(["test-rig"])
    error_message = "The role's inline policies are exactly this module's one."
  }

  assert {
    condition = jsondecode(aws_iam_role.test_rig.assume_role_policy).Statement == [
      { Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } },
    ]
    error_message = "The role's trust is exactly one statement: EC2 may take it."
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
    condition = jsondecode(aws_iam_role.backstop[0].assume_role_policy).Statement == [
      {
        Effect    = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" },
        Condition = { StringEquals = { "aws:SourceAccount" = "111122223333" } }
      },
    ]
    error_message = "The backstop role's trust is exactly one statement: this account's scheduler may take it."
  }

  assert {
    condition = (
      length(aws_iam_role_policy_attachments_exclusive.backstop[0].policy_arns) == 0 &&
      aws_iam_role_policies_exclusive.backstop[0].policy_names == toset(["test-rig-backstop-stop"])
    )
    error_message = "The backstop role has no managed policy and exactly one inline policy."
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

  module {
    source = "../modules/aws-test-rig"
  }

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

  module {
    source = "../modules/aws-test-rig"
  }

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

  module {
    source = "../modules/aws-test-rig"
  }

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

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    budget_enabled = true
  }

  expect_failures = [aws_budgets_budget.test_rig]
}

run "no_backstop" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

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

run "rejects_a_user_name_over_20_characters" {
  command = plan

  variables {
    desktop_user = "abcdefghijklmnopqrstu"
  }

  expect_failures = [var.desktop_user]
}

run "rejects_a_built_in_group_name" {
  command = plan

  variables {
    desktop_user = "users"
  }

  expect_failures = [var.desktop_user]
}

run "rejects_a_reserved_parameter_name" {
  command = plan

  variables {
    password_parameter = "/AWS/test-rig/desktop-password"
  }

  expect_failures = [var.password_parameter]
}

run "accepts_a_parameter_of_15_levels_and_900_characters" {
  command = plan

  variables {
    # 15 levels; the last pads the name to exactly 900 characters.
    password_parameter = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/${join("", [for i in range(871) : "x"])}"
  }

  assert {
    condition     = length(var.password_parameter) == 900 && length(split("/", var.password_parameter)) - 1 == 15
    error_message = "The boundary name is 900 characters in 15 levels, and is accepted."
  }
}

run "rejects_a_parameter_of_16_levels" {
  command = plan

  variables {
    password_parameter = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p"
  }

  expect_failures = [var.password_parameter]
}

run "rejects_a_parameter_of_901_characters" {
  command = plan

  variables {
    password_parameter = "/test-rig/${join("", [for i in range(891) : "x"])}"
  }

  expect_failures = [var.password_parameter]
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

# A first apply with running = false would stop the new machine seconds into
# Windows' own first boot: with no machine in AWS, it is refused.
run "created_stopped_is_refused" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running = false
  }

  override_data {
    target = data.aws_instances.existing
    values = { ids = [] }
  }

  expect_failures = [aws_instance.test_rig]
}

# --- Applied against the mocked provider, in order ---------------------------

# Created running, as it must be.
run "created_running" {
  command = apply

  module {
    source = "../modules/aws-test-rig"
  }

  override_data {
    target = data.aws_instances.existing
    values = { ids = [] }
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.state == "running"
    error_message = "A first apply creates the machine running."
  }
}

# Stopping the machine that exists is allowed.
run "stopped" {
  command = apply

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running = false
  }

  # What AWS reports for a stopped machine: no public address, no public name.
  override_resource {
    target = aws_instance.test_rig
    values = {
      associate_public_ip_address = false
      public_ip                   = ""
      public_dns                  = ""
      instance_state              = "stopped"
    }
  }

  assert {
    condition     = aws_instance.test_rig.id == run.created_running.instance_id && aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "Stopping the machine keeps it and stops it."
  }

  assert {
    condition     = aws_instance.test_rig.associate_public_ip_address == false
    error_message = "The machine reports no public address, as AWS reports a stopped one."
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
    condition = jsondecode(aws_iam_role_policy.backstop[0].policy).Statement == [
      { Effect = "Allow", Action = "ec2:StopInstances", Resource = aws_instance.test_rig.arn },
    ]
    error_message = "The backstop's role may stop this machine and do nothing else."
  }
}

# The machine exists, is stopped and reports no public address. A plan with
# the same variables must change nothing about it: the instance keeps its id
# (a replacement would leave it unknown here, and fail the run), and so does
# its running/stopped setting (any update to the instance would re-make it).
run "plan_while_stopped" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running = false
  }

  assert {
    condition     = aws_instance.test_rig.id == run.stopped.instance_id
    error_message = "A plan against the stopped machine replaces it."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.id == run.stopped.instance_state.id
    error_message = "A plan against the stopped machine changes it."
  }
}

# A new size is applied by the provider as stop, change, start. The machine is
# kept (same id), and the running/stopped setting is made again (a new id from
# the mock), which is what stops it again. A mocked provider cannot show the
# provider's own start and the setting's stop; it shows that Terraform plans
# and applies the setting again, with "stopped", after the change.
run "resized_while_stopped" {
  command = apply

  module {
    source = "../modules/aws-test-rig"
  }

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

  module {
    source = "../modules/aws-test-rig"
  }

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

# A changed script, with the machine meant to be stopped, is refused: the new
# machine would be stopped in the middle of Windows' own first boot. The
# existing machine (as AWS reports it) carries the old build.
run "script_changed_while_stopped_is_refused" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running       = false
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  override_data {
    target = data.aws_instances.existing
    values = { ids = ["i-0123456789abcdef0"] }
  }

  override_data {
    target = data.aws_instance.existing
    values = { tags = { Name = "test-rig", purpose = "test-rig", build = "an-earlier-build" } }
  }

  expect_failures = [aws_instance.test_rig]
}

# The same change with the machine running is allowed, and replaces it.
run "script_changed_while_running" {
  command = apply

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running       = true
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  override_data {
    target = data.aws_instances.existing
    values = { ids = ["i-0123456789abcdef0"] }
  }

  override_data {
    target = data.aws_instance.existing
    values = { tags = { Name = "test-rig", purpose = "test-rig", build = "an-earlier-build" } }
  }

  assert {
    condition     = aws_instance.test_rig.id != run.stopped.instance_id && aws_instance.test_rig.tags["build"] == local.build_key
    error_message = "A changed script replaces the machine, and the new one carries its build."
  }

  assert {
    condition     = aws_ec2_instance_state.test_rig.instance_id == aws_instance.test_rig.id && aws_ec2_instance_state.test_rig.state == "running"
    error_message = "The new machine is left running, to finish its set-up."
  }
}

# Stopping it afterwards, with the same script, is allowed and keeps it.
run "stopped_after_set_up" {
  command = apply

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    running       = false
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  assert {
    condition     = aws_instance.test_rig.id == run.script_changed_while_running.instance_id && aws_ec2_instance_state.test_rig.state == "stopped"
    error_message = "An unchanged script keeps the machine, and it can be stopped."
  }
}

# The region is chosen once: planning the same state in another region is
# refused, by the network that every regional resource here is built on.
run "region_changed_is_refused" {
  command = plan

  module {
    source = "../modules/aws-test-rig"
  }

  variables {
    region        = "us-west-2"
    running       = true
    instance_type = "g6.xlarge"
    max_run_hours = 1
    desktop_user  = "walker"
  }

  expect_failures = [aws_vpc.test_rig]
}
