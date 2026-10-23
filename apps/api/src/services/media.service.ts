/**
 * Uploads: the browser asks for a presigned PUT, uploads straight to storage, then calls
 * complete. Nothing the client says about the file is trusted past the first step: on
 * complete we HEAD the stored object (size must equal what was declared) and sniff its
 * first bytes (must match the declared type). Images are then re-encoded by the
 * media.process job, which strips EXIF and GPS and writes a thumbnail; until it has
 * (status READY) an image is shown to nobody but its uploader. HEIC the server cannot
 * decode is rejected rather than served with its metadata.
 *
 * Reading an upload (GET /media/:id) requires being able to see whatever it is attached
 * to; an unattached upload is visible only to its owner.
 */
import type { Media, UploadPurpose } from "@open-social/types";
import sharp from "sharp";
import { type Actor, isStaff, requireActive } from "../core/context";
import { withEffects } from "../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError, logger } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { checkDeclared, cleanFileName, isoBmffDuration, kindLimit, sniffMatches, storageKeyFor, wavDuration } from "../domain/media-rules";
import { storage, type PresignedPut } from "../integrations/storage";
import { consume } from "../middleware/rate-limit";
import { isPresentable, toMedia } from "../presenters/media.presenter";
import { mediaRepo, type MediaRow } from "../repositories/media.repository";
import { canReadCommunity, isBlockedEitherWay, notBlocked } from "../repositories/visibility";

const SNIFF_BYTES = 4096;
export const HEIC_UNSUPPORTED = "HEIC photos cannot be processed on this server; export the photo as JPEG and upload it again";
const THUMB_WIDTH = 640;
/** Durations are parsed in memory; past this size we skip it rather than buffer the file. */
const DURATION_PARSE_MAX_BYTES = 100 * 1024 * 1024;

export interface CreateUploadInput {
  purpose: UploadPurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function createUpload(actor: Actor, input: CreateUploadInput): Promise<{ uploadId: string; put: PresignedPut }> {
  requireActive(actor);
  const check = checkDeclared(input);
  if (!check.ok) {
    throw check.code === "MEDIA_TOO_LARGE" ? new HttpError(413, check.message, check.code, check.details) : badRequest(check.message, check.code, check.details);
  }
  await consume("media-upload", `u:${actor.id}`, 120, 3600);
  const id = newId();
  const key = storageKeyFor(input.purpose, id, check.ext);
  await mediaRepo.insert({
    id,
    owner_id: actor.id,
    purpose: input.purpose,
    kind: check.kind,
    mime_type: check.mimeType,
    file_name: cleanFileName(input.fileName),
    declared_size: input.sizeBytes,
    storage_key: key,
  });
  const put = await storage().presignPut(key, check.mimeType, input.sizeBytes);
  return { uploadId: id, put };
}

async function ownUpload(actor: Actor, id: string, exec: Executor = db): Promise<MediaRow> {
  const row = await mediaRepo.findById(id, exec);
  if (!row || row.owner_id !== actor.id || row.status === "DELETED") throw notFound("Upload not found", "UPLOAD_NOT_FOUND");
  return row;
}

async function reject(row: MediaRow, reason: string): Promise<void> {
  await mediaRepo.update(row.id, { status: "REJECTED", rejected_reason: reason.slice(0, 200) });
  await storage()
    .delete(row.storage_key)
    .catch((err) => captureError(err, { where: "media.reject.delete", uploadId: row.id }));
}

/** Verify what landed in storage, then hand the upload to the processing job. */
export async function completeUpload(actor: Actor, id: string): Promise<Media> {
  requireActive(actor);
  const row = await ownUpload(actor, id);
  if (row.status === "COMPLETE" || row.status === "READY") return toMedia(row);
  if (row.status === "REJECTED") throw badRequest("This upload was rejected", "MEDIA_REJECTED", { reason: row.rejected_reason });

  const store = storage();
  const head = await store.head(row.storage_key);
  if (!head) throw badRequest("The file has not been uploaded yet", "UPLOAD_MISSING");

  const declared = Number(row.declared_size);
  if (head.sizeBytes !== declared || head.sizeBytes > kindLimit(row.kind)) {
    await reject(row, "size mismatch");
    throw badRequest("The uploaded file does not match the declared size", "MEDIA_SIZE_MISMATCH");
  }
  const start = await store.readStart(row.storage_key, SNIFF_BYTES);
  if (!sniffMatches(row.mime_type, start)) {
    await reject(row, "content does not match type");
    throw badRequest("The file content does not match its type", "MEDIA_TYPE_MISMATCH");
  }

  const done = await withEffects(async (fx) => {
    const updated = await mediaRepo.transition(row.id, ["PENDING"], { status: "COMPLETE", size_bytes: head.sizeBytes, completed_at: new Date() });
    if (updated) fx.job("media.process", { uploadId: row.id });
    return updated;
  });
  // Inline jobs (tests, tiny installs) may have moved it to READY already.
  const fresh = (await mediaRepo.findById(row.id)) ?? done ?? row;
  return toMedia(fresh);
}

export async function deleteUpload(actor: Actor, id: string): Promise<void> {
  requireActive(actor);
  const row = await ownUpload(actor, id);
  if (await mediaRepo.isAttached(row.id)) throw conflict("This file is attached to something; remove it there first", "MEDIA_IN_USE");
  await mediaRepo.update(row.id, { status: "DELETED" });
  const store = storage();
  for (const key of [row.storage_key, row.thumb_key]) {
    if (key) await store.delete(key).catch((err) => captureError(err, { where: "media.delete", uploadId: row.id }));
  }
}

/** True when the viewer can see something this upload is attached to. */
async function canSeeParent(viewer: Actor | null, uploadId: string, exec: Executor = db): Promise<boolean> {
  const viewerId = viewer?.id ?? null;
  const post = await exec
    .selectFrom("post_media as pm")
    .innerJoin("posts as p", "p.id", "pm.post_id")
    .select("p.id")
    .where("pm.upload_id", "=", uploadId)
    .where("p.status", "=", "PUBLISHED")
    .where(canReadCommunity(viewer, "p.community_id"))
    .where(notBlocked(viewerId, "p.author_id"))
    .executeTakeFirst();
  if (post) return true;

  const comment = await exec
    .selectFrom("comments as c")
    .innerJoin("posts as p", "p.id", "c.post_id")
    .select("c.id")
    .where("c.upload_id", "=", uploadId)
    .where("c.status", "=", "PUBLISHED")
    .where("p.status", "=", "PUBLISHED")
    .where(canReadCommunity(viewer, "p.community_id"))
    .where(notBlocked(viewerId, "c.author_id"))
    .executeTakeFirst();
  if (comment) return true;

  if (viewer) {
    const chat = await exec
      .selectFrom("chat_message_media as cm")
      .innerJoin("chat_messages as m", "m.id", "cm.message_id")
      .innerJoin("community_members as mem", (j) => j.onRef("mem.community_id", "=", "m.community_id").on("mem.user_id", "=", viewer.id).on("mem.status", "=", "ACTIVE"))
      .select("m.id")
      .where("cm.upload_id", "=", uploadId)
      .where("m.status", "=", "PUBLISHED")
      .where(notBlocked(viewer.id, "m.sender_id"))
      .executeTakeFirst();
    if (chat) return true;

    const dm = await exec
      .selectFrom("dm_message_media as dmm")
      .innerJoin("dm_messages as m", "m.id", "dmm.message_id")
      .innerJoin("dm_participants as dp", (j) => j.onRef("dp.thread_id", "=", "m.thread_id").on("dp.user_id", "=", viewer.id).on("dp.state", "in", ["ACTIVE", "REQUESTED"]))
      .select("m.id")
      .where("dmm.upload_id", "=", uploadId)
      .where("m.status", "=", "PUBLISHED")
      .executeTakeFirst();
    if (dm) return true;
  }

  const profile = await exec
    .selectFrom("users")
    .select("id")
    .where((eb) => eb.or([eb("avatar_upload_id", "=", uploadId), eb("cover_upload_id", "=", uploadId)]))
    .where("status", "in", ["ACTIVE", "SUSPENDED"])
    .executeTakeFirst();
  if (profile && !(viewerId && (await isBlockedEitherWay(viewerId, profile.id, exec)))) return true;

  const community = await exec
    .selectFrom("communities")
    .select("id")
    .where((eb) => eb.or([eb("icon_upload_id", "=", uploadId), eb("cover_upload_id", "=", uploadId)]))
    .where("status", "=", "PUBLISHED")
    .executeTakeFirst();
  if (community) return true;

  const event = await exec
    .selectFrom("events as e")
    .select("e.id")
    .where("e.cover_upload_id", "=", uploadId)
    .where("e.content_status", "=", "PUBLISHED")
    .where((eb) => eb.or([eb("e.community_id", "is", null), canReadCommunity(viewer, "e.community_id")(eb)]))
    .executeTakeFirst();
  return !!event;
}

export async function getMedia(viewer: Actor | null, id: string): Promise<Media> {
  const row = await mediaRepo.findById(id);
  if (!row || (row.status !== "COMPLETE" && row.status !== "READY")) throw notFound("Media not found");
  const owner = viewer?.id === row.owner_id;
  // The uploader may see their own unprocessed image; nobody else sees one before its metadata is stripped.
  if (!owner && !isPresentable(row)) throw notFound("Media not found");
  if (!owner && !isStaff(viewer) && !(await canSeeParent(viewer, row.id))) throw notFound("Media not found");
  return toMedia(row);
}

// ─── Processing job ─────────────────────────────────────────────────────────

/**
 * media.process: images are re-encoded (auto-rotated, EXIF and GPS dropped, since sharp
 * writes no metadata unless asked) and get a 640px WebP thumbnail; video and audio get a
 * duration when the container is one we can parse cheaply. Then READY.
 */
export async function processUpload(uploadId: string): Promise<void> {
  const row = await mediaRepo.findById(uploadId);
  if (!row || row.status !== "COMPLETE") return;
  const store = storage();

  if (row.kind === "IMAGE") {
    const original = await store.get(row.storage_key);
    let processed: { data: Buffer; width: number; height: number } | null = null;
    try {
      processed = await reencodeImage(original, row.mime_type);
    } catch (err) {
      if (row.mime_type === "image/heic" || row.mime_type === "image/heif") {
        // The bundled libvips usually has no HEVC decoder. Serving the original would
        // publish its EXIF (GPS included), so the upload is refused with a reason the
        // web app can show instead.
        logger.warn({ uploadId }, "HEIC image could not be decoded; rejected");
        await reject(row, HEIC_UNSUPPORTED);
        return;
      }
      captureError(err, { where: "media.process", uploadId });
      await reject(row, "image could not be decoded");
      return;
    }
    await store.put(row.storage_key, processed.data, row.mime_type);
    const thumbKey = `${row.storage_key}.thumb.webp`;
    const thumb = await sharp(processed.data, { animated: false }).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    await store.put(thumbKey, thumb, "image/webp");
    await mediaRepo.transition(row.id, ["COMPLETE"], {
      status: "READY",
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
      thumb_key: thumbKey,
    });
    return;
  }

  let duration: number | null = null;
  if ((row.kind === "VIDEO" || row.kind === "AUDIO") && Number(row.size_bytes ?? 0) <= DURATION_PARSE_MAX_BYTES) {
    try {
      const buf = await store.get(row.storage_key);
      duration = row.mime_type.includes("wav") ? wavDuration(buf) : isoBmffDuration(buf);
    } catch (err) {
      captureError(err, { where: "media.duration", uploadId });
    }
  }
  await mediaRepo.transition(row.id, ["COMPLETE"], { status: "READY", duration_seconds: duration });
}

async function reencodeImage(input: Buffer, mime: string): Promise<{ data: Buffer; width: number; height: number }> {
  const animated = mime === "image/gif" || mime === "image/webp";
  let pipeline = sharp(input, { animated, failOn: "error" }).rotate();
  if (mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
  else if (mime === "image/png") pipeline = pipeline.png();
  else if (mime === "image/webp") pipeline = pipeline.webp({ quality: 88 });
  else if (mime === "image/gif") pipeline = pipeline.gif();
  else pipeline = pipeline.jpeg({ quality: 88 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const height = info.pageHeight ?? info.height;
  return { data, width: info.width, height };
}

/** maintenance.expire-uploads: abandoned, rejected and never-attached uploads. */
export async function expireUploads(batch = 500): Promise<number> {
  const store = storage();
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const rows = await mediaRepo.findExpired(batch);
    if (!rows.length) break;
    const deleted = new Set(await mediaRepo.deleteUnreferenced(rows.map((r) => r.id)));
    for (const r of rows) {
      if (!deleted.has(r.id)) continue;
      for (const key of [r.storage_key, r.thumb_key]) {
        if (key) await store.delete(key).catch((err) => captureError(err, { where: "media.expire", uploadId: r.id }));
      }
    }
    total += deleted.size;
    if (rows.length < batch) break;
  }
  return total;
}
