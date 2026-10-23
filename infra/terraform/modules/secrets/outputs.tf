output "secret_arn" {
  description = "ARN of the JSON secret holding JWT_SECRET and REFRESH_SECRET."
  value       = aws_secretsmanager_secret.app.arn
}

output "openai_secret_arn" {
  description = "ARN of the OPENAI_API_KEY secret, or null when it is not created."
  value       = var.create_openai_secret ? aws_secretsmanager_secret.openai[0].arn : null
}

output "secret_refs" {
  description = "ECS container `secrets` entries (signing keys, TOTP key, OpenAI key): [{ name, valueFrom = \"<arn>:<json key>::\" }]."
  value       = local.refs
}

output "totp_secret_arn" {
  description = "ARN of the TOTP_ENCRYPTION_KEY secret."
  value       = aws_secretsmanager_secret.totp.arn
}

output "totp_secret_ref" {
  description = "ECS container `secrets` entry for TOTP_ENCRYPTION_KEY alone (one-off tasks that need it without the signing keys)."
  value       = local.totp_ref
}
