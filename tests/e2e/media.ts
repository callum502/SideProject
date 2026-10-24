/*
 * Test media quick reference
 * Real image and video files, generated once with the ffmpeg-static dev dependency and cached in the OS temp folder.
 *
 * mediaFile                 A 320×240 sample of the given type, ready for setInputFiles or an upload request.
 * oversizedFile             A sparse file just over a size limit, for testing size checks without using the disk space.
 */

import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type MediaType = 'jpg' | 'png' | 'webp' | 'mp4' | 'webm' | 'mov';
export const MIME: Record<MediaType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
const dir = path.join(os.tmpdir(), 'sideproj-e2e-media');
const still = ['-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1'];
const clip = ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-pix_fmt', 'yuv420p'];
const recipes: Record<MediaType, string[]> = {
  jpg: still,
  png: still,
  webp: [...still, '-c:v', 'libwebp'],
  mp4: [...clip, '-c:v', 'libx264'],
  webm: [...clip, '-c:v', 'libvpx'],
  mov: [...clip, '-c:v', 'libx264'],
};

/**
 * Return a 320×240 sample file of the given type, generating it on first use.
 * @param type - File extension: jpg, png, webp, mp4, webm or mov.
 * @param name - File name the browser should report; defaults to `sample.<type>`.
 * @returns A file payload for setInputFiles, with its bytes for direct upload requests.
 */
export function mediaFile(type: MediaType, name = 'sample.' + type) {
  const file = path.join(dir, 'sample.' + type);
  if (!existsSync(file)) {
    if (!ffmpeg) throw new Error('ffmpeg-static has no binary for this platform.');
    mkdirSync(dir, { recursive: true });
    // Parallel workers may generate the same file: write privately, then rename into place.
    const temporary = path.join(dir, `sample.${process.pid}.${Date.now()}.${type}`);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...recipes[type], temporary]);
    // On Windows, renaming onto a file another worker has just created can fail; that worker's copy is identical.
    try {
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      if (!existsSync(file)) throw error;
    }
  }
  return { name, mimeType: MIME[type], buffer: readFileSync(file) };
}

/**
 * Create a sparse file one byte over the limit. Pass its path to setInputFiles, which cannot take buffers over 50 MB.
 * @param megabytes - Limit in MiB, as the app checks it.
 * @param type - Extension, which sets the type the browser reports.
 * @returns Path to the file.
 */
export function oversizedFile(megabytes: number, type: MediaType) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `oversized-${megabytes}mb.${type}`);
  const handle = openSync(file, 'w');
  try {
    ftruncateSync(handle, megabytes * 1024 * 1024 + 1);
  } finally {
    closeSync(handle);
  }
  return file;
}
