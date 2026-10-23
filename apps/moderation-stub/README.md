# Moderation stub

A dependency-free fake of the OpenAI moderation endpoint (`MODERATION_PROVIDER=stub`).

- `POST /v1/moderations` returns OpenAI-shaped `results[0].category_scores`.
- Text markers set scores: `[[mod:harassment=0.97]]` (any category, several allowed). Default 0.01.
- An image URL containing `flag-image` scores `sexual=0.99`. Local signed media URLs
  (`/api/media/local/<payload>.<sig>`) hide the storage key in a base64url payload, so
  the stub decodes that payload and checks it too.
- `GET /health` answers `{ ok: true }`. Port: `PORT`, default 5099. Run: `pnpm start`.
