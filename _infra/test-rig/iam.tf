# The machine's identity. What it may do, and nothing more:
#
# - be managed by Systems Manager (AWS's managed policy for Session Manager);
# - read the one S3 bucket AWS documents for its Windows GRID drivers;
# - read Amazon DCV's licence bucket for this region, which AWS's DCV guide
#   requires on EC2 ("s3:GetObject" on "dcv-license.<region>/*");
# - write the one Parameter Store parameter that holds the desktop user's
#   password, and read no parameter at all.
#
# Nothing here grants anything on Route53, on another bucket, or on any other
# instance.

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "test_rig" {
  name               = local.name
  description        = "Rented Windows GPU machine"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.test_rig.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "test_rig" {
  statement {
    sid       = "NvidiaGridDriversList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::ec2-windows-nvidia-drivers"]
  }

  statement {
    sid       = "NvidiaGridDriversRead"
    actions   = ["s3:GetObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::ec2-windows-nvidia-drivers/*"]
  }

  statement {
    sid       = "DcvLicence"
    actions   = ["s3:GetObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::dcv-license.${var.region}/*"]
  }

  statement {
    sid       = "WriteDesktopPassword"
    actions   = ["ssm:PutParameter"]
    resources = [local.password_parameter_arn]
  }

  # AmazonSSMManagedInstanceCore allows ssm:GetParameter and GetParameters on
  # every parameter in the account. Session Manager does not need them, and
  # the machine has no reason to read its own password back or any other
  # parameter, so they are denied outright.
  statement {
    sid    = "ReadNoParameters"
    effect = "Deny"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:GetParameterHistory",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "test_rig" {
  name   = local.name
  role   = aws_iam_role.test_rig.id
  policy = data.aws_iam_policy_document.test_rig.json
}

resource "aws_iam_instance_profile" "test_rig" {
  name = local.name
  role = aws_iam_role.test_rig.name
}

# The second guard against a forgotten machine (the first is inside Windows:
# setup.ps1 stops it max_run_hours after each boot). EventBridge Scheduler
# stops it once a day at a fixed time, from outside, so a machine whose
# start-up script never ran is still stopped within a day. Its role may stop
# this one instance and do nothing else.
data "aws_iam_policy_document" "assume_scheduler" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name               = "${local.name}-backstop-stop"
  description        = "Stops the rented Windows GPU machine once a day"
  assume_role_policy = data.aws_iam_policy_document.assume_scheduler[0].json
}

data "aws_iam_policy_document" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  statement {
    actions   = ["ec2:StopInstances"]
    resources = [aws_instance.test_rig.arn]
  }
}

resource "aws_iam_role_policy" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name   = "${local.name}-backstop-stop"
  role   = aws_iam_role.backstop[0].id
  policy = data.aws_iam_policy_document.backstop[0].json
}

resource "aws_scheduler_schedule" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name                         = "${local.name}-backstop-stop"
  description                  = "Stops the rented Windows GPU machine if it is still running"
  schedule_expression          = var.backstop_stop_schedule
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    # EventBridge Scheduler's universal target: calls EC2 StopInstances
    # directly. Stopping a machine that is already stopped does nothing.
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.backstop[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.test_rig.id] })
  }
}
