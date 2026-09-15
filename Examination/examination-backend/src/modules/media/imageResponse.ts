import { createReadStream, existsSync, promises as fsp } from "node:fs";
import type { Response } from "express";
import { Jimp } from "jimp";

// Image types Jimp can decode/resize. Animated GIF / SVG are streamed as-is.
const RESIZABLE = new Set(["image/png", "image/jpeg", "image/jpg", "image/bmp", "image/tiff"]);

/**
 * Send an image, optionally downscaled to `width` px (aspect preserved).
 *
 * - `width` falsy / unsupported type / image already smaller → original is streamed unchanged.
 * - Resized output is cached to disk next to the original (`<file>.w<width>.<ext>`) so the
 *   resize cost is paid once. Subsequent requests stream the cached thumbnail.
 * - Any resize failure falls back to streaming the original (never errors the request).
 */
export async function respondWithImage(
  res: Response,
  absolutePath: string,
  mimeType: string,
  width: number | null,
): Promise<void> {
  const mime = (mimeType || "").toLowerCase();

  if (!width || width <= 0 || !RESIZABLE.has(mime)) {
    streamFile(res, absolutePath, mimeType);
    return;
  }

  const safeW = Math.min(Math.max(Math.round(width), 32), 2000);
  const outMime = mime === "image/png" ? "image/png" : "image/jpeg";
  const ext = outMime === "image/png" ? "png" : "jpg";
  const cachePath = `${absolutePath}.w${safeW}.${ext}`;

  if (existsSync(cachePath)) {
    streamFile(res, cachePath, outMime);
    return;
  }

  try {
    const image = await Jimp.read(absolutePath);
    if (image.bitmap.width > safeW) {
      image.resize({ w: safeW }); // height auto, aspect preserved
    }
    const buf = await image.getBuffer(outMime as "image/jpeg" | "image/png");
    fsp.writeFile(cachePath, buf).catch(() => {}); // best-effort cache
    res.setHeader("Content-Type", outMime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(buf);
  } catch {
    streamFile(res, absolutePath, mimeType);
  }
}

/** Parse a `?w=` query value into a positive int, or null. */
export function parseWidthParam(value: unknown): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function streamFile(res: Response, path: string, mimeType: string): void {
  res.setHeader("Content-Type", mimeType);
  const stream = createReadStream(path);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Media file not found." });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}
