output "fqdn" {
  description = "The CNAME record's fully qualified name"
  value       = aws_route53_record.cname.fqdn
}
