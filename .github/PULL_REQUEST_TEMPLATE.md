## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, queue, realtime or mail code changed)
- [ ] `make test-matrix` (if storage, mail or moderation backends changed)
- [ ] `make e2e` (if a user flow or the infrastructure changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] `pnpm openapi` re-run if a route changed
- [ ] New migration instead of editing an applied one
- [ ] Private content (DMs, private communities, blocked users) stays private: covered by a test
- [ ] Realtime events are only emitted to sockets allowed to see them
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
