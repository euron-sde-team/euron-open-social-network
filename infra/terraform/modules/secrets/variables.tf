variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK that encrypts the secrets. Null uses the AWS-managed key."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. 0 deletes immediately (local and throwaway environments)."
  type        = number
  default     = 30
}

variable "create_openai_secret" {
  description = "Create the <prefix>/openai secret. A plain boolean so the decision is known at plan time even though the key itself is sensitive."
  type        = bool
  default     = false
}

variable "openai_api_key" {
  description = "Initial OPENAI_API_KEY value. Null writes a placeholder to replace by hand, which keeps the key out of Terraform state."
  type        = string
  default     = null
  sensitive   = true
}
