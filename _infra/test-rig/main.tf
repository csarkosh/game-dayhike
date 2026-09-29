# The rented Windows machine with an NVIDIA GPU on AWS. This directory is its
# root: the backend, the provider and one call of ../modules/aws-test-rig/,
# where the resources are, as _infra/ calls its own modules. It is what a
# person runs (`terraform apply -var running=false` and the rest, README.md).
# A resource's address carries the call's name, as in
# module.test_rig.aws_instance.test_rig; moved.tf maps the addresses the
# resources had before they moved into the module.
#
# It is NOT called from _infra/main.tf, and must not be: the machine keeps a
# state of its own, so that hosting's state holds nothing of it, starting,
# stopping or replacing it never plans against hosting, DNS or the signaling
# service, and a `terraform destroy` here can only reach the module's
# resources. (The desktop user's password is kept out of this state too: the
# machine writes it to Parameter Store, which Terraform does not manage.)

terraform {
  # 1.7 for the mock providers in tests/.
  required_version = ">= 1.7"

  # Remote state for the same reason as _infra/main.tf (state kept on disk in a
  # worktree dies with the worktree), in the same versioned bucket, under its
  # own prefix. Nothing here reads _infra's state and nothing in _infra reads
  # this one: the two root modules share a bucket and an AWS account and
  # nothing else. The bucket is Google Cloud Storage, so `init` and `plan`
  # need Google application default credentials as well as AWS ones.
  backend "gcs" {
    bucket = "fps-csarko-tfstate"
    prefix = "test-rig-aws"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  # Every resource that takes tags gets this one, so the machine's cost can be
  # told apart in billing and the optional budget can filter on it. The
  # provider also puts it on the instance's root volume. The module's
  # resources take it from this provider.
  default_tags {
    tags = local.tags
  }
}

locals {
  tags = { purpose = "test-rig" }
}

module "test_rig" {
  source = "../modules/aws-test-rig"

  region                 = var.region
  availability_zone      = var.availability_zone
  instance_type          = var.instance_type
  image_id               = var.image_id
  disk_size_gb           = var.disk_size_gb
  running                = var.running
  max_run_hours          = var.max_run_hours
  backstop_stop_schedule = var.backstop_stop_schedule
  desktop_user           = var.desktop_user
  password_parameter     = var.password_parameter
  display_width          = var.display_width
  display_height         = var.display_height
  vpc_cidr               = var.vpc_cidr
  budget_enabled         = var.budget_enabled
  budget_email           = var.budget_email
  monthly_budget_usd     = var.monthly_budget_usd
  tags                   = local.tags

  providers = {
    aws = aws
  }
}
