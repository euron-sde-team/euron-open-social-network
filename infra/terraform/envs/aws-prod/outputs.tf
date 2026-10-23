output "app_url" {
  description = "Public URL of the app."
  value       = module.social.app_url
}

output "cluster_name" {
  description = "ECS cluster."
  value       = module.social.cluster_name
}

output "services" {
  description = "ECS service names (api, worker, web)."
  value       = module.social.services
}

output "ecr_repositories" {
  description = "Image repositories (api, web)."
  value       = module.social.ecr_repositories
}

output "migrate_task_definition_arn" {
  description = "One-off migration task definition."
  value       = module.social.migrate_task_definition_arn
}

output "admin_task_definition_arn" {
  description = "One-off admin bootstrap task definition."
  value       = module.social.admin_task_definition_arn
}

output "run_task" {
  description = "Parameters for the one-off tasks (scripts/aws-run-task.sh)."
  value       = module.social.run_task
}

output "media_bucket" {
  description = "Media bucket."
  value       = module.social.media_bucket
}

output "redis_endpoint" {
  description = "Redis primary endpoint."
  value       = module.social.redis_endpoint
}

output "mail_configuration_set" {
  description = "SES configuration set."
  value       = module.social.mail_configuration_set
}

output "load_balancer_dns_name" {
  description = "CNAME target when the zone is not in Route53."
  value       = module.social.load_balancer_dns_name
}

output "certificate_validation_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.social.certificate_validation_records
}

output "mail_dns_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.social.mail_dns_records
}
