// fix_word_videos.mjs — repoint words.video_ref from YouTube (glosario CDMX)
// to our own local mp4s in public/videos/signs/.
//
// Usage:
//   node scripts/fix_word_videos.mjs            # dry-run: report only
//   node scripts/fix_word_videos.mjs --apply    # update Supabase + lessons_glosario.js
//   node scripts/fix_word_videos.mjs --apply --unpublish-missing
//       # additionally drafts published lessons where EVERY step word lacks
//       # a local video (safe default is OFF: unmatched words keep YouTube
//       # as placeholder — decide explicitly, see report).
//
// Matching: normalize(label) vs normalize(filename-without-ext) where
// normalize = uppercase, strip accents, strip everything except A-Z0-9.
// Variant labels like "15 (1)" normalize to "151" — they do NOT match "15.mp4";
// when a bare file exists but only variant labels exist, it's reported as
// AMBIGUOUS and left untouched.

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIGNS_DIR = path.join(ROOT, 'public/videos/signs');
const SOURCE_FILE = path.join(ROOT, 'src/data/lessons_glosario.js');
const REPORT_FILE = path.join(ROOT, 'scripts/out/word_video_report.json');

const APPLY = process.argv.includes('--apply');
const UNPUBLISH_MISSING = process.argv.includes('--unpublish-missing');

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch (e) { console.warn('No se pudo leer .env:', e.message); }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan credenciales: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function prettyLabel(filename) {
  // BUENOS_DIAS.mp4 -> "BUENOS DIAS"; DESIERTO_ABC.mp4 -> "DESIERTO"
  return filename.replace(/\.mp4$/i, '').replace(/_ABC$/i, '').replace(/_/g, ' ');
}

async function main() {
  // ── 1. Local files ──
  const files = fs.readdirSync(SIGNS_DIR).filter((f) => f.toLowerCase().endsWith('.mp4'));
  const fileByNorm = new Map(); // norm -> filename
  for (const f of files) {
    const n = norm(f.replace(/\.mp4$/i, ''));
    if (fileByNorm.has(n)) console.warn(`⚠ colisión de normalización: ${fileByNorm.get(n)} y ${f}`);
    fileByNorm.set(n, f);
  }

  // ── 2. Words from Supabase ──
  const { data: words, error } = await supabase
    .from('words').select('id, label, glyph, video_ref, thumbnail').order('label');
  if (error) throw error;

  // Index labels by norm to detect variant-only cases
  const labelNorms = new Set(words.map((w) => norm(w.label)));

  const matched = [];     // { id, label, file, oldRef }
  const ambiguous = [];   // { label, baseFile }
  const unmatched = [];   // labels still pointing at YouTube
  const usedFiles = new Set();

  for (const w of words) {
    const n = norm(w.label);
    if (fileByNorm.has(n)) {
      const file = fileByNorm.get(n);
      matched.push({ id: w.id, label: w.label, file, oldRef: w.video_ref });
      usedFiles.add(file);
      continue;
    }
    // variant? "15 (1)" -> base "15"
    const m = w.label.match(/^(.*?)\s*\(\s*\d+\s*\)\s*$/);
    if (m && fileByNorm.has(norm(m[1])) && !labelNorms.has(norm(m[1]))) {
      ambiguous.push({ label: w.label, baseFile: fileByNorm.get(norm(m[1])) });
      usedFiles.add(fileByNorm.get(norm(m[1])));
      continue;
    }
    unmatched.push({ id: w.id, label: w.label, video_ref: w.video_ref });
  }

  const orphanFiles = files
    .filter((f) => !usedFiles.has(f))
    .map((f) => ({ file: f, suggested_label: prettyLabel(f) }));

  // ── 3. Report ──
  console.log(`\n=== REPORTE (dry-run${APPLY ? ' — APPLY activo' : ''}) ===`);
  console.log(`Words en Supabase: ${words.length} | mp4 locales: ${files.length}`);
  console.log(`(a) MATCHES (word ↔ mp4): ${matched.length}`);
  matched.forEach((x) => console.log(`   ${x.label.padEnd(32)} → ${x.file}`));
  console.log(`(b) SIN MATCH (siguen en YouTube): ${unmatched.length}`);
  unmatched.forEach((x) => console.log(`   ${x.label}`));
  console.log(`(c) mp4 HUÉRFANOS (sin word): ${orphanFiles.length}`);
  orphanFiles.forEach((x) => console.log(`   ${x.file.padEnd(30)} sugerido: "${x.suggested_label}"`));
  console.log(`(d) AMBIGUOS — archivo existe pero el label es variante "(n)": ${ambiguous.length}`);
  ambiguous.forEach((x) => console.log(`   ${x.label.padEnd(32)} ↔ ¿${x.baseFile}?`));

  // per-lesson coverage for the unpublish decision
  const { data: steps } = await supabase.from('lesson_steps').select('lesson_id, word_id');
  const { data: lessons } = await supabase.from('lessons').select('id, slug, title, status');
  const matchedIds = new Set(matched.map((m) => m.id));
  const coverage = (lessons || []).map((l) => {
    const ids = (steps || []).filter((s) => s.lesson_id === l.id).map((s) => s.word_id).filter(Boolean);
    const ok = ids.filter((id) => matchedIds.has(id)).length;
    return { id: l.id, slug: l.slug, title: l.title, status: l.status, total: ids.length, local: ok };
  });
  console.log('\nCobertura por lección (palabras con video local / total):');
  coverage.forEach((c) => console.log(`   ${c.slug.padEnd(10)} ${String(c.local).padStart(3)}/${c.total}  ${c.status}  ${c.title}`));

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify({ matched, unmatched, orphanFiles, ambiguous, coverage }, null, 2));
  console.log(`\nReporte JSON: ${path.relative(ROOT, REPORT_FILE)}`);
  console.log(`\nDecisión pendiente: las ${unmatched.length} words sin video local conservan YouTube como placeholder.`);
  console.log(`Para despublicar lecciones con cobertura local 0, re-corre con --apply --unpublish-missing.`);

  if (!APPLY) { console.log('\nDry-run: nada se escribió. Usa --apply para actualizar Supabase + lessons_glosario.js'); return; }

  // ── 4. Apply: Supabase words ──
  console.log('\nAplicando cambios…');
  let ok = 0;
  for (const m of matched) {
    const { error: uErr } = await supabase
      .from('words')
      .update({ video_ref: `/videos/signs/${m.file}`, thumbnail: null })
      .eq('id', m.id);
    if (uErr) { console.error(`  ✗ ${m.label}: ${uErr.message}`); continue; }
    ok++;
  }
  console.log(`  words actualizadas: ${ok}/${matched.length}`);

  // Optionally draft lessons with zero local coverage
  if (UNPUBLISH_MISSING) {
    for (const c of coverage) {
      if (c.status === 'published' && c.total > 0 && c.local === 0) {
        const { error: dErr } = await supabase.from('lessons').update({ status: 'draft' }).eq('id', c.id);
        console.log(dErr ? `  ✗ draft ${c.slug}: ${dErr.message}` : `  → ${c.slug} movida a draft (0/${c.total} videos locales)`);
      }
    }
  }

  // ── 5. Apply: lessons_glosario.js source (matched entries → local) ──
  const fileSet = new Map(matched.map((m) => [m.label, m.file]));
  let src = fs.readFileSync(SOURCE_FILE, 'utf8');
  let srcUpdated = 0;
  const lines = src.split('\n').map((line) => {
    if (!line.includes('"video_ref"') || !line.includes('"label"')) return line;
    const lm = line.match(/"label":\s*"((?:[^"\\]|\\.)*)"/);
    if (!lm) return line;
    const file = fileSet.get(lm[1]);
    if (!file) return line;
    srcUpdated++;
    return line
      .replace(/"video_ref":\s*"[^"]*"/, `"video_ref": "/videos/signs/${file}"`)
      .replace(/"thumbnail":\s*"[^"]*"/, '"thumbnail": null');
  });
  fs.writeFileSync(SOURCE_FILE, lines.join('\n'));
  console.log(`  lessons_glosario.js: ${srcUpdated} entradas actualizadas a mp4 local`);
  console.log('\nListo.');
}

main().catch((e) => { console.error('Falló:', e); process.exit(1); });
