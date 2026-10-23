/**
 * Fake moderation provider: speaks the OpenAI moderation wire format so the API's
 * "stub" provider exercises the same client code as production, with no network or key.
 *
 * Scores come from markers in the text, e.g. "[[mod:harassment=0.97]]" (any category,
 * several allowed). Everything else scores 0.01. An image whose URL contains
 * "flag-image" scores sexual=0.99; for a local signed media URL the storage key is
 * hidden in a base64url payload, so that payload is decoded and checked too.
 *
 *   PORT=5099 node server.mjs
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const CATEGORIES = [
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
];

const MARKER = /\[\[mod:([a-z/-]+)=([0-9.]+)\]\]/gi;

function imageFlagged(url) {
  if (typeof url !== "string") return false;
  if (url.includes("flag-image")) return true;
  const m = url.match(/\/api\/media\/local\/([A-Za-z0-9_-]+)\./);
  if (!m) return false;
  try {
    return Buffer.from(m[1], "base64url").toString("utf8").includes("flag-image");
  } catch {
    return false;
  }
}

export function score(input) {
  const items = Array.isArray(input) ? input : [{ type: "text", text: String(input ?? "") }];
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0.01]));
  for (const item of items) {
    if (typeof item === "string" || item?.type === "text") {
      const text = typeof item === "string" ? item : String(item.text ?? "");
      for (const [, cat, val] of text.matchAll(MARKER)) scores[cat.toLowerCase()] = Math.max(scores[cat.toLowerCase()] ?? 0, Number(val));
    } else if (item?.type === "image_url" && imageFlagged(item.image_url?.url)) {
      scores.sexual = Math.max(scores.sexual, 0.99);
    }
  }
  const categories = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v >= 0.5]));
  return { flagged: Object.values(categories).some(Boolean), categories, category_scores: scores };
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function handler(req, res) {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) return send(res, 200, { ok: true });
  if (req.method === "POST" && req.url === "/v1/moderations") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { error: { message: "invalid json" } });
      }
      send(res, 200, { id: `modr-stub-${Date.now()}`, model: body.model ?? "stub", results: [score(body.input)] });
    });
    return;
  }
  send(res, 404, { error: { message: "not found" } });
}

/** Start on `port` (0 = ephemeral). Tests import this. */
export function startStub(port = 0) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 5099);
  const server = http.createServer(handler);
  server.listen(port, "0.0.0.0", () => console.log(`moderation stub listening on ${port}`));
}
