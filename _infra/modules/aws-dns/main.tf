terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

data "aws_route53_zone" "this" {
  name = var.zone_name
}

# Firebase Hosting custom domains resolve via a single CNAME to the site's own
# *.web.app hostname — not a set of anycast A records. Confirmed against the
# live `hosting_required_dns_updates` output rather than assumed.
resource "aws_route53_record" "cname" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = var.ttl
  records = [var.cname_target]
}
