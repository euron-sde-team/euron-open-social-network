# ADR 0011: Pluggable moderation providers behind one threshold policy

## Status

Accepted.

## Context

Automated moderation should work without any third-party account (self-hosters, tests,
offline development), be able to use a strong classifier when the operator has one, and
apply the same policy whatever produced the scores. Classifier calls are slow and can fail.

## Decision

- One interface in [`services/moderation/providers.ts`](../../../apps/api/src/services/moderation/providers.ts): text and image URLs in, per-category
  scores 0 to 1 out.
  - `openai`: the OpenAI moderation endpoint (`omni-moderation-latest` by default),
    multimodal, with timeout and retries.
  - `rules`: no network; blocked terms, link spam and repeated messages.
  - `stub`: the OpenAI client pointed at a local fake ([`apps/moderation-stub`](../../../apps/moderation-stub/README.md)) that
    returns scores from markers in the text, for tests and local development.
- Scores are folded (`parent/child` into `parent` with max) so thresholds can be set per
  family.
- Policy is a pure function, [`domain/moderation-decision.ts`](../../../apps/api/src/domain/moderation-decision.ts): per-category `review` and `hide`
  thresholds from platform settings give `CLEAN`, `REVIEW` (queue, stays visible) or
  `HIDE` (hidden at once, case opened), then context adjustments (today: staff content never
  auto-hides).
- Scans run as `moderation.scan` jobs after commit; a provider failure fails the job so the
  queue retries, and the item stays `UNCHECKED` meanwhile.
- The classifier never removes content and never acts on accounts; people decide.

Details and defaults: [moderation.md](../moderation.md#thresholds-and-defaults).

## Consequences

Positive:

- Works out of the box with `rules`; switching to a classifier is configuration.
- The same policy, tests and desk regardless of provider; the integration suite runs under
  `rules` and `stub`.

Trade-offs:

- `rules` is crude: no images, no context.
- An OpenAI-compatible endpoint receives content and signed image URLs, a data-sharing
  decision for the operator.
- The provider in effect is stored in platform settings once an admin saves them, so the
  environment variable only seeds it.

## Alternatives considered

- **Hard-wiring one vendor.** Simplest code, but no offline or keyless mode.
- **Provider-specific policies.** Thresholds would mean different things per provider.
- **Synchronous scanning on write.** Slower writes and failures on the request path.
