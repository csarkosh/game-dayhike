# A network of its own, with one public subnet. Nothing on the internet can
# open a connection to the machine: its security group has no inbound rule at
# all. Every way in goes through Systems Manager Session Manager (a shell, and
# port forwarding for Amazon DCV), which the machine's agent reaches outbound.
#
# Outbound access is a public IPv4 address on the machine rather than a NAT
# gateway or VPC endpoints. us-east-1 prices as of 2026-09-25 (AWS Price List
# API):
#
#   public IPv4 on the machine   $0.005/h, only while the machine runs (an
#                                automatically assigned address is released
#                                when it stops)
#   NAT gateway                  $0.045/h for as long as it exists, running or
#                                not ($32.85 a month), plus $0.045/GB carried
#   interface endpoints          $0.01/h each for as long as they exist; Session
#                                Manager alone needs three (ssm, ssmmessages,
#                                ec2messages): $21.90 a month, and the
#                                installers, the repository and Windows Update
#                                still need the internet
#
# The address costs about $0.015 a three-hour run. What it gives up is that
# the machine is addressable from the internet; with no inbound rule nothing is
# admitted, and a rule added by mistake would be visible in `plan`.

resource "aws_vpc" "test_rig" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }

  # Every resource here that lives in a region is built on this network, and
  # so is planned only after it (a targeted plan included): this one check
  # refuses them all in another region (main.tf, terraform_data.region).
  lifecycle {
    precondition {
      condition     = terraform_data.region.output == var.region
      error_message = local.region_error
    }
  }
}

resource "aws_subnet" "test_rig" {
  vpc_id            = aws_vpc.test_rig.id
  cidr_block        = var.vpc_cidr
  availability_zone = local.availability_zone

  # The machine's public IPv4 address comes from here, not from the instance's
  # associate_public_ip_address. The AWS provider reads that argument back from
  # the network interface's public-address association, which a stopped
  # machine does not have, and the argument forces replacement: set on the
  # instance, every plan against a stopped machine would replace it. Left
  # unset there, it is only read, never compared, and the subnet gives every
  # start its address.
  map_public_ip_on_launch = true

  tags = { Name = local.name }

  lifecycle {
    # The zone is read from AWS's offerings at every plan. Once the subnet
    # exists, a change there (AWS no longer offering a size in it) must not
    # replace the subnet and the machine with it; a deliberate move is
    # `terraform apply -replace=module.test_rig.aws_subnet.test_rig`.
    ignore_changes = [availability_zone]

    precondition {
      condition     = local.availability_zone != null
      error_message = "No availability zone in ${var.region} offers every allowed machine size; set availability_zone."
    }
  }
}

resource "aws_internet_gateway" "test_rig" {
  vpc_id = aws_vpc.test_rig.id

  tags = { Name = local.name }
}

resource "aws_route_table" "test_rig" {
  vpc_id = aws_vpc.test_rig.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.test_rig.id
  }

  tags = { Name = local.name }
}

resource "aws_route_table_association" "test_rig" {
  subnet_id      = aws_subnet.test_rig.id
  route_table_id = aws_route_table.test_rig.id
}

# The machine's only security group. No inbound rule: nothing is admitted.
# `ingress = []` says so explicitly, so Terraform also removes any inbound rule
# added outside it. Egress is open, because the NVIDIA driver's licence check,
# Windows Update, the installers and Session Manager do not share one
# documented set of ports.
resource "aws_security_group" "test_rig" {
  name        = local.name
  description = "Rented Windows GPU machine: no inbound, all outbound"
  vpc_id      = aws_vpc.test_rig.id

  ingress = []

  egress {
    description = "All outbound"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = local.name }
}

# Every VPC comes with a default security group that admits traffic from
# itself. Nothing uses it; this takes it over and leaves it with no rules, so
# it cannot be attached by mistake and admit anything.
resource "aws_default_security_group" "test_rig" {
  vpc_id = aws_vpc.test_rig.id

  ingress = []
  egress  = []

  tags = { Name = "${local.name}-default-unused" }
}
