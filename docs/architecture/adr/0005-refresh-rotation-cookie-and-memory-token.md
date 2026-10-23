# ADR 0005: Short access token in memory, rotating refresh token in an httpOnly cookie

## Status

Accepted.

## Context

The web app is a browser client on the same origin as the API. Tokens in `localStorage`
are readable by any script that runs in the page. A pure session cookie needs CSRF defences
on every endpoint and does not suit the Socket.IO handshake. Bans, suspensions and "sign
out everywhere" must take effect quickly.

## Decision

[`security/tokens.ts`](../../../apps/api/src/security/tokens.ts), [`services/auth.service.ts`](../../../apps/api/src/services/auth.service.ts), [`controllers/auth.controller.ts`](../../../apps/api/src/controllers/auth.controller.ts):

- **Access token**: HS256 JWT, 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), audience and issuer
  checked, claims `sub` and `ver` (`users.token_version`). Returned in the response body and
  kept only in browser memory; sent as `Authorization: Bearer`. Every request reloads the
  user ([`middleware/auth.ts`](../../../apps/api/src/middleware/auth.ts)), so a version bump, ban or deactivation applies on
  the next request.
- **Refresh token**: 32 random bytes in the `os_refresh` cookie (`httpOnly`, `SameSite=Lax`,
  `Path=/api/auth`, `Secure` when the app is served over https), 30 days
  (`REFRESH_TOKEN_TTL_DAYS`). Only its SHA-256 is stored, in `sessions`.
- **Rotation with reuse detection**: each refresh issues a new token in the same
  `family_id` and marks the old row revoked with `replaced_by`. Presenting a rotated token
  more than 10 seconds after its rotation revokes the whole family (`session.reuse_detected`
  in the audit log); within 10 seconds it is treated as a benign double refresh from two tabs.
  The client serialises refreshes across tabs with the Web Locks API
  ([`packages/api-client/src/http.ts`](../../../packages/api-client/src/http.ts)).
- Unsafe methods with an `Origin` outside `CORS_ORIGINS` get `403 CORS_ORIGIN_DENIED`
  ([`app.ts`](../../../apps/api/src/app.ts)), on top of `SameSite=Lax`.
- Password reset and change, "sign out everywhere" and a ban revoke every session and bump
  `token_version`.

## Consequences

Positive:

- No long-lived credential is readable by page scripts; a stolen access token is useful for
  at most 15 minutes.
- A replayed refresh token kills the session family.
- The socket handshake uses the access token, so cookies never authenticate a socket.

Trade-offs:

- A page load needs a refresh round trip before the first authenticated call.
- Signing out one session (logout, `DELETE /api/users/me/sessions/:id`) revokes its refresh
  family but not the access token already issued, which stays valid until it expires.
- Every authenticated request reads the user row.

## Alternatives considered

- **Tokens in localStorage.** Simple, but exposed to any injected script.
- **Server sessions with a cookie only.** Needs CSRF tokens everywhere and a separate socket
  auth.
- **Long-lived JWTs.** Revocation would depend on a denylist.
