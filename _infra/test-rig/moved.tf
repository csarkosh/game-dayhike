# Every resource of this root was declared here, at the top level, until it
# moved into ../modules/aws-test-rig/. The machine had been applied by then:
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
  from = terraform_data.region
  to   = module.test_rig.terraform_data.region
}

# network.tf
moved {
  from = aws_vpc.test_rig
  to   = module.test_rig.aws_vpc.test_rig
}

moved {
  from = aws_subnet.test_rig
  to   = module.test_rig.aws_subnet.test_rig
}

moved {
  from = aws_internet_gateway.test_rig
  to   = module.test_rig.aws_internet_gateway.test_rig
}

moved {
  from = aws_route_table.test_rig
  to   = module.test_rig.aws_route_table.test_rig
}

moved {
  from = aws_route_table_association.test_rig
  to   = module.test_rig.aws_route_table_association.test_rig
}

moved {
  from = aws_security_group.test_rig
  to   = module.test_rig.aws_security_group.test_rig
}

moved {
  from = aws_default_security_group.test_rig
  to   = module.test_rig.aws_default_security_group.test_rig
}

# iam.tf
moved {
  from = aws_iam_role.test_rig
  to   = module.test_rig.aws_iam_role.test_rig
}

moved {
  from = aws_iam_role_policy_attachment.ssm_core
  to   = module.test_rig.aws_iam_role_policy_attachment.ssm_core
}

moved {
  from = aws_iam_role_policy.test_rig
  to   = module.test_rig.aws_iam_role_policy.test_rig
}

moved {
  from = aws_iam_role_policy_attachments_exclusive.test_rig
  to   = module.test_rig.aws_iam_role_policy_attachments_exclusive.test_rig
}

moved {
  from = aws_iam_role_policies_exclusive.test_rig
  to   = module.test_rig.aws_iam_role_policies_exclusive.test_rig
}

moved {
  from = aws_iam_instance_profile.test_rig
  to   = module.test_rig.aws_iam_instance_profile.test_rig
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = aws_iam_role.backstop
  to   = module.test_rig.aws_iam_role.backstop
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = aws_iam_role_policy_attachments_exclusive.backstop
  to   = module.test_rig.aws_iam_role_policy_attachments_exclusive.backstop
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = aws_iam_role_policies_exclusive.backstop
  to   = module.test_rig.aws_iam_role_policies_exclusive.backstop
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = aws_iam_role_policy.backstop
  to   = module.test_rig.aws_iam_role_policy.backstop
}

# count: [0] while backstop_stop_schedule is set.
moved {
  from = aws_scheduler_schedule.backstop
  to   = module.test_rig.aws_scheduler_schedule.backstop
}

# instance.tf
moved {
  from = terraform_data.setup_script
  to   = module.test_rig.terraform_data.setup_script
}

moved {
  from = aws_instance.test_rig
  to   = module.test_rig.aws_instance.test_rig
}

moved {
  from = aws_ec2_instance_state.test_rig
  to   = module.test_rig.aws_ec2_instance_state.test_rig
}

# budget.tf; count: [0] while budget_enabled.
moved {
  from = aws_budgets_budget.test_rig
  to   = module.test_rig.aws_budgets_budget.test_rig
}
