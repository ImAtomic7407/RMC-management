/**
 * examPaperCache.ts
 *
 * Download and persist a full exam paper (question text + all images) to the
 * device's local file system.  Once cached the exam can be taken entirely
 * offline — no network is needed for question rendering.
 *
 * Storage layout:
 *   AsyncStorage key  →  @rmc_paper_v2_<examId>
 *                         { examId, cachedAt, questions: CachedQuestion[] }
 *
 *   FileSystem path   →  <documentDirectory>/exam_papers/<examId>/img_<n>.jpg
 *                         (one file per question_media item)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedMedia {
  access_url: string;    // original server-relative path (/api/student/…)
  local_uri?: string;    // file:// URI after download — undefined if download failed
}

export interface CachedOption {
  id: number;
  option_label: string;
  option_text: string | null;
  is_correct?: boolean;
}

export interface CachedQuestion {
  id: number;
  section_code: string;
  question_type: 'MCQ' | 'INTEGER';
  question_order: number;
  question_text: string | null;
  question_options: CachedOption[];
  question_media: CachedMedia[];
  correct_integer_answer?: string | null;
}

export interface CachedPaper {
  examId: number;
  cachedAt: number;
  questions: CachedQuestion[];
  /** true once all images that could be downloaded are done */
  imagesComplete: boolean;
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const KEY_PREFIX = '@rmc_paper_v2_';
const IMG_ROOT = (FileSystem.documentDirectory ?? '') + 'exam_papers/';

function paperKey(examId: number) { return `${KEY_PREFIX}${examId}`; }

async function ensureImgDir(examId: number): Promise<string> {
  const dir = `${IMG_ROOT}${examId}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function loadCachedPaper(examId: number): Promise<CachedPaper | null> {
  try {
    const raw = await AsyncStorage.getItem(paperKey(examId));
    return raw ? (JSON.parse(raw) as CachedPaper) : null;
  } catch {
    return null;
  }
}

export async function deleteCachedPaper(examId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(paperKey(examId));
    const dir = `${IMG_ROOT}${examId}/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {}
}

/**
 * Download one image to local storage.
 * Returns the local file:// URI on success, undefined on failure.
 * Idempotent — skips download if the file already exists.
 */
async function downloadImage(
  fullUrl: string,
  localPath: string,
  token: string | null,
): Promise<string | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localPath;
    const result = await FileSystem.downloadAsync(fullUrl, localPath, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (result.status === 200) return result.uri;
    // downloadAsync writes the response body to disk even on a non-200 (e.g. a
    // 401/redirect/error page). Delete that bad file so it isn't mistaken for a
    // valid cached image on the next run (getInfoAsync().exists would be true).
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    return undefined;
  } catch {
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    return undefined;
  }
}

/**
 * Download the full exam paper (questions JSON + all images) and persist it.
 *
 * @param examId     The exam ID
 * @param rawQuestions  Questions array returned by the server
 * @param imgBase    Base URL for image assets: getExamBaseUrl().replace(/\/api$/, '')
 * @param token      JWT token for Authorization header (from SecureStore)
 * @returns          Resolved CachedQuestion[] with local_uri set where downloaded
 */
export async function cacheExamPaper(
  examId: number,
  rawQuestions: any[],
  imgBase: string,
  token: string | null,
): Promise<CachedPaper> {
  const dir = await ensureImgDir(examId);
  let imgIdx = 0;
  let allImagesOk = true;

  // Pass 1 (synchronous): build the question structure with media placeholders and
  // collect every image download as a job with a stable, unique local filename.
  type DownloadJob = { url: string; path: string; entry: CachedMedia };
  const jobs: DownloadJob[] = [];

  const questions: CachedQuestion[] = rawQuestions.map((q): CachedQuestion => {
    const mediaList: CachedMedia[] = (q.question_media ?? []).map((m: any): CachedMedia => {
      // Assigned/proctored papers send the media path as `url`; static papers send
      // it as `access_url`. Accept either so images resolve in both flows.
      const mediaPath: string = m.access_url ?? m.url;
      // Derive a local filename from the index (access_url has no extension).
      const localPath = `${dir}img_${imgIdx++}.jpg`;
      const entry: CachedMedia = { access_url: mediaPath };
      jobs.push({ url: `${imgBase}${mediaPath}`, path: localPath, entry });
      return entry;
    });
    return {
      id: q.id,
      section_code: q.section_code,
      question_type: q.question_type,
      question_order: q.question_order,
      question_text: q.question_text ?? null,
      question_options: (q.question_options ?? []).map((o: any) => ({
        id: o.id,
        option_label: o.option_label,
        option_text: o.option_text ?? null,
        is_correct: o.is_correct,
      })),
      question_media: mediaList,
      correct_integer_answer: q.correct_integer_answer ?? null,
    };
  });

  // Pass 2: download with bounded concurrency so a paper with many images can't
  // exhaust memory / file descriptors / sockets and crash low-end devices.
  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const uri = await downloadImage(job.url, job.path, token);
      if (uri) job.entry.local_uri = uri;
      else allImagesOk = false;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()),
  );

  const paper: CachedPaper = {
    examId,
    cachedAt: Date.now(),
    questions,
    imagesComplete: allImagesOk,
  };

  await AsyncStorage.setItem(paperKey(examId), JSON.stringify(paper));
  return paper;
}

/**
 * Pre-download every question (and solution) image referenced by a practice
 * paper to local storage, reporting progress. Mutates each media object IN
 * PLACE, setting `local_uri` on success so the caller can persist the paper with
 * local file paths and render the attempt instantly + offline (no per-question
 * network wait). Images that fail (e.g. a solution that's still release-locked →
 * 403) simply keep no local_uri and fall back to the server URL at render time.
 *
 * @returns { total, ok } counts so the UI can confirm completeness.
 */
export async function prefetchPaperImages(
  examId: number,
  questions: any[],
  imgBase: string,
  token: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; ok: number }> {
  const dir = await ensureImgDir(examId);

  type Job = { url: string; path: string; media: any };
  const jobs: Job[] = [];
  let idx = 0;
  for (const q of questions) {
    const groups = [q.question_media, q.solution_media];
    for (const group of groups) {
      for (const m of group ?? []) {
        const mediaPath: string | undefined = m.access_url ?? m.url;
        if (!mediaPath) continue;
        jobs.push({ url: `${imgBase}${mediaPath}`, path: `${dir}img_${idx++}.jpg`, media: m });
      }
    }
  }

  const total = jobs.length;
  let done = 0;
  let ok = 0;
  onProgress?.(0, total);
  if (total === 0) return { total: 0, ok: 0 };

  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const uri = await downloadImage(job.url, job.path, token);
      if (uri) {
        job.media.local_uri = uri;
        ok++;
      }
      done++;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

  return { total, ok };
}

/**
 * Get the URI to pass to <Image source={{ uri }} /> for a media item.
 * Uses the local cached file if available, falls back to the server URL.
 * When using the server URL, include Authorization header separately.
 */
export function resolveMediaUri(
  media: CachedMedia,
  imgBase: string,
): { uri: string; isLocal: boolean } {
  if (media.local_uri) {
    return { uri: media.local_uri, isLocal: true };
  }
  return { uri: `${imgBase}${media.access_url}`, isLocal: false };
}
