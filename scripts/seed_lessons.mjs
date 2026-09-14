// Seed script: migrates the bundled curriculum (src/data/lessons_glosario.js)
// into Supabase tables: words, lessons, lesson_steps.
//
// Usage:
//   node scripts/seed_lessons.mjs
//
// Env (reads .env automatically):
//   VITE_SUPABASE_URL            — reused from the frontend env
//   SUPABASE_SERVICE_ROLE_KEY    — required (bypasses RLS for the import)
//
// Idempotent: words upsert by label, lessons upsert by slug (G0..G7),
// steps are replaced per lesson.

import { createClient } from '@supabase/supabase-js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present (Node >= 20.6)
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  try { process.loadEnvFile(envPath); } catch (e) { console.warn('No se pudo leer .env:', e.message); }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan credenciales. Define SUPABASE_SERVICE_ROLE_KEY (y VITE_SUPABASE_URL) en .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { ALPHABET_LESSON, GLOSARIO_LESSONS } = await import(
  pathToFileURL(path.join(ROOT, 'src/data/lessons_glosario.js')).href
);

const ALL_LESSONS = [ALPHABET_LESSON, ...GLOSARIO_LESSONS];

const MODULE_NAME = {
  G0: 'Abecedario', G1: 'Números', G2: 'Expresiones', G3: 'Colores',
  G4: 'Familia', G5: 'Salud', G6: 'Educación', G7: 'Tecnología',
};

async function main() {
  // ── 1. Words (deduped by label across all lessons) ──
  const wordRows = new Map();
  for (const lesson of ALL_LESSONS) {
    for (const it of lesson.items) {
      const label = it.label;
      if (!wordRows.has(label)) {
        wordRows.set(label, {
          label,
          glyph: it.glyph || label,
          video_ref: it.video_ref || null,
          thumbnail: it.thumbnail || null,
          hint: it.hint || it.desc || null,
          template: it.template || null,
          mov: Boolean(it.mov),
          tags: [MODULE_NAME[lesson.id] || lesson.title].filter(Boolean),
        });
      }
    }
  }

  console.log(`Upserting ${wordRows.size} words…`);
  const { data: words, error: wErr } = await supabase
    .from('words')
    .upsert([...wordRows.values()], { onConflict: 'label' })
    .select('id, label');
  if (wErr) throw wErr;
  const wordIdByLabel = Object.fromEntries(words.map((w) => [w.label, w.id]));
  console.log(`  → ${words.length} words en Supabase`);

  // ── 2. Lessons ──
  const lessonRows = ALL_LESSONS.map((l, i) => ({
    slug: l.id,
    title: l.title,
    level: l.level || 1,
    module: MODULE_NAME[l.id] || l.title,
    position: i,
    status: 'published',
    intro_md: null,
  }));

  console.log(`Upserting ${lessonRows.length} lessons…`);
  const { data: lessons, error: lErr } = await supabase
    .from('lessons')
    .upsert(lessonRows, { onConflict: 'slug' })
    .select('id, slug');
  if (lErr) throw lErr;
  const lessonIdBySlug = Object.fromEntries(lessons.map((l) => [l.slug, l.id]));

  // ── 3. Steps: one mostrar_seña step per item ──
  for (const l of ALL_LESSONS) {
    const lessonId = lessonIdBySlug[l.id];
    const { error: dErr } = await supabase
      .from('lesson_steps').delete().eq('lesson_id', lessonId);
    if (dErr) throw dErr;

    const steps = l.items.map((it, i) => ({
      lesson_id: lessonId,
      position: i,
      type: 'mostrar_seña',
      word_id: wordIdByLabel[it.label] || null,
      word_ids: [],
      reps: 1,
      explanation: it.desc || null,
      hint: it.hint || null,
      threshold: null,
    }));

    const { error: sErr } = await supabase.from('lesson_steps').insert(steps);
    if (sErr) throw sErr;
    console.log(`  ${l.id} ${l.title}: ${steps.length} pasos`);
  }

  console.log('\nSeed completo. Lecciones publicadas:', lessonRows.length);
}

main().catch((e) => { console.error('Seed falló:', e); process.exit(1); });
