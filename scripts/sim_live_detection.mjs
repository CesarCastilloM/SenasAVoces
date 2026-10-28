// sim_live_detection.mjs — measures /model-test live detection offline.
//
// Usage:
//   node scripts/sim_live_detection.mjs             # every real recording, one process per CPU
//   node scripts/sim_live_detection.mjs --signs 40  # quick run on the first 40 signs
//   node scripts/sim_live_detection.mjs --save rows.json
//   node scripts/sim_live_detection.mjs --data otra/training_data
//
// Every real recording in public/training_data/examples.json plays as if it
// came from a 4:3 webcam at 30 fps (stretched to its duration, the first and
// last pose held 0.4 s) and is matched in two ways:
//
//   otra persona   patterns from everyone except whoever made the recording,
//                  for signs recorded by 2+ people: what a new user will get.
//   misma persona  patterns = augmentations, including those of the same
//                  recording: optimistic, the only option while a sign has a
//                  single signer.
//
//   before   old page loop: duplicated frames (rAF at 60 Hz), last-24 DTW
//            window, no aspect correction, thresholds 0.5 / 0.12 / 3.
//   after    LiveSignRecognizer with LIVE_DEFAULTS, patterns prepared like
//            reloadDynamicPatterns (aspect per example, resting hand removed).
//
// Thresholds are calibrated on the even-indexed signs and reported on the
// odd-indexed ones, so the reported rate is not fit to itself.

import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { parseNpy, npyToFrames } = await imp('src/utils/npy_parser.js');
const {
  DynamicSignDetector, LiveSignRecognizer, LIVE_DEFAULTS, acceptanceStep,
  frameInfo, correctFrameAspect, preparePatternFrames, selectPatternExamples,
} = await imp('src/utils/dynamic_sign_detector.js');

const CAM_ASPECT = 4 / 3;
const CAM_FPS = 30;
const HOLD_MS = 400;

// --data se pasa a los workers por el entorno (fork lo hereda).
const di = process.argv.indexOf('--data');
if (di > 0) process.env.SIM_DATA = path.resolve(process.argv[di + 1]);
const DATA = process.env.SIM_DATA || path.join(ROOT, 'public/training_data');
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'examples.json'), 'utf8'));
const signs = Object.entries(manifest).flatMap(([cat, list]) => (Array.isArray(list) ? list.filter((s) => index.examples[s]).map((sign) => ({ cat, sign })) : []));
const aspectOf = (e) => e.aspect ?? index.default_aspect;
const realsOf = (sign) => index.examples[sign].filter((e) => e.kind === 'real');

// One query per real recording; "otra persona" only where someone else also recorded the sign.
function buildQueries(limit) {
  const out = [];
  signs.slice(0, limit).forEach(({ cat, sign }, signIdx) => {
    const people = new Set(realsOf(sign).map((e) => e.signer));
    for (const e of realsOf(sign)) {
      out.push({ cat, sign, signIdx, n: e.n, signer: e.signer, aspect: aspectOf(e), seconds: e.seconds, mode: 'misma' });
      if (people.size > 1) out.push({ cat, sign, signIdx, n: e.n, signer: e.signer, aspect: aspectOf(e), seconds: e.seconds, mode: 'otra' });
    }
  });
  return out;
}

const cache = new Map();
function readFrames(cat, sign, n) {
  const key = `${sign}_${n}`;
  if (!cache.has(key)) {
    const b = fs.readFileSync(path.join(DATA, cat, `${sign}_${n}.npy`));
    cache.set(key, npyToFrames(parseNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))));
  }
  return cache.get(key);
}

// Patterns like reloadDynamicPatterns in /model-test (prepared) or the old page (raw).
function buildDetector(keep, prepared) {
  const det = new DynamicSignDetector();
  for (const { cat, sign } of signs) {
    for (const e of selectPatternExamples(index.examples[sign].filter(keep))) {
      const frames = readFrames(cat, sign, e.n);
      det.loadPattern(sign, prepared ? preparePatternFrames(frames, { aspect: aspectOf(e), cleanRestingHand: true }) : frames);
    }
  }
  return det;
}

function videoSeconds(sign) {
  const file = path.join(ROOT, 'public/videos/signs', `${sign}.mp4`);
  if (!fs.existsSync(file)) return 2;
  const m = (spawnSync(ffmpeg.path, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '').match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 2;
}

const lerp = (a, b, f) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * f, y: p.y + (b[i].y - p.y) * f, z: p.z + (b[i].z - p.z) * f }));
function stretch(frames, n) {
  const out = [];
  for (let t = 0; t < n; t++) {
    const s = (t * (frames.length - 1)) / Math.max(1, n - 1), i0 = Math.floor(s), i1 = Math.min(i0 + 1, frames.length - 1), f = s - i0;
    const hand = (k) => (frames[i0][k] && frames[i1][k] ? lerp(frames[i0][k], frames[i1][k], f) : (f < 0.5 ? frames[i0][k] || frames[i1][k] : frames[i1][k] || frames[i0][k]) || null);
    out.push({ landmarksRight: hand('landmarksRight'), landmarksLeft: hand('landmarksLeft') });
  }
  return out;
}

// The same physical motion as a 4:3 webcam would normalize it.
const toCam = (hand, aSrc) => hand && hand.map((p) => ({ x: 0.5 + (p.x - 0.5) * (aSrc / CAM_ASPECT), y: p.y, z: (p.z || 0) * (aSrc / CAM_ASPECT) }));

function liveFrames(q) {
  // `seconds` = hand frames of the source video (add_training_videos.py); the
  // original recordings only have the reference clip, which includes lead-in/out.
  const seconds = Math.min(3.5, Math.max(1, q.seconds ?? 0.8 * videoSeconds(q.sign)));
  const cam = stretch(readFrames(q.cat, q.sign, q.n), Math.round(seconds * CAM_FPS))
    .map((f) => ({ landmarksRight: toCam(f.landmarksRight, q.aspect), landmarksLeft: toCam(f.landmarksLeft, q.aspect) }));
  const hold = Math.round((HOLD_MS / 1000) * CAM_FPS);
  return [...Array(hold).fill(cam[0]), ...cam, ...Array(hold).fill(cam[cam.length - 1])];
}

function runBefore(det, target, live) {
  det.clearBuffer();
  let stable = null, count = 0, n = 0, top1 = false;
  const pushes = live.flatMap((f) => [f, f]); // rAF a 60 Hz sobre una cámara de 30 fps
  for (const f of pushes) {
    det.pushFrameInfo(frameInfo(f.landmarksRight, f.landmarksLeft));
    n++;
    if (det.buffer.length < 15 || n % 3 !== 0) continue;
    const r = det.detectRanking();
    if (!r.length) continue;
    const g = r[0], margin = r.length > 1 ? r[1].score - g.score : Infinity;
    top1 ||= g.name === target;
    if (g.score > 2.5) { det.clearBuffer(); stable = null; count = 0; continue; }
    if (g.score < 0.5 && margin > 0.12) {
      count = stable === g.name ? count + 1 : 1;
      stable = g.name;
      if (count >= 3) return { outcome: g.name === target ? 'correct' : 'wrong', top1 };
    } else { stable = null; count = 0; }
  }
  return { outcome: 'none', top1 };
}

function runAfter(det, target, live) {
  const rec = new LiveSignRecognizer(det);
  const evals = [];
  let ms = 0;
  live.forEach((f, i) => {
    const t0 = performance.now();
    const res = rec.push(correctFrameAspect(f, CAM_ASPECT), (i * 1000) / CAM_FPS);
    if (!res) return;
    ms += performance.now() - t0;
    const r = res.ranking;
    evals.push(r.length ? [r[0].name, r[0].score, res.margin, res.elapsedMs] : [null, Infinity, Infinity, res.elapsedMs]);
  });
  return { evals, top1: evals.some((e) => e[0] === target), ms, n: evals.length };
}

async function worker(idx, total, limit) {
  const mine = buildQueries(limit).filter((_, i) => i % total === idx);
  const detectors = new Map();
  const detector = (key, make) => detectors.get(key) ?? detectors.set(key, make()).get(key);
  const out = [];
  for (const q of mine) {
    const live = liveFrames(q);
    const row = { sign: q.sign, signIdx: q.signIdx, signer: q.signer, mode: q.mode };
    if (q.mode === 'misma') {
      row.before = runBefore(detector('raw', () => buildDetector((e) => e.kind === 'aug', false)), q.sign, live);
      row.after = runAfter(detector('aug', () => buildDetector((e) => e.kind === 'aug', true)), q.sign, live);
    } else {
      row.after = runAfter(detector(`sin:${q.signer}`, () => buildDetector((e) => e.signer !== q.signer, true)), q.sign, live);
    }
    out.push(row);
  }
  process.send(out);
}

function firstAcceptance(evals, target, opts) {
  let state = { name: null, count: 0 };
  for (const [name, score, margin, elapsedMs] of evals) {
    const step = acceptanceStep(state, name ? [{ name, score }, { name: '', score: score + margin }] : [], opts, elapsedMs);
    state = { name: step.name, count: step.count };
    if (step.accepted) return name === target ? 'correct' : 'wrong';
  }
  return 'none';
}

function tally(rows, opts) {
  const t = { correct: 0, wrong: 0, none: 0, n: rows.length };
  for (const r of rows) t[opts ? firstAcceptance(r.after.evals, r.sign, opts) : r.before.outcome]++;
  return t;
}

// Best rule on `rows` among those with precision >= minPrecision.
function calibrate(rows, minPrecision) {
  let best = null;
  for (const scoreThreshold of [1.2, 1.5, 2.0, Infinity])
    for (const marginThreshold of [0.15, 0.2, 0.25, 0.3, 0.4, 0.5])
      for (const relMarginThreshold of [0, 0.2, 0.3, 0.5])
        for (const minAcceptMs of [0, 600, 900, 1200, 1500]) {
          const opts = { ...LIVE_DEFAULTS, scoreThreshold, marginThreshold, relMarginThreshold, minAcceptMs };
          const t = tally(rows, opts);
          const precision = t.correct / Math.max(1, t.correct + t.wrong);
          if (precision >= minPrecision && (!best || t.correct > best.t.correct)) best = { opts, t };
        }
  return best;
}

const pct = (x, n) => `${x}/${n} (${Math.round((100 * x) / Math.max(1, n))}%)`;
const line = (label, t) => console.log(`  ${label.padEnd(40)} correcta ${pct(t.correct, t.n).padEnd(15)} equivocada ${pct(t.wrong, t.n).padEnd(14)} sin detección ${pct(t.none, t.n)}`);

function report(title, rows) {
  const evals = rows.reduce((a, r) => a + r.after.n, 0), ms = rows.reduce((a, r) => a + r.after.ms, 0);
  console.log(`${title}  (#1 correcto en algún momento: ${pct(rows.filter((r) => r.after.top1).length, rows.length)}, ${(ms / Math.max(1, evals)).toFixed(1)} ms por evaluación)`);
  line('LIVE_DEFAULTS (los de la app)', tally(rows, LIVE_DEFAULTS));
  const calib = rows.filter((r) => r.signIdx % 2 === 0), test = rows.filter((r) => r.signIdx % 2 === 1);
  if (calib.length < 40) return;
  for (const p of [0.9, 0.8]) {
    const c = calibrate(calib, p);
    if (!c) { console.log(`  precisión ≥${p * 100}%: sin combinación posible`); continue; }
    const o = c.opts;
    line(`calibrado p≥${p * 100}% (${o.scoreThreshold}/${o.marginThreshold}/${o.relMarginThreshold}/${o.minAcceptMs}ms) prueba`, tally(test, o));
  }
}

if (process.argv[2] === '--worker') {
  await worker(Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]));
} else {
  const li = process.argv.indexOf('--signs');
  const limit = li > 0 ? Number(process.argv[li + 1]) : signs.length;
  const queries = buildQueries(limit);
  const total = Math.min(os.cpus().length, queries.length);
  const self = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: total }, (_, i) => new Promise((resolve, reject) => {
    const child = fork(self, ['--worker', String(i), String(total), String(limit)]);
    child.on('message', resolve);
    child.on('exit', (code) => code && reject(new Error(`worker ${i} exit ${code}`)));
  })));
  const rows = parts.flat().sort((a, b) => a.signIdx - b.signIdx);
  const si = process.argv.indexOf('--save');
  if (si > 0) fs.writeFileSync(process.argv[si + 1], JSON.stringify(rows));

  const misma = rows.filter((r) => r.mode === 'misma'), otra = rows.filter((r) => r.mode === 'otra');
  const people = new Set(otra.map((r) => r.signer));
  console.log(`${Math.min(limit, signs.length)} señas · ${misma.length} grabaciones reales · ${Math.round((Date.now() - t0) / 1000)} s\n`);

  if (otra.length) {
    report(`Otra persona · ${otra.length} grabaciones de ${new Set(otra.map((r) => r.sign)).size} señas, ${people.size} personas`, otra);
  } else {
    console.log('Otra persona: ninguna seña tiene grabaciones de 2+ personas todavía (ver videos_entrenamiento/README.md).');
  }
  console.log();
  console.log('Misma persona · antes (página original):');
  line('umbrales 0.5 / 0.12 / 3', tally(misma));
  report('Misma persona · después', misma);
}
