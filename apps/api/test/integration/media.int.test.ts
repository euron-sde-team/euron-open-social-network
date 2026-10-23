import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { storage } from "../../src/integrations/storage";
import { expireUploads } from "../../src/services/media.service";
import { as, anon, createUser } from "./harness";
import { getUrl, putBytes, sharedCommunity, TINY_PNG, upload } from "./messaging-fixtures";

const S3 = config.STORAGE === "s3";

describe("upload flow", () => {
  test("a JPEG is re-encoded: EXIF and GPS stripped, auto-rotated, thumbnail written, READY", async () => {
    const u = await createUser();
    // 40x20 with orientation 6 (rotate 90): after auto-rotation it is 20x40.
    const jpeg = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "secret-owner", Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const { uploadId, res } = await upload(u, "POST", "holiday.jpg", "image/jpeg", jpeg);
    expect(res.body).toMatchObject({ id: uploadId, kind: "IMAGE", status: "READY", width: 20, height: 40, mimeType: "image/jpeg" });
    expect(res.body.thumbUrl).toEqual(expect.any(String));

    const stored = await getUrl(res.body.url);
    expect(stored.status).toBe(200);
    const meta = await sharp(stored.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
    expect(stored.body.includes(Buffer.from("secret-owner"))).toBe(false);

    const thumb = await getUrl(res.body.thumbUrl);
    expect(thumb.status).toBe(200);
    expect((await sharp(thumb.body).metadata()).format).toBe("webp");
  });

  test("content that does not match the declared type is REJECTED and deleted", async () => {
    const u = await createUser();
    const { uploadId, res } = await upload(u, "POST", "photo.png", "image/png", Buffer.from("<!doctype html><script>alert(1)</script>"), 400);
    expect(res.body.code).toBe("MEDIA_TYPE_MISMATCH");
    const row = await db.selectFrom("media_uploads").selectAll().where("id", "=", uploadId).executeTakeFirstOrThrow();
    expect(row.status).toBe("REJECTED");
    expect(await storage().head(row.storage_key)).toBeNull();
  });

  test("SVG, HTML, spoofed extensions and oversize files are refused up front", async () => {
    const u = await createUser();
    const bad = [
      { fileName: "x.svg", mimeType: "image/svg+xml", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { fileName: "x.html", mimeType: "text/html", code: "MEDIA_TYPE_NOT_ALLOWED", status: 400 },
      { fileName: "x.pdf", mimeType: "image/png", code: "MEDIA_EXTENSION_MISMATCH", status: 400 },
      { fileName: "x.png", mimeType: "image/png", code: "MEDIA_TOO_LARGE", status: 413, sizeBytes: 16 * 1024 * 1024 },
    ];
    for (const b of bad) {
      const res = await as(u).post("/api/media/uploads").send({ purpose: "POST", fileName: b.fileName, mimeType: b.mimeType, sizeBytes: b.sizeBytes ?? 100 }).expect(b.status);
      expect(res.body.code).toBe(b.code);
    }
  });

  test("completing before the bytes arrive is UPLOAD_MISSING; a size different from the declared one is rejected", async () => {
    const u = await createUser();
    const created = await as(u).post("/api/media/uploads").send({ purpose: "DM", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length + 10 }).expect(201);
    const missing = await as(u).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(400);
    expect(missing.body.code).toBe("UPLOAD_MISSING");
    if (!S3) {
      // The local signed PUT enforces the signed length, like S3 does.
      const put = await putBytes(created.body.put, TINY_PNG);
      expect(put.status).toBe(403);
    }
  });

  test("only the owner can complete or delete; others get 404", async () => {
    const [owner, other] = [await createUser(), await createUser()];
    const created = await as(owner).post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
    await putBytes(created.body.put, TINY_PNG);
    await as(other).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(404);
    await as(other).delete(`/api/media/uploads/${created.body.uploadId}`).expect(404);
    await as(owner).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(200);
    await as(owner).delete(`/api/media/uploads/${created.body.uploadId}`).expect(204);
  });

  test("an attached upload cannot be deleted; GET /media/:id follows the parent's visibility", async () => {
    const [a, b, outsider] = [await createUser(), await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const { uploadId } = await upload(a, "DM", "a.png", "image/png", TINY_PNG);
    const thread = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200);
    await as(a).post(`/api/dms/threads/${thread.body.id}/messages`).send({ body: "pic", mediaIds: [uploadId] }).expect(201);

    const del = await as(a).delete(`/api/media/uploads/${uploadId}`).expect(409);
    expect(del.body.code).toBe("MEDIA_IN_USE");
    await as(b).get(`/api/media/${uploadId}`).expect(200);
    await as(outsider).get(`/api/media/${uploadId}`).expect(404);
    await anon().get(`/api/media/${uploadId}`).expect(404);
  });
});

describe("local signed links", () => {
  test.skipIf(S3)("served with nosniff; documents download as attachments; tampered tokens fail", async () => {
    const u = await createUser();
    const pdf = Buffer.from("%PDF-1.4\n%test\n");
    const { res } = await upload(u, "POST", "notes.pdf", "application/pdf", pdf);
    const got = await getUrl(res.body.url);
    expect(got.status).toBe(200);
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-type"]).toContain("application/pdf");
    expect(got.headers["content-disposition"]).toMatch(/^attachment/);

    const img = await upload(u, "POST", "a.png", "image/png", TINY_PNG);
    const image = await getUrl(img.res.body.url);
    expect(image.headers["content-disposition"]).toBe("inline");

    const tampered = res.body.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
    expect((await getUrl(tampered)).status).toBe(403);
  });

  test.skipIf(S3)("a PUT with a different Content-Type than signed is refused", async () => {
    const u = await createUser();
    const created = await as(u).post("/api/media/uploads").send({ purpose: "POST", fileName: "a.png", mimeType: "image/png", sizeBytes: TINY_PNG.length }).expect(201);
    const res = await putBytes({ url: created.body.put.url, headers: { "Content-Type": "text/html" } }, TINY_PNG);
    expect(res.status).toBe(403);
  });
});

describe("expiry", () => {
  test("old pending, rejected and never-attached uploads are deleted; attached ones stay", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await sharedCommunity(a, b);
    const old = new Date(Date.now() - 72 * 3600_000);
    const created = await as(a).post("/api/media/uploads").send({ purpose: "POST", fileName: "p.png", mimeType: "image/png", sizeBytes: 10 }).expect(201);
    const unattached = await upload(a, "POST", "u.png", "image/png", TINY_PNG);
    const attached = await upload(a, "DM", "d.png", "image/png", TINY_PNG);
    const thread = await as(a).post("/api/dms/threads").send({ userId: b.id }).expect(200);
    await as(a).post(`/api/dms/threads/${thread.body.id}/messages`).send({ mediaIds: [attached.uploadId] }).expect(201);
    await db.updateTable("media_uploads").set({ created_at: old }).where("id", "in", [created.body.uploadId, unattached.uploadId, attached.uploadId]).execute();

    await expireUploads();
    const left = await db.selectFrom("media_uploads").select("id").where("id", "in", [created.body.uploadId, unattached.uploadId, attached.uploadId]).execute();
    expect(left.map((r) => r.id)).toEqual([attached.uploadId]);
  });
});
