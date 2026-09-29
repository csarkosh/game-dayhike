locals {
  boot_image = var.baked_image != "" ? var.baked_image : var.image

  max_run_seconds = floor(var.max_run_hours * 3600)

  # The start-up script with the desktop user's name filled in, and whether
  # its check after set-up requires the RTX Virtual Workstation licence (only
  # a -vws GPU carries it; a plain GPU is a control run).
  startup_script = templatefile("${path.module}/startup.ps1", {
    desktop_user = var.desktop_user
    require_vws  = endswith(var.gpu_type, "-vws") ? "1" : "0"
  })

  # Everything whose change makes the provider replace the machine (and its
  # disk), recorded on the machine as the label `build`, so that a later plan
  # can tell, from the machine Google reports, that it is about to be
  # replaced. The image is not in it: the machine ignores a change of image
  # (below). 32 hex characters: a label value takes at most 63.
  build_key = substr(sha256(jsonencode({
    instance_name   = var.instance_name
    zone            = var.zone
    gpu_type        = var.gpu_type
    disk_size_gb    = var.boot_disk_size_gb
    disk_type       = var.boot_disk_type
    spot            = var.spot
    max_run_seconds = local.max_run_seconds
  })), 0, 32)
}

# The machine as Google reports it, read at plan time, only when the machine
# is to be stopped. If it does not exist (a first apply, an apply after a
# destroy, a new name or zone), the read itself fails the plan ("... not
# found"): with running = false there must be a machine to stop. If it exists,
# the precondition below compares its `build` label with this build.
data "google_compute_instance" "existing" {
  count = var.running ? 0 : 1

  name = var.instance_name
  zone = var.zone
}

locals {
  # The existing machine's build. A machine without the label (every machine
  # this module makes has it; only a hand can remove it) cannot be judged and
  # counts as this build.
  existing_build = var.running ? local.build_key : lookup(
    merge(data.google_compute_instance.existing[0].labels, data.google_compute_instance.existing[0].effective_labels),
    "build",
    local.build_key,
  )
}

resource "google_compute_instance" "test_rig" {
  name         = var.instance_name
  zone         = var.zone
  machine_type = var.machine_type

  # Stopped rather than destroyed between runs: a stopped machine bills its
  # disk and nothing else, and an apply with running = true brings it back.
  # The provider reads this back as the machine's status, so a machine that
  # stopped itself plans as one change, TERMINATED to RUNNING, and nothing
  # else. allow_stopping_for_update lets the provider stop and restart a
  # running machine for a change that needs it stopped.
  desired_status            = var.running ? "RUNNING" : "TERMINATED"
  allow_stopping_for_update = true

  labels = merge(var.labels, { build = local.build_key })

  boot_disk {
    auto_delete = true

    initialize_params {
      image = local.boot_image
      size  = var.boot_disk_size_gb
      type  = var.boot_disk_type

      # Set here as well as through the provider's default labels: the disk is
      # created by the instance, and it is the one part billed while stopped.
      # Fixed: the provider replaces the machine if these change.
      labels = var.labels
    }
  }

  # Explicit on both machine choices. On G2 the L4 comes with the machine type
  # and this is where `nvidia-l4-vws` asks for the workstation licence; on N1
  # the T4 is attached only because this says so.
  guest_accelerator {
    type  = var.gpu_type
    count = 1
  }

  enable_display = var.enable_display

  network_interface {
    subnetwork = google_compute_subnetwork.test_rig.id
    # No access_config block: no external address, running or stopped, so
    # nothing about the address can read back differently while the machine
    # is stopped. Outbound goes through NAT.
  }

  service_account {
    email = google_service_account.test_rig.email
    # The broad scope with a narrow identity is Google's recommended pairing:
    # what the machine may do is decided by the service account's roles.
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    # The public Windows Server images are UEFI and signed, and Google's
    # Windows driver method supports Secure Boot machines.
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  scheduling {
    # A machine with a GPU attached cannot be live-migrated: on host
    # maintenance it must stop.
    on_host_maintenance = "TERMINATE"

    provisioning_model = var.spot ? "SPOT" : "STANDARD"
    preemptible        = var.spot

    # Off even for a standard machine: nothing may bring a stopped machine
    # back and bill it. A machine stopped for maintenance is simply stopped,
    # and the run is redone.
    automatic_restart = false

    # The first guard against a forgotten machine, enforced by Compute Engine
    # outside Windows: it stops the machine max_run_hours after each start
    # (a restart from inside Windows does not reset the clock). STOP, not
    # DELETE, keeps the disk; a reclaimed Spot machine is stopped the same way.
    instance_termination_action = "STOP"

    max_run_duration {
      seconds = local.max_run_seconds
    }
  }

  # The second guard (below): a daily stop from outside.
  resource_policies = var.backstop_stop_schedule != null ? [google_compute_resource_policy.backstop[0].self_link] : []

  metadata = {
    # Google's documented way to make `gcloud compute ssh` work on Windows:
    # install its SSH package during first-boot specialisation, then turn SSH
    # on. The guest agent then creates a local administrator for each key that
    # `gcloud compute ssh` pushes.
    sysprep-specialize-script-cmd = "googet -noconfirm=true install google-compute-engine-ssh"
    enable-windows-ssh            = "TRUE"

    # The machine takes SSH keys from its own metadata only, never the
    # project's: a key in the project's metadata is accepted by every machine
    # of the project that does not block them. With this set, `gcloud compute
    # ssh` puts its key in the machine's metadata (it checks this key), which
    # the lifecycle below leaves alone, and the key goes with the machine.
    block-project-ssh-keys = "TRUE"

    # Runs at every boot as the local system account; the set-up steps run
    # only until each is done. See startup.ps1. A change is written into the
    # machine in place and read at its next boot.
    windows-startup-script-ps1 = local.startup_script
  }

  lifecycle {
    # `gcloud compute ssh` and `gcloud compute reset-windows-password` write
    # their keys into instance metadata. Without this, every apply after the
    # first connection would strip them and lock out whoever connected.
    #
    # The image: the family's newest image changes every month, and a baked
    # image is a deliberate choice. The machine keeps the image it was made
    # from; `terraform apply
    # -replace=module.test_rig.google_compute_instance.test_rig` (from
    # _infra/test-rig-gcp-windows/) moves it to var.image or var.baked_image on
    # purpose.
    ignore_changes = [
      metadata["ssh-keys"],
      metadata["windows-keys"],
      boot_disk[0].initialize_params[0].image,
    ]

    # A mismatched pair fails here, at plan, rather than at the API.
    precondition {
      condition = (
        (var.machine_type == "g2-standard-4" && startswith(var.gpu_type, "nvidia-l4")) ||
        (var.machine_type == "n1-standard-4" && startswith(var.gpu_type, "nvidia-tesla-t4"))
      )
      error_message = "machine_type and gpu_type do not match: g2-standard-4 takes nvidia-l4-vws or nvidia-l4, n1-standard-4 takes nvidia-tesla-t4-vws or nvidia-tesla-t4."
    }

    precondition {
      condition     = startswith(var.zone, "${var.gcp_region}-")
      error_message = "zone ${var.zone} is not in gcp_region ${var.gcp_region}."
    }

    precondition {
      condition     = length(local.startup_script) <= 262144
      error_message = "The start-up script is ${length(local.startup_script)} bytes; Google takes at most 256 KB in windows-startup-script-ps1."
    }

    # A new machine must never be stopped before its first set-up has
    # finished. The provider creates a machine running and, with
    # desired_status = TERMINATED, stops it straight away: seconds into
    # Windows' own first boot, in the middle of its specialisation. So with
    # running = false the apply is allowed only to stop a machine that already
    # exists and is not being replaced. Creating one is refused by the read
    # above, which fails when there is no machine; replacing one, here.
    precondition {
      condition     = var.running || local.existing_build == local.build_key
      error_message = "running is false, and this apply replaces the machine (one of instance_name, zone, gpu_type, boot_disk_size_gb, boot_disk_type, spot or max_run_hours changed). A new machine must never be stopped before its first-boot set-up has finished: stopped in the middle of Windows' own first boot, it may never boot again. Apply with running = true, wait for the set-up to finish (C:\\ProgramData\\test-rig\\verified exists), then apply with running = false."
    }
  }

  depends_on = [
    google_project_iam_member.test_rig_log_writer,
    google_project_iam_member.test_rig_metric_writer,
    google_compute_router_nat.test_rig,
  ]
}

# The second guard against a forgotten machine: a Compute Engine instance
# schedule that stops it once a day at a fixed time. It catches whatever the
# run limit above does not (a limit removed by hand, a machine started some
# other way). Compute Engine's own service agent carries it out, and already
# holds compute.instances.stop through its role, roles/compute.serviceAgent;
# nothing is granted here. Stopping a stopped machine does nothing.
resource "google_compute_resource_policy" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name        = "test-rig-backstop-stop"
  region      = var.gcp_region
  description = "Stops the rented Windows GPU machine once a day if it is still running"

  instance_schedule_policy {
    vm_stop_schedule {
      schedule = var.backstop_stop_schedule
    }
    time_zone = "UTC"
  }

  depends_on = [google_project_service.compute]
}
