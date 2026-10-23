# ADR 0010: Direct-to-storage uploads, referenced by upload id only

## Status

Accepted.

## Context

Files up to 200 MB should not stream through the API tasks. Content must never point at an
arbitrary URL or someone else's file, and the declared type of a file cannot be trusted.

## Decision

- The browser asks for an upload (`POST /api/media/uploads` with purpose, file name, type
  and size). The API validates the declaration against the allowlist and the per-kind
  limit, stores a `PENDING` row and returns a presigned PUT (600 s, signing content type and
  length) ([`services/media.service.ts`](../../../apps/api/src/services/media.service.ts), [`domain/media-rules.ts`](../../../apps/api/src/domain/media-rules.ts)).
- After uploading, the client calls `complete`. The API reads the object's size (must equal
  the declared size) and its first 4 KB (must match the type's magic number), then queues
  `media.process`, which re-encodes images with sharp and writes a thumbnail.
- Content references media only by upload id. `claimUploads` checks owner, purpose, status
  and single use under `FOR UPDATE` ([`services/media-attach.service.ts`](../../../apps/api/src/services/media-attach.service.ts)).
- The bucket is private; reads are presigned GETs minted per response after the API's own
  permission check. Storage keys contain nothing from the client.
- `STORAGE=local` keeps the same browser flow with HMAC-signed URLs served by the API, for
  development.

Details: [media.md](../media.md).

## Consequences

Positive:

- Upload bandwidth never touches the API; the WAF body-size rule can stay relaxed only for
  text (media never passes CloudFront).
- No hotlinking, no attaching other people's files, no SVG or HTML served from the bucket.

Trade-offs:

- Three round trips per file (create, PUT, complete) and a CORS rule on the bucket.
- Signed URLs expire, so clients refetch the parent rather than caching URLs, and a URL
  stays valid until expiry even if access is revoked.
- Files are served before processing finishes, and only images are re-encoded.

## Alternatives considered

- **Multipart upload through the API.** Simple, but ties API memory and tasks to file size.
- **Public bucket or CDN URLs.** Faster reads, but permanent public links to private content.
- **Accepting client URLs or keys.** The approach this replaces: anyone could attach anything.
