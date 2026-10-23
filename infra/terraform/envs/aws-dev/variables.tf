variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Environment tag."
  type        = string
  default     = "dev"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

variable "name_prefix" {
  description = "Prefix for every resource name; the bucket name derives from it, so make it globally unique (e.g. \"my-social-dev\")."
  type        = string
}

variable "domain" {
  description = "The app host, e.g. app.example.com. Web, API (/api/*) and realtime (/socket.io/*) share it."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the domain (automatic certificates and DNS)."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional certificate, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "mail_domain" {
  description = "SES sending domain (defaults to domain)."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Image tag to deploy (make aws-deploy passes the git commit)."
  type        = string
}

variable "product_name" {
  description = "Product name shown in the app and emails."
  type        = string
  default     = "Euron Open Social"
}

variable "enable_cdn" {
  description = "CloudFront (+ WAF) in front of the load balancer."
  type        = bool
  default     = false
}

variable "alarm_email" {
  description = "Alarm notification address."
  type        = string
  default     = null
}

variable "openai_api_key" {
  description = "Optional OpenAI key for AI moderation (stored in Secrets Manager and in state). Prefer create_openai_secret and putting it in by hand."
  type        = string
  default     = null
  sensitive   = true
}

variable "create_openai_secret" {
  description = "Create the OPENAI_API_KEY secret with a placeholder to replace by hand."
  type        = bool
  default     = false
}

variable "moderation_provider" {
  description = "rules or openai. Null: openai when a key is configured, otherwise rules."
  type        = string
  default     = null
}

variable "media_cors_extra_origins" {
  description = "Extra origins allowed to upload to the media bucket, e.g. [\"http://localhost:3510\"] for make up-aws."
  type        = list(string)
  default     = []
}

variable "api_extra_environment" {
  description = "Extra API and worker environment. Never secrets."
  type        = map(string)
  default     = {}
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "cache_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton). ARM64 needs linux/arm64 images: PLATFORM=linux/arm64 make aws-deploy."
  type        = string
  default     = "X86_64"
}

variable "app_db_secret_arn" {
  description = "Secret of the least-privilege application database role (docs/guides/operations.md). Null: the api and worker use the RDS master user."
  type        = string
  default     = null
}

variable "app_db_username" {
  description = "Login of the application database role (with app_db_secret_arn)."
  type        = string
  default     = null
}
