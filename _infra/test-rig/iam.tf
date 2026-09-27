# The machine's identity. What it may do, and nothing more:
#
# - be managed by Systems Manager: AmazonSSMManagedInstanceCore, AWS's baseline
#   policy for Session Manager (the agent's own ssm, ssmmessages and
#   ec2messages calls, on "*" as AWS writes it);
# - read the one S3 bucket AWS documents for its Windows GRID drivers, by key;
# - read Amazon DCV's licence bucket for this region, which AWS's DCV guide
#   requires on EC2 ("s3:GetObject" on "dcv-license.<region>/*");
# - write the one Parameter Store parameter that holds the desktop user's
#   password, and read no parameter at all.
#
# Nothing here grants anything on Route53, on another bucket, or on any other
# instance. The policies are plain jsonencode() values rather than policy
# document data sources, so that tests/ can assert what they say.

locals {
  arn_prefix = "arn:${data.aws_partition.current.partition}"

  assume_ec2_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  instance_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "NvidiaGridDriversRead"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${local.arn_prefix}:s3:::ec2-windows-nvidia-drivers/*"
      },
      {
        Sid      = "DcvLicence"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${local.arn_prefix}:s3:::dcv-license.${var.region}/*"
      },
      {
        Sid      = "WriteDesktopPassword"
        Effect   = "Allow"
        Action   = "ssm:PutParameter"
        Resource = local.password_parameter_arn
      },
      # AmazonSSMManagedInstanceCore allows ssm:GetParameter and GetParameters
      # on every parameter in the account. Session Manager does not need them,
      # and the machine has no reason to read its own password back or any
      # other parameter, so they are denied outright.
      {
        Sid    = "ReadNoParameters"
        Effect = "Deny"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameterHistory",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = "*"
      },
    ]
  })

  assume_scheduler_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })

  backstop_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ec2:StopInstances"
      Resource = aws_instance.test_rig.arn
    }]
  })
}

resource "aws_iam_role" "test_rig" {
  name               = local.name
  description        = "Rented Windows GPU machine"
  assume_role_policy = local.assume_ec2_policy
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.test_rig.name
  policy_arn = "${local.arn_prefix}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "test_rig" {
  name   = local.name
  role   = aws_iam_role.test_rig.id
  policy = local.instance_policy
}

resource "aws_iam_instance_profile" "test_rig" {
  name = local.name
  role = aws_iam_role.test_rig.name
}

# The second guard against a forgotten machine (the first is inside Windows:
# setup.ps1's shutdown task, max_run_hours after each boot). EventBridge
# Scheduler stops it once a day at a fixed time, from outside, so a machine
# whose start-up script never ran is still stopped within a day. Its role may
# stop this one instance and do nothing else.
resource "aws_iam_role" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name               = "${local.name}-backstop-stop"
  description        = "Stops the rented Windows GPU machine once a day"
  assume_role_policy = local.assume_scheduler_policy
}

resource "aws_iam_role_policy" "backstop" {
  count = var.backstop_stop_schedule != null ? 1 : 0

  name   = "${local.name}-backstop-stop"
  role   = aws_iam_role.backstop[0].id
  policy = local.backstop_policy
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
    arn      = "${local.arn_prefix}:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.backstop[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.test_rig.id] })
  }
}
