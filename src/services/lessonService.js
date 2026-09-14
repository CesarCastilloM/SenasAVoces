// lessonService.js — Lesson Builder data layer (Supabase)
// Public reads: published lessons + their steps + word bank.
// Admin writes: gated by RLS (callers must be in the `admins` table).
import { supabase } from '../lib/supabaseClient';

export const STEP_TYPES = [
  'mostrar_seña',
  'elegir_correcta',
  'deletrear',
  'escucha_y_repite',
  'opcion_multiple',
  'emparejar',
];

// Step types that can reference several words (distractors, pairs, options)
export const MULTI_WORD_TYPES = new Set(['elegir_correcta', 'opcion_multiple', 'emparejar']);

const STEP_SELECT = 'id, lesson_id, position, type, word_id, word_ids, reps, explanation, hint, threshold';
const LESSON_SELECT = 'id, slug, title, level, module, position, status, intro_md, created_by, created_at, updated_at';
const WORD_SELECT = 'id, label, glyph, video_ref, thumbnail, hint, template, mov, tags';

// ─── Admin check ────────────────────────────────────────────────

export async function isAdminUser(userId) {
  if (!supabase || !userId) return false;
  const { data, error } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('isAdminUser:', error);
    return false;
  }
  return Boolean(data);
}

// ─── Public: published lessons → `modules` shape used by LearnPage ──
// Returns null when nothing is published or on error, so callers can
// fall back to the bundled curriculum.
export async function fetchPublishedModules({ iconForTitle } = {}) {
  if (!supabase) return null;

  const { data: lessons, error } = await supabase
    .from('lessons')
    .select(LESSON_SELECT)
    .eq('status', 'published')
    .order('position', { ascending: true });
  if (error) { console.error('fetchPublishedModules:', error); return null; }
  if (!lessons?.length) return null;

  const lessonIds = lessons.map((l) => l.id);
  const { data: steps, error: stepsErr } = await supabase
    .from('lesson_steps')
    .select(STEP_SELECT)
    .in('lesson_id', lessonIds)
    .order('position', { ascending: true });
  if (stepsErr) { console.error('fetchPublishedModules steps:', stepsErr); return null; }

  const wordIds = new Set();
  (steps || []).forEach((s) => {
    if (s.word_id) wordIds.add(s.word_id);
    (s.word_ids || []).forEach((w) => wordIds.add(w));
  });

  let wordsById = {};
  if (wordIds.size) {
    const { data: words, error: wordsErr } = await supabase
      .from('words')
      .select(WORD_SELECT)
      .in('id', [...wordIds]);
    if (wordsErr) { console.error('fetchPublishedModules words:', wordsErr); return null; }
    wordsById = Object.fromEntries((words || []).map((w) => [w.id, w]));
  }

  return lessons.map((lesson) => {
    const lessonSteps = (steps || [])
      .filter((s) => s.lesson_id === lesson.id)
      .sort((a, b) => a.position - b.position);

    // Map each step that has a primary word to the `items[]` shape the
    // student UI already understands; extra step metadata rides along.
    const items = lessonSteps
      .map((s) => {
        const w = s.word_id ? wordsById[s.word_id] : null;
        if (!w) return null;
        return {
          glyph: w.glyph || w.label,
          label: w.label,
          desc: s.explanation || w.hint || '',
          hint: s.hint || w.hint,
          template: w.template,
          mov: w.mov,
          video_ref: w.video_ref,
          thumbnail: w.thumbnail,
          stepType: s.type,
          reps: s.reps,
          threshold: s.threshold,
        };
      })
      .filter(Boolean);

    return {
      id: lesson.slug, // used as module_id in module_progress / sign_practice
      title: lesson.title,
      desc: `${items.length} señas · Nivel ${lesson.level}`,
      signs: items.length,
      status: 'current',
      items,
      level: lesson.level,
      intro_md: lesson.intro_md,
      icon: iconForTitle ? iconForTitle(lesson.title) : 'book',
    };
  });
}

// ─── Unlock state (server-side via get_my_lesson_unlocks RPC) ─────
// Returns { [slug]: { unlocked: boolean, missing: string[] } } or null
// on error / not configured — callers fall back to sequential logic.
export async function fetchLessonUnlocks() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_lesson_unlocks');
  if (error) { console.error('fetchLessonUnlocks:', error); return null; }
  const map = {};
  (data || []).forEach((r) => {
    map[r.slug] = { unlocked: r.is_unlocked, missing: r.missing_prereq_slugs || [] };
  });
  return map;
}

// ─── Prerequisites (admin) ──────────────────────────────────────

export async function adminListPrerequisites() {
  if (!supabase) return { data: [], error: new Error('Supabase no configurado') };
  return supabase.from('lesson_prerequisites').select('lesson_id, requires_lesson_id');
}

// ─── Word bank ──────────────────────────────────────────────────

export async function listWords() {
  if (!supabase) return { data: [], error: new Error('Supabase no configurado') };
  return supabase.from('words').select(WORD_SELECT).order('label', { ascending: true });
}

export async function upsertWord(word) {
  if (!supabase) return { data: null, error: new Error('Supabase no configurado') };
  return supabase.from('words').upsert(word, { onConflict: 'label' }).select(WORD_SELECT).single();
}

// ─── Admin: lesson CRUD ─────────────────────────────────────────

export async function adminListLessons() {
  if (!supabase) return { data: [], error: new Error('Supabase no configurado') };
  const { data, error } = await supabase
    .from('lessons')
    .select(`${LESSON_SELECT}, lesson_steps(count)`)
    .order('position', { ascending: true });
  return { data, error };
}

export async function adminGetLesson(id) {
  if (!supabase) return { data: null, error: new Error('Supabase no configurado') };
  const { data: lesson, error } = await supabase
    .from('lessons')
    .select(LESSON_SELECT)
    .eq('id', id)
    .single();
  if (error) return { data: null, error };

  const { data: steps, error: stepsErr } = await supabase
    .from('lesson_steps')
    .select(STEP_SELECT)
    .eq('lesson_id', id)
    .order('position', { ascending: true });
  if (stepsErr) return { data: null, error: stepsErr };

  const { data: prereqs, error: prereqErr } = await supabase
    .from('lesson_prerequisites')
    .select('requires_lesson_id')
    .eq('lesson_id', id);
  if (prereqErr) return { data: null, error: prereqErr };

  return {
    data: {
      ...lesson,
      steps: steps || [],
      requires: (prereqs || []).map((p) => p.requires_lesson_id),
    },
    error: null,
  };
}

// Upserts the lesson row, then replaces its steps in-order.
// `lesson.steps` is the full desired list; positions are rewritten 0..n.
export async function adminSaveLesson(lesson) {
  if (!supabase) return { data: null, error: new Error('Supabase no configurado') };

  const row = {
    slug: lesson.slug,
    title: lesson.title,
    level: lesson.level ?? 1,
    module: lesson.module || null,
    position: lesson.position ?? 0,
    status: lesson.status || 'draft',
    intro_md: lesson.intro_md || null,
    created_by: lesson.created_by || null,
  };
  if (lesson.id) row.id = lesson.id;

  const { data: saved, error } = await supabase
    .from('lessons')
    .upsert(row, lesson.id ? { onConflict: 'id' } : { onConflict: 'slug' })
    .select(LESSON_SELECT)
    .single();
  if (error) return { data: null, error };

  // Replace steps wholesale — simplest correct ordering strategy
  const { error: delErr } = await supabase
    .from('lesson_steps')
    .delete()
    .eq('lesson_id', saved.id);
  if (delErr) return { data: null, error: delErr };

  const steps = (lesson.steps || [])
    .filter((s) => s && s.type)
    .map((s, i) => ({
      lesson_id: saved.id,
      position: i,
      type: s.type,
      word_id: s.word_id || null,
      word_ids: s.word_ids || [],
      reps: s.reps ?? 1,
      explanation: s.explanation || null,
      hint: s.hint || null,
      threshold: s.threshold ?? null,
    }));

  if (steps.length) {
    const { error: insErr } = await supabase.from('lesson_steps').insert(steps);
    if (insErr) return { data: null, error: insErr };
  }

  // Replace prerequisites if the caller provided the list (requires = [lesson_id])
  if (Array.isArray(lesson.requires)) {
    const { error: pDelErr } = await supabase
      .from('lesson_prerequisites')
      .delete()
      .eq('lesson_id', saved.id);
    if (pDelErr) return { data: null, error: pDelErr };

    const rows = lesson.requires
      .filter((rid) => rid && rid !== saved.id)
      .map((rid) => ({ lesson_id: saved.id, requires_lesson_id: rid }));
    if (rows.length) {
      const { error: pInsErr } = await supabase.from('lesson_prerequisites').insert(rows);
      if (pInsErr) return { data: null, error: pInsErr };
    }
  }

  return { data: saved, error: null };
}

export async function adminSetLessonStatus(id, status) {
  if (!supabase) return { error: new Error('Supabase no configurado') };
  return supabase.from('lessons').update({ status }).eq('id', id);
}

export async function adminDeleteLesson(id) {
  if (!supabase) return { error: new Error('Supabase no configurado') };
  return supabase.from('lessons').delete().eq('id', id);
}
