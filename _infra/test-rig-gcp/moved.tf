# Every resource of this root was declared here, at the top level, until it
# moved into ../modules/gcp-test-rig/. The machine had been applied by then:
# without these blocks each resource would be planned as destroyed at its old
# address and created at its new one, the machine and its disk included. With
# them the next plan shows each as moved and changes nothing.
#
# One block per resource, file by file as the module declares them. A block
# that names a resource with `count` moves every instance of it, `[0]`
# included, and does nothing when there is none. Data sources are read again at
# every plan and need no block.
#
# Keep them: a state that has not yet been planned since the move still holds
# the old addresses.

# main.tf
moved {
  from = google_project_service.compute
  to   = module.test_rig.google_project_service.compute
}

moved {
  from = google_project_service.iap
  to   = module.test_rig.google_project_service.iap
}

moved {
  from = google_project_service.iam
  to   = module.test_rig.google_project_service.iam
}

moved {
  from = google_service_account.test_rig
  to   = module.test_rig.google_service_account.test_rig
}

moved {
  from = google_project_iam_member.test_rig_log_writer
  to   = module.test_rig.google_project_iam_member.test_rig_log_writer
}

moved {
  from = google_project_iam_member.test_rig_metric_writer
  to   = module.test_rig.google_project_iam_member.test_rig_metric_writer
}

# network.tf
moved {
  from = google_compute_network.test_rig
  to   = module.test_rig.google_compute_network.test_rig
}

moved {
  from = google_compute_subnetwork.test_rig
  to   = module.test_rig.google_compute_subnetwork.test_rig
}

moved {
  from = google_compute_firewall.iap_ingress
  to   = module.test_rig.google_compute_firewall.iap_ingress
}

# count: [0] while direct_access_cidrs is not empty.
moved {
  from = google_compute_firewall.direct_ingress
  to   = module.test_rig.google_compute_firewall.direct_ingress
}

moved {
  from = google_compute_router.test_rig
  to   = module.test_rig.google_compute_router.test_rig
}

moved {
  from = google_compute_router_nat.test_rig
  to   = module.test_rig.google_compute_router_nat.test_rig
}

# instance.tf
moved {
  from = google_compute_instance.test_rig
  to   = module.test_rig.google_compute_instance.test_rig
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = google_compute_resource_policy.backstop
  to   = module.test_rig.google_compute_resource_policy.backstop
}

# budget.tf; count: [0] while billing_account_id is set.
moved {
  from = google_project_service.billingbudgets
  to   = module.test_rig.google_project_service.billingbudgets
}

# count: [0] while billing_account_id is set. Its provider, google.billing,
# is the same configuration, passed to the module.
moved {
  from = google_billing_budget.test_rig
  to   = module.test_rig.google_billing_budget.test_rig
}
