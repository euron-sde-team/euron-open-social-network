# Application secrets in Secrets Manager. ECS injects each JSON key into the API and
# worker containers as an environment variable; the values never appear in a task
# definition or a log.
#
#   <prefix>/app      JWT_SECRET, REFRESH_SECRET: generated here, 64 characters each.
#                     Distinct on purpose (the API refuses to boot if they are equal), so
#                     access tokens and refresh tokens can be rotated independently.
#   <prefix>/totp     TOTP_ENCRYPTION_KEY: 32 random bytes, base64. Encrypts the TOTP
#                     secrets at rest. Its own secret (not a key in <prefix>/app) so an
#                     existing deployment gains it on the next apply: the app secret's
#                     value is ignore_changes. Rotating it invalidates every enrolled
#                     authenticator, so it is not rotated with the signing keys.
#   <prefix>/openai   OPENAI_API_KEY: only when create_openai_secret is true. The value
#                     can come from var.openai_api_key or be put in by hand afterwards
#                     (aws secretsmanager put-secret-value), which keeps it out of state.
#
# REDIS_URL lives in the cache module's own secret, next to the auth token it embeds.
resource "random_password" "app" {
  for_each = toset(["JWT_SECRET", "REFRESH_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:These are HMAC signing keys; rotation is an operator procedure (put a new version, roll the services), not a Lambda.
  name                    = "${var.name_prefix}/app"
  description             = "API signing secrets (access and refresh tokens)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ for k, v in random_password.app : k => v.result })

  # Rotation happens out of band (put a new version by hand or by pipeline). Without
  # this, the next `terraform apply` would quietly roll every secret back.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "random_bytes" "totp" {
  length = 32
}

resource "aws_secretsmanager_secret" "totp" {
  #checkov:skip=CKV2_AWS_57:A data-encryption key for stored TOTP secrets; rotating it needs a re-encryption, not a Lambda.
  name                    = "${var.name_prefix}/totp"
  description             = "Key that encrypts stored TOTP secrets (TOTP_ENCRYPTION_KEY)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "totp" {
  secret_id     = aws_secretsmanager_secret.totp.id
  secret_string = jsonencode({ TOTP_ENCRYPTION_KEY = random_bytes.totp.base64 })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "openai" {
  #checkov:skip=CKV2_AWS_57:A third-party API key; it is rotated at the provider, then put here by hand.
  count                   = var.create_openai_secret ? 1 : 0
  name                    = "${var.name_prefix}/openai"
  description             = "OpenAI API key for AI moderation (MODERATION_PROVIDER=openai)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "openai" {
  count         = var.create_openai_secret ? 1 : 0
  secret_id     = aws_secretsmanager_secret.openai[0].id
  secret_string = jsonencode({ OPENAI_API_KEY = coalesce(var.openai_api_key, "set-me") })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  totp_ref = { name = "TOTP_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.totp.arn}:TOTP_ENCRYPTION_KEY::" }
  refs = concat(
    [for k in sort(keys(random_password.app)) : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [local.totp_ref],
    [for s in aws_secretsmanager_secret.openai : { name = "OPENAI_API_KEY", valueFrom = "${s.arn}:OPENAI_API_KEY::" }],
  )
}
