locals {
  boot_image = var.baked_image != "" ? var.baked_image : var.image
}

resource "google_compute_instance" "test_rig" {
  name         = var.instance_name
  zone         = var.zone
  machine_type = var.machine_type

  # Stopped rather than destroyed between runs: a stopped machine bills its
  # disk and nothing else, and `-var running=true` brings it back with one
  # apply. Changing the machine type or GPU needs the machine stopped; this
  # lets Terraform stop and restart it to do so.
  desired_status            = var.running ? "RUNNING" : "TERMINATED"
  allow_stopping_for_update = true

  labels = local.labels

  boot_disk {
    auto_delete = true

    initialize_params {
      image = local.boot_image
      size  = var.boot_disk_size_gb
      type  = var.boot_disk_type

      # Set here as well as through the provider's default labels: the disk is
      # created by the instance, and it is the one part billed while stopped.
      labels = local.labels
    }
  }

  # Explicit on both machine choices. On G2 the L4 comes with the machine type
  # and this only restates it (and is where `nvidia-l4-vws` would go); on N1
  # the T4 is attached only because this says so.
  guest_accelerator {
    type  = var.gpu_type
    count = var.gpu_count
  }

  # Off by default. A virtual display adds Google's basic display adapter
  # beside the NVIDIA one, and which of the two Chrome picks is the question
  # the first run's probe settles; see README.md.
  enable_display = var.enable_display

  network_interface {
    subnetwork = google_compute_subnetwork.test_rig.id
    # No access_config block: no external address. Outbound goes through NAT.
  }

  service_account {
    email = google_service_account.test_rig.email
    # The broad scope with a narrow identity is Google's recommended pairing:
    # what the machine may do is decided by the service account's roles.
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    # The public Windows Server images are UEFI and signed, and Google's
    # Windows driver script supports Secure Boot machines.
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

    # Off even for a standard machine. Google does not say whether a restart
    # after host maintenance also follows a stop by max_run_duration; with it
    # off, neither can bring a stopped machine back and bill it. A machine
    # stopped for maintenance is simply stopped, and the run is redone.
    automatic_restart = false

    # A forgotten machine stops itself. The clock restarts at every start, so
    # this bounds one run, not the machine's life. STOP (not DELETE) keeps the
    # disk; a reclaimed Spot machine is stopped the same way.
    instance_termination_action = var.spot || var.max_run_hours > 0 ? "STOP" : null

    dynamic "max_run_duration" {
      for_each = var.max_run_hours > 0 ? [1] : []
      content {
        seconds = var.max_run_hours * 3600
      }
    }
  }

  metadata = {
    # Google's documented way to make `gcloud compute ssh` work on Windows:
    # install its SSH package during first-boot specialisation, then turn SSH
    # on. The guest agent then creates a local account for each key that
    # `gcloud compute ssh` pushes.
    sysprep-specialize-script-cmd = "googet -noconfirm=true install google-compute-engine-ssh"
    enable-windows-ssh            = "TRUE"

    # Everything else is installed by this script on first boot; it does
    # nothing on later boots. See startup.ps1.
    windows-startup-script-ps1 = file("${path.module}/startup.ps1")
  }

  lifecycle {
    # A mismatched pair fails here, at plan, rather than at the API.
    precondition {
      condition = (
        (startswith(var.machine_type, "g2-") && startswith(var.gpu_type, "nvidia-l4")) ||
        (startswith(var.machine_type, "n1-") && startswith(var.gpu_type, "nvidia-tesla-"))
      )
      error_message = "machine_type and gpu_type do not match: g2-* takes nvidia-l4 or nvidia-l4-vws, n1-* takes nvidia-tesla-t4 or nvidia-tesla-t4-vws."
    }

    # `gcloud compute ssh` and `gcloud compute reset-windows-password` write
    # their keys into instance metadata. Without this, every apply after the
    # first connection would strip them and lock the key's owner out.
    ignore_changes = [
      metadata["ssh-keys"],
      metadata["windows-keys"],
    ]
  }

  depends_on = [
    google_project_iam_member.test_rig_log_writer,
    google_project_iam_member.test_rig_metric_writer,
    google_compute_router_nat.test_rig,
  ]
}
