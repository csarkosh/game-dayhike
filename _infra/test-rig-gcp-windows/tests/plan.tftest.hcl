# `terraform test` from _infra/test-rig-gcp-windows. Every run is against a mocked
# Google provider: `plan` and `apply` here create nothing and use no Google
# credentials. The plan-only runs come first; the apply runs at the end share
# one mocked state, in order.
#
# A mocked provider does not run the Google provider's own plan logic or read
# Google Cloud. It cannot show: that the read of the machine fails when there
# is no machine (the refusal of a machine created stopped; README.md shows it
# against the real project), which changes the provider answers with a
# replacement (its schema marks them; the `build` label below lists them),
# or that a real stopped machine plans no change (the first run's steps).
#
# The resources are in ../modules/gcp-test-rig-windows/, and an assertion can name a
# resource, a local, an output or a precondition of the configuration a run
# tests only, never one inside a module it calls. So the runs that read the
# machine test that module directly (their `module` block), with the addresses
# it declares; the runs of this root's variable validations test this root.

# Every variable pinned to its default, so that a terraform.tfvars in this
# directory (git-ignored, a person's own) cannot change what a run tests, and
# the module's inputs as this root sets them. tests/variables.test.mjs checks
# that each value here is variables.tf's default, and that this root passes
# each one on unchanged, so the runs below still test the defaults.
variables {
  gcp_project_id         = "fps-csarko"
  gcp_region             = "us-west1"
  zone                   = "us-west1-a"
  instance_name          = "test-rig"
  machine_type           = "g2-standard-4"
  gpu_type               = "nvidia-l4-vws"
  image                  = "projects/windows-cloud/global/images/family/windows-2025"
  baked_image            = ""
  boot_disk_size_gb      = 50
  boot_disk_type         = "pd-balanced"
  spot                   = false
  running                = true
  max_run_hours          = 4
  backstop_stop_schedule = "0 9 * * *"
  desktop_user           = "hiker"
  enable_display         = false
  subnet_cidr            = "10.60.0.0/24"
  direct_access_cidrs    = []
  billing_account_id     = ""
  monthly_budget_usd     = 45
  labels                 = { purpose = "test-rig" }
}

# The budget's own provider (main.tf), mocked like the other: no run reaches
# Google or reads a credential.
mock_provider "google" {
  alias = "billing"
}

mock_provider "google" {
  # The machine as Google reports it, when a plan reads it (running = false):
  # it exists, without a build label (a test cannot hand the mock this
  # module's build, a hash; an unlabelled machine counts as this build). A run
  # that needs a machine of an earlier build says so.
  override_data {
    target = data.google_compute_instance.existing
    values = {
      labels           = { purpose = "test-rig" }
      effective_labels = { purpose = "test-rig" }
    }
  }

  # The firewall rules and the machine name the service account by its email.
  mock_resource "google_service_account" {
    defaults = { email = "test-rig@example.iam.gserviceaccount.com" }
  }

  mock_resource "google_compute_resource_policy" {
    defaults = { self_link = "https://www.googleapis.com/compute/v1/projects/fps-csarko/regions/us-west1/resourcePolicies/test-rig-backstop-stop" }
  }
}

run "defaults" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  assert {
    condition = (
      google_compute_instance.test_rig.machine_type == "g2-standard-4" &&
      google_compute_instance.test_rig.zone == "us-west1-a" &&
      google_compute_instance.test_rig.guest_accelerator[0].type == "nvidia-l4-vws" &&
      google_compute_instance.test_rig.guest_accelerator[0].count == 1
    )
    error_message = "The default machine is g2-standard-4 with one L4 carrying the RTX Virtual Workstation licence, in us-west1-a."
  }

  assert {
    condition     = google_compute_instance.test_rig.desired_status == "RUNNING"
    error_message = "The machine runs by default."
  }

  assert {
    condition     = length(data.google_compute_instance.existing) == 0
    error_message = "A plan that runs the machine does not read it (a first apply must not need a machine to exist)."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.scheduling[0].on_host_maintenance == "TERMINATE" &&
      google_compute_instance.test_rig.scheduling[0].automatic_restart == false &&
      google_compute_instance.test_rig.scheduling[0].provisioning_model == "STANDARD" &&
      google_compute_instance.test_rig.scheduling[0].instance_termination_action == "STOP" &&
      google_compute_instance.test_rig.scheduling[0].max_run_duration[0].seconds == 14400
    )
    error_message = "Standard, stopped on host maintenance and never restarted by Google, and stopped (not deleted) 4 hours (14400 s) after each start."
  }

  assert {
    condition = (
      length(google_compute_resource_policy.backstop) == 1 &&
      google_compute_resource_policy.backstop[0].instance_schedule_policy[0].vm_stop_schedule[0].schedule == "0 9 * * *" &&
      google_compute_resource_policy.backstop[0].instance_schedule_policy[0].time_zone == "UTC" &&
      length(google_compute_resource_policy.backstop[0].instance_schedule_policy[0].vm_start_schedule) == 0 &&
      length(google_compute_instance.test_rig.resource_policies) == 1
    )
    error_message = "The daily backstop stops the machine at 09:00 UTC, never starts it, and is attached to it."
  }

  assert {
    condition     = length(google_compute_instance.test_rig.network_interface[0].access_config) == 0
    error_message = "The machine has no external address."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.labels["purpose"] == "test-rig" &&
      google_compute_instance.test_rig.labels["build"] == local.build_key &&
      length(local.build_key) == 32 &&
      google_compute_instance.test_rig.boot_disk[0].initialize_params[0].labels == tomap({ purpose = "test-rig" })
    )
    error_message = "The machine carries purpose = test-rig and its build (32 characters, within a label's 63); its disk carries purpose = test-rig."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.boot_disk[0].initialize_params[0].image == "projects/windows-cloud/global/images/family/windows-2025" &&
      google_compute_instance.test_rig.boot_disk[0].initialize_params[0].size == 50 &&
      google_compute_instance.test_rig.boot_disk[0].initialize_params[0].type == "pd-balanced" &&
      google_compute_instance.test_rig.boot_disk[0].auto_delete == true
    )
    error_message = "The disk is 50 GB pd-balanced from the Windows Server 2025 family, deleted with the machine."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.shielded_instance_config[0].enable_secure_boot &&
      google_compute_instance.test_rig.shielded_instance_config[0].enable_vtpm &&
      google_compute_instance.test_rig.shielded_instance_config[0].enable_integrity_monitoring
    )
    error_message = "Shielded VM: Secure Boot, vTPM and integrity monitoring."
  }

  assert {
    condition     = google_compute_router_nat.test_rig.nat_ip_allocate_option == "AUTO_ONLY" && google_compute_subnetwork.test_rig.private_ip_google_access
    error_message = "Outbound goes through Cloud NAT; Google's endpoints through Private Google Access."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.metadata["windows-startup-script-ps1"] == local.startup_script &&
      strcontains(local.startup_script, "$DesktopUser = 'hiker'") &&
      strcontains(local.startup_script, "$RequireVws = '1' -eq '1'") &&
      google_compute_instance.test_rig.metadata["enable-windows-ssh"] == "TRUE" &&
      google_compute_instance.test_rig.metadata["block-project-ssh-keys"] == "TRUE" &&
      google_compute_instance.test_rig.metadata["sysprep-specialize-script-cmd"] == "googet -noconfirm=true install google-compute-engine-ssh"
    )
    error_message = "The start-up script, with the desktop user and the licence requirement filled in, Google's SSH set-up, and the block on project-wide SSH keys are in the metadata."
  }

  assert {
    condition     = length(local.startup_script) <= 262144
    error_message = "The start-up script fits Google's 256 KB."
  }

  assert {
    condition     = length(google_billing_budget.test_rig) == 0 && length(google_project_service.billingbudgets) == 0
    error_message = "The budget is off by default."
  }

  assert {
    condition = alltrue([
      for s in [google_project_service.compute, google_project_service.iap, google_project_service.iam] : s.disable_on_destroy == false
    ])
    error_message = "A destroy never switches an API off."
  }

  assert {
    condition     = strcontains(output.hourly_price, "Running, all together:  $1.0972/h") && strcontains(output.hourly_price, "$5.00/month")
    error_message = "The default machine runs at $1.0972 an hour (machine $0.1468 + L4 $0.5600 + workstation licence $0.2000 + Windows $0.1840 + NAT $0.0064), and its disk costs $5.00 a month."
  }
}

run "plain_l4" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    gpu_type = "nvidia-l4"
  }

  assert {
    condition     = google_compute_instance.test_rig.guest_accelerator[0].type == "nvidia-l4" && strcontains(local.startup_script, "$RequireVws = '0' -eq '1'")
    error_message = "The plain L4 is selectable, and its set-up check does not require the workstation licence."
  }

  assert {
    condition     = output.build != run.defaults.build
    error_message = "A new GPU is a new build: the provider replaces the machine."
  }

  assert {
    condition     = strcontains(output.hourly_price, "Running, all together:  $0.8972/h")
    error_message = "Without the licence the machine runs at $0.8972 an hour."
  }
}

run "t4" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    machine_type = "n1-standard-4"
    gpu_type     = "nvidia-tesla-t4-vws"
  }

  assert {
    condition     = google_compute_instance.test_rig.machine_type == "n1-standard-4" && google_compute_instance.test_rig.guest_accelerator[0].type == "nvidia-tesla-t4-vws"
    error_message = "n1-standard-4 with a T4 is selectable by variables alone."
  }

  assert {
    condition     = strcontains(output.hourly_price, "Running, all together:  $0.9304/h")
    error_message = "n1-standard-4 + T4 + licences + NAT runs at $0.9304 an hour."
  }
}

run "spot" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    spot = true
  }

  assert {
    condition     = google_compute_instance.test_rig.scheduling[0].provisioning_model == "SPOT" && google_compute_instance.test_rig.scheduling[0].preemptible && google_compute_instance.test_rig.scheduling[0].instance_termination_action == "STOP"
    error_message = "Spot is selectable, and a reclaimed machine is stopped, not deleted."
  }

  assert {
    condition     = strcontains(output.hourly_price, "Running, all together:  $0.8145/h")
    error_message = "Spot runs at $0.8145 an hour (the licences are not discounted)."
  }
}

run "ninety_minutes" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    max_run_hours = 1.5
  }

  assert {
    condition     = google_compute_instance.test_rig.scheduling[0].max_run_duration[0].seconds == 5400
    error_message = "max_run_hours reaches the machine in seconds."
  }

  assert {
    condition     = output.build != run.defaults.build
    error_message = "A new run limit is a new build: the provider replaces the machine."
  }
}

run "new_desktop_user_is_the_same_build" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    desktop_user = "walker"
  }

  assert {
    condition     = output.build == run.defaults.build && strcontains(local.startup_script, "$DesktopUser = 'walker'")
    error_message = "A new desktop user changes the start-up script in place; it is not a new build."
  }
}

run "budget_on" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    billing_account_id = "000000-000000-000000"
  }

  assert {
    condition     = google_billing_budget.test_rig[0].budget_filter[0].labels == tomap({ purpose = "test-rig" })
    error_message = "The budget counts only what carries purpose = test-rig."
  }

  assert {
    condition     = google_billing_budget.test_rig[0].amount[0].specified_amount[0].units == "45"
    error_message = "The budget is $45 a month."
  }

  assert {
    condition = toset([for t in google_billing_budget.test_rig[0].threshold_rules : "${coalesce(t.spend_basis, "CURRENT_SPEND")}:${t.threshold_percent}"]) == toset([
      "CURRENT_SPEND:0.8", "CURRENT_SPEND:1", "FORECASTED_SPEND:1",
    ])
    error_message = "The budget alerts at 80 % and 100 % of actual spend and 100 % forecast."
  }
}

run "no_backstop" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    backstop_stop_schedule = null
  }

  assert {
    condition     = length(google_compute_resource_policy.backstop) == 0 && length(google_compute_instance.test_rig.resource_policies) == 0
    error_message = "A null schedule removes the daily stop."
  }
}

run "rejects_mismatched_pair" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    machine_type = "n1-standard-4"
  }

  expect_failures = [google_compute_instance.test_rig]
}

run "rejects_zone_outside_region" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    zone = "us-west4-a"
  }

  expect_failures = [google_compute_instance.test_rig]
}

run "rejects_other_gpus" {
  command = plan

  variables {
    gpu_type = "nvidia-tesla-a100"
  }

  expect_failures = [var.gpu_type]
}

run "rejects_other_machine_types" {
  command = plan

  variables {
    machine_type = "g2-standard-8"
  }

  expect_failures = [var.machine_type]
}

run "rejects_no_limit" {
  command = plan

  variables {
    max_run_hours = 0
  }

  expect_failures = [var.max_run_hours]
}

# A limit shorter than the first-boot set-up would stop a new machine in the
# middle of it.
run "rejects_less_than_an_hour" {
  command = plan

  variables {
    max_run_hours = 0.5
  }

  expect_failures = [var.max_run_hours]
}

run "rejects_part_minutes" {
  command = plan

  variables {
    max_run_hours = 1.3333
  }

  expect_failures = [var.max_run_hours]
}

run "rejects_more_than_a_day" {
  command = plan

  variables {
    max_run_hours = 25
  }

  expect_failures = [var.max_run_hours]
}

run "rejects_the_whole_internet" {
  command = plan

  variables {
    direct_access_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.direct_access_cidrs]
}

run "rejects_a_user_name_windows_refuses" {
  command = plan

  variables {
    desktop_user = "a-name-of-twenty-ones"
  }

  expect_failures = [var.desktop_user]
}

run "rejects_a_computer_name_windows_truncates" {
  command = plan

  variables {
    instance_name = "test-rig-machine"
  }

  expect_failures = [var.instance_name]
}

# With running = false the plan reads the machine from Google (in the real
# project, a missing machine fails that read, and so the plan). Here the mock
# reports a machine of this build: stopping it is allowed.
run "stop_reads_the_machine" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running = false
  }

  assert {
    condition     = length(data.google_compute_instance.existing) == 1 && google_compute_instance.test_rig.desired_status == "TERMINATED"
    error_message = "A plan that stops the machine reads it first, then stops it."
  }
}

# A replacement with running = false is refused: the new machine would be
# stopped in the middle of Windows' own first boot. The machine Google reports
# carries an earlier build.
run "replaced_while_stopped_is_refused" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running  = false
    gpu_type = "nvidia-l4"
  }

  override_data {
    target = data.google_compute_instance.existing
    values = {
      labels           = { purpose = "test-rig", build = "0123456789abcdef0123456789abcdef" }
      effective_labels = { purpose = "test-rig", build = "0123456789abcdef0123456789abcdef" }
    }
  }

  expect_failures = [google_compute_instance.test_rig]
}

# --- Applied against the mocked provider, in order ---------------------------

# Created running, as it must be.
run "created_running" {
  command = apply

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  assert {
    condition     = google_compute_instance.test_rig.desired_status == "RUNNING" && google_compute_instance.test_rig.labels["build"] == output.build
    error_message = "A first apply creates the machine running, labelled with its build."
  }

  # Known only once applied (the mock fills them in then).
  assert {
    condition     = google_compute_instance.test_rig.resource_policies == tolist([google_compute_resource_policy.backstop[0].self_link])
    error_message = "The daily backstop is attached to the machine."
  }

  assert {
    condition = (
      google_compute_instance.test_rig.service_account[0].email == "test-rig@example.iam.gserviceaccount.com" &&
      google_project_iam_member.test_rig_log_writer.role == "roles/logging.logWriter" &&
      google_project_iam_member.test_rig_metric_writer.role == "roles/monitoring.metricWriter"
    )
    error_message = "The machine runs as its own service account, which writes logs and metrics."
  }

  assert {
    condition = (
      google_compute_firewall.iap_ingress.source_ranges == toset(["35.235.240.0/20"]) &&
      google_compute_firewall.iap_ingress.direction == "INGRESS" &&
      one(google_compute_firewall.iap_ingress.allow).protocol == "tcp" &&
      one(google_compute_firewall.iap_ingress.allow).ports == tolist(["22", "3389"]) &&
      google_compute_firewall.iap_ingress.target_service_accounts == toset(["test-rig@example.iam.gserviceaccount.com"]) &&
      length(google_compute_firewall.direct_ingress) == 0
    )
    error_message = "The only way in is SSH and RDP from Google's IAP range, to this machine."
  }
}

# Stopping the machine that exists is allowed, and keeps it.
run "stopped" {
  command = apply

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running = false
  }

  assert {
    condition     = google_compute_instance.test_rig.instance_id == run.created_running.instance_id && google_compute_instance.test_rig.desired_status == "TERMINATED"
    error_message = "Stopping the machine keeps it and stops it."
  }
}

# The machine exists and is stopped, as Google reports a stopped machine: its
# status TERMINATED, which the provider also reads back into desired_status.
# A plan with the same variables keeps it.
run "plan_while_stopped" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running = false
  }

  override_resource {
    target = google_compute_instance.test_rig
    values = {
      current_status = "TERMINATED"
      desired_status = "TERMINATED"
    }
  }

  assert {
    condition     = google_compute_instance.test_rig.instance_id == run.stopped.instance_id && google_compute_instance.test_rig.desired_status == "TERMINATED"
    error_message = "A plan against the stopped machine keeps it, stopped."
  }
}

# A new desktop user while stopped: the start-up script changes in place, the
# machine is kept and stays stopped; the next boot makes the user.
run "desktop_user_changed_while_stopped" {
  command = apply

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running      = false
    desktop_user = "walker"
  }

  assert {
    condition = (
      google_compute_instance.test_rig.instance_id == run.stopped.instance_id &&
      google_compute_instance.test_rig.desired_status == "TERMINATED" &&
      strcontains(google_compute_instance.test_rig.metadata["windows-startup-script-ps1"], "$DesktopUser = 'walker'")
    )
    error_message = "A new start-up script is written into the stopped machine, which is kept and stays stopped."
  }
}

# A new run limit while stopped is refused: the provider would replace the
# machine. The machine Google reports carries the build it was made with.
run "limit_changed_while_stopped_is_refused" {
  command = plan

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running       = false
    desktop_user  = "walker"
    max_run_hours = 1
  }

  override_data {
    target = data.google_compute_instance.existing
    values = {
      labels           = { purpose = "test-rig", build = "0123456789abcdef0123456789abcdef" }
      effective_labels = { purpose = "test-rig", build = "0123456789abcdef0123456789abcdef" }
    }
  }

  expect_failures = [google_compute_instance.test_rig]
}

# The same change with the machine running is allowed; the machine carries
# the new build, and runs.
run "limit_changed_while_running" {
  command = apply

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running       = true
    desktop_user  = "walker"
    max_run_hours = 1
  }

  assert {
    condition = (
      google_compute_instance.test_rig.labels["build"] == output.build &&
      output.build != run.created_running.build &&
      google_compute_instance.test_rig.scheduling[0].max_run_duration[0].seconds == 3600 &&
      google_compute_instance.test_rig.desired_status == "RUNNING"
    )
    error_message = "With running = true the new limit is applied, the machine carries the new build, and it runs."
  }
}

# Started again: the one change is its status.
run "started_again" {
  command = apply

  module {
    source = "../modules/gcp-test-rig-windows"
  }

  variables {
    running       = true
    desktop_user  = "walker"
    max_run_hours = 1
  }

  override_resource {
    target = google_compute_instance.test_rig
    values = {
      current_status = "TERMINATED"
      desired_status = "TERMINATED"
    }
  }

  assert {
    condition     = google_compute_instance.test_rig.desired_status == "RUNNING"
    error_message = "An apply with running = true starts a machine that stopped itself."
  }
}
