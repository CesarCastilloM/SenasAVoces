// build_video_aspect.mjs — writes public/training_data/video_aspect.json with
// the width/height ratio of each sign's source video.
//
// Usage:
//   node scripts/build_video_aspect.mjs
//
// Why: MediaPipe returns x and y normalized to [0,1] per axis, so the same
// hand looks "stretched" differently in a 9:16, 4:5 or 16:9 video than in the
// 4:3 webcam. The live detector rescales x by this ratio (see
// correctFrameAspect in src/utils/dynamic_sign_detector.js) so patterns and
// camera share one geometry. public/videos/signs/*.mp4 are compressed with
// scale=-2:360 (compress_reference_videos.py), which keeps the source ratio.
// Signs without a video (letters A–K, recorded from the webcam) use `default`.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIGNS_DIR = path.join(ROOT, 'public/videos/signs');
const OUT_FILE = path.join(ROOT, 'public/training_data/video_aspect.json');
const WEBCAM_ASPECT = 4 / 3;

const signs = {};
for (const file of fs.readdirSync(SIGNS_DIR).filter((f) => f.endsWith('.mp4')).sort()) {
  const probe = spawnSync(ffmpeg.path, ['-hide_banner', '-i', path.join(SIGNS_DIR, file)], { encoding: 'utf8' });
  const m = (probe.stderr || '').match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
  if (!m) { console.warn(`Sin dimensiones: ${file}`); continue; }
  signs[file.replace(/\.mp4$/, '')] = +(Number(m[1]) / Number(m[2])).toFixed(4);
}

fs.writeFileSync(OUT_FILE, JSON.stringify({ default: +WEBCAM_ASPECT.toFixed(4), signs }, null, 2) + '\n');
console.log(`${Object.keys(signs).length} videos → ${path.relative(ROOT, OUT_FILE)}`);
