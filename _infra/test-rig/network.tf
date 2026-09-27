# A network of its own, not the project's default one: the default network
# comes with rules that open SSH and RDP to the whole internet.
resource "google_compute_network" "test_rig" {
  name                    = "test-rig"
  auto_create_subnetworks = false

  depends_on = [google_project_service.compute]
}

resource "google_compute_subnetwork" "test_rig" {
  name          = "test-rig"
  region        = var.gcp_region
  network       = google_compute_network.test_rig.id
  ip_cidr_range = var.subnet_cidr

  # Google's own endpoints (storage.googleapis.com, where the NVIDIA driver is
  # downloaded from; Cloud Logging) are then reached without passing through
  # the NAT below, which bills per GiB it carries.
  private_ip_google_access = true
}

# Nothing on the internet can open a connection to the machine: a VPC denies
# all ingress unless a rule allows it, and the only rule allows Google's
# Identity-Aware Proxy range, which carries `gcloud compute ssh
# --tunnel-through-iap` and `gcloud compute start-iap-tunnel`. IAP checks the
# caller's Google identity before it forwards anything, so no address of the
# person connecting appears in any file.
resource "google_compute_firewall" "iap_ingress" {
  name    = "test-rig-allow-iap"
  network = google_compute_network.test_rig.id

  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]

  allow {
    protocol = "tcp"
    ports    = ["22", "3389"]
  }

  target_service_accounts = [google_service_account.test_rig.email]
}

# Off by default and expected to stay off: IAP covers SSH and RDP. It exists
# for a client that cannot go through IAP, and takes addresses from a
# git-ignored terraform.tfvars, never from a committed file.
resource "google_compute_firewall" "direct_ingress" {
  count = length(var.direct_access_cidrs) > 0 ? 1 : 0

  name    = "test-rig-allow-direct"
  network = google_compute_network.test_rig.id

  direction     = "INGRESS"
  source_ranges = var.direct_access_cidrs

  allow {
    protocol = "tcp"
    ports    = ["22", "3389"]
  }

  target_service_accounts = [google_service_account.test_rig.email]
}

# Outbound access (installers, the repository, npm) goes through Cloud NAT
# rather than an external address on the machine, so the machine has no public
# address at all. Priced as of 2026-09-27 (Cloud Billing Catalog), NAT is not
# the cheaper of the two: $0.0014/h for the gateway plus $0.005/h for the
# address it holds plus $0.045/GiB it carries, against $0.005/h for an
# ephemeral address on the machine. Over a three-hour run with about 0.5 GiB of
# traffic that is roughly $0.04 against $0.015. The difference buys a Windows
# machine with an SSH server that the internet cannot address even if a
# firewall rule is added by mistake. Both are billed only while the machine
# runs: NAT releases an automatically allocated address once no machine uses
# it.
resource "google_compute_router" "test_rig" {
  name    = "test-rig"
  region  = var.gcp_region
  network = google_compute_network.test_rig.id
}

resource "google_compute_router_nat" "test_rig" {
  name   = "test-rig"
  region = var.gcp_region
  router = google_compute_router.test_rig.name

  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.test_rig.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
