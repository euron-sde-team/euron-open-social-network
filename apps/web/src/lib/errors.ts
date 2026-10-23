import { isApiError } from "@open-social/api-client";
import type { DmDenialReason } from "@open-social/types";

/** Human copy for the API's stable error codes. Unknown codes fall back to the server message. */
const COPY: Record<string, string> = {
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
  SERVER_ERROR: "Something went wrong on our side. Try again in a moment.",
  BAD_GATEWAY: "The service is restarting. Try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again in a moment.",
  GATEWAY_TIMEOUT: "The server took too long to answer. Try again.",
  RATE_LIMITED: "You are doing that too fast. Wait a moment and try again.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find that. It may have been removed or you may not have access.",
  VALIDATION_FAILED: "Some fields need attention.",
  INVALID_CREDENTIALS: "That email, username or password is not right.",
  INVALID_TOTP: "That code did not work. Check your authenticator app and try again.",
  ACCOUNT_RESTRICTED: "Your account is restricted, so you can read but not post or message right now.",
  ACCOUNT_BANNED: "This account has been banned.",
  ACCOUNT_DEACTIVATED: "This account has been deactivated.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first. Check your inbox for the link.",
  EMAIL_TAKEN: "An account with that email already exists.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters, not a common one.",
  REGISTRATION_CLOSED: "Sign-ups are closed on this network right now.",
  TOTP_ALREADY_ENABLED: "Two-factor authentication is already on.",
  TOTP_NOT_STARTED: "Start two-factor setup again.",
  COMMUNITY_CREATION_RESTRICTED: "Only moderators and admins can create communities on this network.",
  COMMUNITY_LIMIT_REACHED: "You have reached the maximum number of communities you can create.",
  SLUG_TAKEN: "That address is taken. Try another.",
  ALREADY_REPORTED: "You already reported this. Our moderators will take a look.",
  DM_NOT_ALLOWED: "You can not message this person right now.",
  POLL_CLOSED: "This poll is closed.",
  POLL_ANONYMOUS: "Votes on this poll are anonymous.",
  POST_LOCKED: "Comments are turned off for this post.",
  MEDIA_INVALID: "That file could not be used. Try a different one.",
  MEDIA_NOT_READY: "Your upload is still processing. Try again in a moment.",
  MEDIA_IN_USE: "That file is already attached somewhere else.",
  UPLOAD_FAILED: "The upload did not go through. Try again.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  OWNER_MUST_TRANSFER: "Transfer ownership to another member before you leave.",
  EVENT_FULL: "This event is full. You are on the waitlist.",
  APPEAL_EXISTS: "You have already appealed this decision.",
};

export function errorCopy(code: string | undefined, fallback?: string): string {
  if (code && COPY[code]) return COPY[code];
  return fallback || "Something went wrong. Try again.";
}

/** The best human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    // Validation messages from the server are already field-specific and readable.
    if (e.code === "VALIDATION_FAILED") {
      const first = Object.values(e.fieldErrors)[0];
      return first ? `${COPY.VALIDATION_FAILED} ${capitalise(first)}.` : COPY.VALIDATION_FAILED!;
    }
    return errorCopy(e.code, e.message);
  }
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  return errorCopy(undefined);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");

/** Errors not worth a toast: the page already shows them in place. */
export function isQuietError(e: unknown): boolean {
  if (isApiError(e)) return e.status === 404 || e.status === 401 || e.code === "VALIDATION_FAILED";
  return e instanceof Error && e.name === "AbortError";
}

/** Copy for each DM denial reason. `name` is the other person's display name. */
export function dmDenialCopy(reason: DmDenialReason | null | undefined, name = "this person"): string {
  switch (reason) {
    case "SELF":
      return "You can not message yourself.";
    case "BLOCKED":
      return `You can not message ${name}.`;
    case "NO_SHARED_COMMUNITY":
      return `${name} only accepts messages from people in their communities. Join a community they are in to message them.`;
    case "RECIPIENT_NOT_FOLLOWING":
      return `${name} only accepts messages from people they follow.`;
    case "RECIPIENT_DISABLED_DMS":
      return `${name} has turned off direct messages.`;
    case "RECIPIENT_UNAVAILABLE":
      return `${name} is not available right now.`;
    case "SENDER_RESTRICTED":
      return "Your account is restricted, so you can not send messages right now.";
    default:
      return `You can not message ${name} right now.`;
  }
}
