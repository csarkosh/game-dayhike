# The rented Windows machine with an NVIDIA GPU on AWS: its network, identity,
# machine, daily stop and optional budget. Called by one root only,
# _infra/test-rig-aws-windows/, which holds the backend, the provider (whose default tags
# every resource here carries) and the state; see its main.tf for why that
# root is not _infra/.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  name = "test-rig"
}

data "aws_partition" "current" {}

# The region is chosen once. The provider's region is not an attribute of any
# resource, so changing var.region does not move or replace anything: every
# resource is looked for in the new region, not found, and dropped from state,
# while the machine, its disk and its schedule go on existing, and billing, in
# the old one. This records the region of the first apply (a later change to
# the input is ignored), and the network, which every regional resource here
# is built on, refuses to be planned in another. Moving is `terraform destroy`
# in the old region first.
resource "terraform_data" "region" {
  input = var.region

  lifecycle {
    ignore_changes = [input]
  }
}

locals {
  region_error = "This state's machine is in ${terraform_data.region.output}, and region is now ${var.region}. The region is chosen once: set it back, or run `terraform destroy` with the old region first and then apply with the new one."
}

# Read at plan time, never written into a file: the account id appears only in
# the ARNs below and in state.
data "aws_caller_identity" "current" {}

# AWS's public parameter for the newest Windows Server 2025 image with the
# desktop (Full, not Core: Chrome needs a desktop), English. 2025 because the
# newest GRID driver in AWS's bucket is built for Windows Server 2022 and 2025
# only (GRID 17 and later dropped 2019), and Amazon DCV server 2025.0 is the
# first release to support 2025; of the two, 2025 has the longer support life.
# The instance ignores later changes to it (instance.tf), so a newer monthly
# image never replaces a machine that exists.
data "aws_ssm_parameter" "windows" {
  name = "/aws/service/ami-windows-latest/Windows_Server-2025-English-Full-Base"
}

# The zones that offer every machine size this module allows. The subnet goes
# in the first of them, so switching var.instance_type never moves the subnet
# (which would replace it and the machine with it).
data "aws_ec2_instance_type_offerings" "allowed" {
  for_each = toset(local.instance_types)

  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = [each.key]
  }
}

locals {
  instance_types = keys(local.hourly_usd)

  common_zones = sort(setintersection([
    for offering in data.aws_ec2_instance_type_offerings.allowed : offering.locations
  ]...))

  availability_zone = var.availability_zone != null ? var.availability_zone : try(local.common_zones[0], null)

  # Where the machine writes the desktop user's password (setup.ps1). Not a
  # Terraform resource: Terraform reads a parameter's value back into state.
  password_parameter_arn = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.password_parameter}"
}
