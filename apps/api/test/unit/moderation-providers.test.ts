import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { buildOpenAiPayload, foldScores, parseOpenAiResponse, stubProvider } from "../../src/services/moderation/providers";
import { startStub } from "../../../moderation-stub/server.mjs";

describe("OpenAI response parsing", () => {
  test("keeps every category and folds children into their parent with max", () => {
    const scores = foldScores({ harassment: 0.2, "harassment/threatening": 0.91, "self-harm/intent": 0.4, "self-harm": 0.1, "sexual/minors": 0.05 });
    expect(scores).toEqual({ harassment: 0.91, "harassment/threatening": 0.91, "self-harm/intent": 0.4, "self-harm": 0.4, "sexual/minors": 0.05, sexual: 0.05 });
  });

  test("parses a real-shaped response and merges several results", () => {
    const body = {
      id: "modr-1",
      model: "omni-moderation-latest",
      results: [
        { flagged: false, categories: { hate: false }, category_scores: { hate: 0.1, "violence/graphic": 0.3 } },
        { flagged: true, categories: { hate: true }, category_scores: { hate: 0.8, violence: 0.2 } },
      ],
    };
    expect(parseOpenAiResponse(body)).toEqual({ flagged: true, scores: { hate: 0.8, "violence/graphic": 0.3, violence: 0.3 } });
  });

  test("ignores non-numeric scores and rejects bodies without results", () => {
    expect(parseOpenAiResponse({ results: [{ flagged: false, category_scores: { hate: "x", spam: 0.5 } }] }).scores).toEqual({ spam: 0.5 });
    expect(() => parseOpenAiResponse({})).toThrow();
    expect(() => parseOpenAiResponse({ results: [{ flagged: true }] })).toThrow();
  });

  test("builds a multimodal input array", () => {
    expect(buildOpenAiPayload("m", { text: "hello", imageUrls: ["https://img.example/a.webp"] })).toEqual({
      model: "m",
      input: [
        { type: "text", text: "hello" },
        { type: "image_url", image_url: { url: "https://img.example/a.webp" } },
      ],
    });
    expect(buildOpenAiPayload("m", { text: "  " }).input).toEqual([]);
  });
});

describe("stub provider over the wire", () => {
  let stub: { url: string; close(): Promise<void> };
  const original = config.MODERATION_STUB_URL;
  beforeAll(async () => {
    stub = await startStub(0);
    config.MODERATION_STUB_URL = stub.url;
  });
  afterAll(async () => {
    config.MODERATION_STUB_URL = original;
    await stub.close();
  });

  test("text markers set scores and children fold into parents", async () => {
    const r = await stubProvider.moderate({ text: "hey [[mod:harassment/threatening=0.97]]" });
    expect(r.flagged).toBe(true);
    expect(r.scores.harassment).toBe(0.97);
    expect(r.scores.hate).toBe(0.01);
  });

  test("flag-image urls, plain and inside a local signed media token", async () => {
    expect((await stubProvider.moderate({ imageUrls: ["http://x/media/flag-image.webp"] })).scores.sexual).toBe(0.99);
    const token = Buffer.from("get|media/post/flag-image.png|999|").toString("base64url");
    expect((await stubProvider.moderate({ imageUrls: [`http://api.test/api/media/local/${token}.sig`] })).scores.sexual).toBe(0.99);
    expect((await stubProvider.moderate({ text: "plain" })).flagged).toBe(false);
  });

  test("retries 429 and 5xx twice, then gives up", async () => {
    let calls = 0;
    const flaky = http.createServer((req, res) => {
      calls += 1;
      req.resume();
      req.on("end", () => {
        if (calls < 3) {
          res.writeHead(503).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ results: [{ flagged: false, category_scores: { hate: 0.2 } }] }));
      });
    });
    await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", () => r()));
    const port = (flaky.address() as { port: number }).port;
    config.MODERATION_STUB_URL = `http://127.0.0.1:${port}`;
    try {
      expect((await stubProvider.moderate({ text: "x" })).scores.hate).toBe(0.2);
      expect(calls).toBe(3);
      calls = -100;
      await expect(stubProvider.moderate({ text: "x" })).rejects.toThrow(/503/);
    } finally {
      config.MODERATION_STUB_URL = stub.url;
      await new Promise((r) => flaky.close(r));
    }
  });
});
