// admin_lessons_page.jsx — Lesson Builder
// Panel de autor para crear/editar/publicar lecciones sin tocar código.
// Ruta: /admin/lessons (requiere sesión + fila en la tabla `admins`).

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  STEP_TYPES,
  MULTI_WORD_TYPES,
  isAdminUser,
  adminListLessons,
  adminGetLesson,
  adminSaveLesson,
  adminSetLessonStatus,
  adminDeleteLesson,
  listWords,
  upsertWord,
} from "../services/lessonService.js";

function cx(...c) { return c.filter(Boolean).join(" "); }

const TYPE_META = {
  mostrar_seña:      { label: "Mostrar seña",        needsWord: true,  desc: "Video + práctica con cámara" },
  elegir_correcta:   { label: "Elegir la correcta",  needsWord: true,  desc: "Ver la palabra, elegir la seña" },
  deletrear:         { label: "Deletrear",           needsWord: true,  desc: "Deletrear letra por letra" },
  escucha_y_repite:  { label: "Escucha y repite",    needsWord: true,  desc: "Observar y repetir la seña" },
  opcion_multiple:   { label: "Opción múltiple",     needsWord: true,  desc: "Pregunta con opciones" },
  emparejar:         { label: "Emparejar",           needsWord: true,  desc: "Unir pares palabra↔seña" },
};

const newStep = (position) => ({
  position,
  type: "mostrar_seña",
  word_id: null,
  word_ids: [],
  reps: 1,
  explanation: "",
  hint: "",
  threshold: null,
  _word: null,      // resolved word object (UI only, stripped on save)
  _extraWords: [],  // resolved distractor words (UI only)
});

const newLessonDraft = (position) => ({
  id: null,
  slug: "",
  title: "",
  level: 1,
  module: "",
  position,
  status: "draft",
  intro_md: "",
  steps: [newStep(0)],
});

function slugify(text) {
  return (text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "leccion";
}

function isYouTube(url) {
  return /youtube\.com|youtu\.be/.test(url || "");
}

function videoPreviewUrl(url) {
  if (!url) return null;
  if (isYouTube(url)) return url; // already an embed url in our data
  return url;                     // mp4 path like /videos/signs/1.mp4
}

// ─── Small UI atoms ─────────────────────────────────────────────

function Badge({ children, tone, isDark }) {
  const tones = {
    green:  "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    amber:  "bg-amber-500/15 text-amber-500 border-amber-500/30",
    slate:  isDark ? "bg-brand-deep text-brand-soft border-brand-line/40" : "bg-gray-100 text-gray-500 border-gray-300",
    teal:   "bg-[#2AABB8]/15 text-[#2AABB8] border-[#2AABB8]/30",
  };
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", tones[tone] || tones.slate)}>
      {children}
    </span>
  );
}

function Field({ label, isDark, children }) {
  return (
    <label className="block">
      <span className={cx("mb-1 block text-[11px] font-bold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-[#8C6A4A]")}>{label}</span>
      {children}
    </label>
  );
}

function inputCls(isDark) {
  return cx(
    "w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-[#2AABB8]/40",
    isDark ? "border-brand-line/40 bg-brand-deep text-white placeholder:text-[#5A8A94]" : "border-gray-300 bg-white text-brand-ink placeholder:text-[#8AA8B0]"
  );
}

// ─── Word picker modal ──────────────────────────────────────────

function WordPickerModal({ isDark, words, multi, initialSelection, onClose, onSelect, onWordCreated }) {
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(initialSelection || []);
  const [showNew, setShowNew] = useState(false);
  const [nw, setNw] = useState({ label: "", glyph: "", video_ref: "", thumbnail: "", hint: "" });
  const [savingWord, setSavingWord] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) => (w.label || "").toLowerCase().includes(q) || (w.glyph || "").toLowerCase().includes(q));
  }, [words, search]);

  const togglePick = (w) => {
    if (!multi) { setPicked([w]); setPreview(w); return; }
    setPicked((prev) => prev.some((p) => p.id === w.id) ? prev.filter((p) => p.id !== w.id) : [...prev, w]);
    setPreview(w);
  };

  const ytThumb = (url) => {
    const m = (url || "").match(/(?:embed\/|v=|youtu\.be\/)([^"&?/\s]{11})/);
    return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : "";
  };

  const createWord = async () => {
    if (!nw.label.trim()) return;
    setSavingWord(true);
    const row = {
      label: nw.label.trim().toUpperCase(),
      glyph: nw.glyph.trim() || nw.label.trim().toUpperCase(),
      video_ref: nw.video_ref.trim() || null,
      thumbnail: nw.thumbnail.trim() || ytThumb(nw.video_ref) || null,
      hint: nw.hint.trim() || null,
    };
    const { data, error } = await upsertWord(row);
    setSavingWord(false);
    if (error) { alert("Error creando palabra: " + error.message); return; }
    onWordCreated(data);
    setShowNew(false);
    setNw({ label: "", glyph: "", video_ref: "", thumbnail: "", hint: "" });
    togglePick(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={cx("flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border shadow-2xl", isDark ? "border-brand-line/40 bg-brand-card" : "border-gray-200 bg-white")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cx("flex items-center justify-between gap-3 border-b px-5 py-4", isDark ? "border-brand-line/30" : "border-gray-200")}>
          <div>
            <h3 className={cx("font-display text-lg font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Banco de palabras</h3>
            <p className={cx("text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>
              {multi ? "Selecciona una o varias palabras (la primera es la respuesta)" : "Selecciona la palabra del paso"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNew((v) => !v)} className="btn-press rounded-xl bg-[#2AABB8]/15 px-3 py-2 text-xs font-bold text-[#2AABB8] hover:bg-[#2AABB8]/25">
              + Nueva palabra
            </button>
            <button onClick={onClose} className={cx("btn-press rounded-xl px-3 py-2 text-xs font-bold", isDark ? "bg-brand-deep text-brand-soft" : "bg-gray-100 text-gray-600")}>
              Cerrar
            </button>
          </div>
        </div>

        {showNew && (
          <div className={cx("grid gap-3 border-b px-5 py-4 sm:grid-cols-2", isDark ? "border-brand-line/30 bg-brand-deep/40" : "border-gray-200 bg-gray-50")}>
            <Field label="Palabra / seña *" isDark={isDark}><input className={inputCls(isDark)} value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} placeholder="GRACIAS" /></Field>
            <Field label="Glyph (abrev.)" isDark={isDark}><input className={inputCls(isDark)} value={nw.glyph} onChange={(e) => setNw({ ...nw, glyph: e.target.value })} /></Field>
            <Field label="Video URL (YouTube embed o .mp4)" isDark={isDark}><input className={inputCls(isDark)} value={nw.video_ref} onChange={(e) => setNw({ ...nw, video_ref: e.target.value })} placeholder="https://www.youtube.com/embed/…" /></Field>
            <Field label="Thumbnail (opcional)" isDark={isDark}><input className={inputCls(isDark)} value={nw.thumbnail} onChange={(e) => setNw({ ...nw, thumbnail: e.target.value })} placeholder="auto desde YouTube" /></Field>
            <Field label="Hint" isDark={isDark}><input className={inputCls(isDark)} value={nw.hint} onChange={(e) => setNw({ ...nw, hint: e.target.value })} /></Field>
            <div className="flex items-end">
              <button onClick={createWord} disabled={savingWord || !nw.label.trim()} className="btn-press w-full rounded-xl bg-[#D97736] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                {savingWord ? "Guardando…" : "Crear y seleccionar"}
              </button>
            </div>
          </div>
        )}

        <div className="px-5 pt-4">
          <input className={inputCls(isDark)} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar palabra…" />
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-2">
          <div className="grid max-h-[46vh] grid-cols-2 content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {filtered.map((w) => {
              const sel = picked.some((p) => p.id === w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => togglePick(w)}
                  className={cx(
                    "btn-press flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition",
                    sel
                      ? "border-[#D97736] bg-[#D97736]/10"
                      : isDark ? "border-brand-line/30 bg-brand-deep/40 hover:border-brand-cyan/50" : "border-gray-200 bg-gray-50 hover:border-brand-teal/50"
                  )}
                >
                  {w.thumbnail
                    ? <img src={w.thumbnail} alt={w.label} className="h-14 w-full rounded-lg object-cover" loading="lazy" />
                    : <div className={cx("flex h-14 w-full items-center justify-center rounded-lg text-lg font-bold", isDark ? "bg-brand-deep text-brand-soft" : "bg-gray-200 text-gray-500")}>{(w.glyph || w.label || "?")[0]}</div>}
                  <span className={cx("line-clamp-2 text-[10px] font-semibold leading-tight", isDark ? "text-brand-soft" : "text-gray-700")}>{w.label}</span>
                </button>
              );
            })}
            {!filtered.length && <p className={cx("col-span-3 py-6 text-center text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>Sin resultados</p>}
          </div>

          {/* Inline video preview */}
          <div className={cx("flex flex-col rounded-2xl border p-3", isDark ? "border-brand-line/30 bg-brand-deep/40" : "border-gray-200 bg-gray-50")}>
            {preview ? (
              <>
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                  {isYouTube(preview.video_ref) ? (
                    <iframe src={videoPreviewUrl(preview.video_ref)} title={preview.label} className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />
                  ) : preview.video_ref ? (
                    <video src={preview.video_ref} className="h-full w-full" controls muted loop playsInline />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/60">Sin video</div>
                  )}
                </div>
                <p className={cx("mt-2 text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>{preview.label}</p>
                {preview.hint && <p className={cx("mt-1 text-xs", isDark ? "text-brand-soft" : "text-gray-600")}>{preview.hint}</p>}
              </>
            ) : (
              <div className={cx("flex flex-1 items-center justify-center text-xs", isDark ? "text-brand-soft" : "text-gray-400")}>
                Selecciona una palabra para ver el video
              </div>
            )}
          </div>
        </div>

        <div className={cx("flex items-center justify-between gap-3 border-t px-5 py-3", isDark ? "border-brand-line/30" : "border-gray-200")}>
          <p className={cx("text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>
            {picked.length ? `${picked.length} seleccionada(s): ${picked.map((p) => p.label).join(", ").slice(0, 80)}` : "Nada seleccionado"}
          </p>
          <button
            onClick={() => picked.length && onSelect(picked)}
            disabled={!picked.length}
            className="btn-press rounded-xl bg-[#D97736] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            Usar selección
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Live preview (student-facing mock) ─────────────────────────

function StepPreview({ step, index, isDark, wordsById }) {
  const word = step._word || wordsById[step.word_id];
  const extras = step._extraWords?.length ? step._extraWords : (step.word_ids || []).map((id) => wordsById[id]).filter(Boolean);
  const allWords = [word, ...extras].filter(Boolean);

  const card = cx("rounded-2xl border p-4", isDark ? "border-brand-line/30 bg-brand-deep/40" : "border-gray-200 bg-white");

  return (
    <div className={card}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold", isDark ? "bg-brand-orange/20 text-brand-orange" : "bg-[#D97736]/15 text-[#B85C2D]")}>{index + 1}</span>
        <Badge tone="teal" isDark={isDark}>{TYPE_META[step.type]?.label || step.type}</Badge>
        {step.reps > 1 && <Badge tone="amber" isDark={isDark}>×{step.reps} reps</Badge>}
      </div>

      {step.explanation && <p className={cx("mb-2 text-xs", isDark ? "text-brand-soft" : "text-gray-600")}>{step.explanation}</p>}

      {(step.type === "mostrar_seña" || step.type === "escucha_y_repite") && word && (
        <div className="flex items-center gap-3">
          {word.thumbnail && <img src={word.thumbnail} alt={word.label} className="h-16 w-24 rounded-lg object-cover" />}
          <div>
            <p className={cx("text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>{word.label}</p>
            {(step.hint || word.hint) && <p className={cx("mt-0.5 text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>💡 {step.hint || word.hint}</p>}
            <p className={cx("mt-1 text-[10px]", isDark ? "text-brand-soft" : "text-gray-400")}>{step.type === "mostrar_seña" ? "El alumno ve el video y practica con la cámara" : "El alumno observa y repite"}</p>
          </div>
        </div>
      )}

      {step.type === "deletrear" && word && (
        <div>
          <p className={cx("text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>Deletrea: {word.label}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {word.label.replace(/\s/g, "").split("").map((ch, i) => (
              <span key={i} className={cx("flex h-8 w-8 items-center justify-center rounded-lg text-xs font-extrabold", isDark ? "bg-brand-card text-brand-soft" : "bg-gray-100 text-gray-600")}>{ch}</span>
            ))}
          </div>
        </div>
      )}

      {(step.type === "elegir_correcta" || step.type === "opcion_multiple") && (
        <div>
          <p className={cx("text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>
            {step.type === "elegir_correcta" ? `¿Cuál es la seña de «${word?.label || "?"}»?` : (step.explanation || "Elige la opción correcta")}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {allWords.map((w, i) => (
              <span key={w.id || i} className={cx("rounded-xl border px-3 py-2 text-center text-xs font-semibold", i === 0 ? "border-emerald-500/40 text-emerald-500" : isDark ? "border-brand-line/30 text-brand-soft" : "border-gray-200 text-gray-600")}>
                {w.label}
              </span>
            ))}
            {allWords.length === 0 && <span className={cx("text-xs", isDark ? "text-brand-soft" : "text-gray-400")}>Agrega palabras para ver opciones</span>}
          </div>
        </div>
      )}

      {step.type === "emparejar" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            {allWords.map((w, i) => <span key={w.id || i} className={cx("block rounded-lg px-2 py-1.5 text-center text-xs font-semibold", isDark ? "bg-brand-card text-white" : "bg-gray-100 text-gray-700")}>{w.label}</span>)}
          </div>
          <div className="space-y-1.5">
            {[...allWords].reverse().map((w, i) => (
              <span key={w.id || i} className={cx("block overflow-hidden rounded-lg", isDark ? "bg-brand-card" : "bg-gray-100")}>
                {w.thumbnail ? <img src={w.thumbnail} alt={w.label} className="h-9 w-full object-cover" /> : <span className="block px-2 py-1.5 text-center text-xs">🖐</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {step.hint && !["mostrar_seña", "escucha_y_repite"].includes(step.type) && (
        <p className={cx("mt-2 text-[10px]", isDark ? "text-brand-soft" : "text-gray-400")}>💡 {step.hint}</p>
      )}
    </div>
  );
}

// ─── Step editor card (draggable) ───────────────────────────────

function StepCard({ step, index, isDark, wordsById, dragProps, onChange, onRemove, onOpenPicker }) {
  const meta = TYPE_META[step.type];
  const word = step._word || wordsById[step.word_id];
  const multi = MULTI_WORD_TYPES.has(step.type);
  const extras = step._extraWords?.length ? step._extraWords : (step.word_ids || []).map((id) => wordsById[id]).filter(Boolean);

  return (
    <div
      draggable
      {...dragProps}
      className={cx("rounded-2xl border p-4 transition", isDark ? "border-brand-line/30 bg-brand-card/60" : "border-gray-200 bg-white shadow-sm")}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={cx("cursor-grab select-none text-lg leading-none active:cursor-grabbing", isDark ? "text-brand-soft" : "text-gray-400")} title="Arrastra para reordenar">⠿</span>
        <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold", isDark ? "bg-brand-deep text-brand-soft" : "bg-gray-100 text-gray-500")}>{index + 1}</span>
        <select
          value={step.type}
          onChange={(e) => onChange({ ...step, type: e.target.value })}
          className={cx("flex-1 rounded-lg border px-2 py-1.5 text-xs font-bold outline-none", isDark ? "border-brand-line/40 bg-brand-deep text-white" : "border-gray-300 bg-white text-brand-ink")}
        >
          {STEP_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
        </select>
        <button onClick={onRemove} className={cx("btn-press rounded-lg px-2 py-1.5 text-xs font-bold", isDark ? "text-red-400 hover:bg-red-400/10" : "text-red-500 hover:bg-red-50")} title="Eliminar paso">✕</button>
      </div>

      <p className={cx("mb-3 text-[10px]", isDark ? "text-brand-soft" : "text-gray-400")}>{meta?.desc}</p>

      {/* word selection */}
      <div className="mb-3">
        <button
          onClick={() => onOpenPicker(index)}
          className={cx("btn-press w-full rounded-xl border border-dashed px-3 py-2.5 text-left text-xs font-semibold transition", isDark ? "border-brand-line/50 text-brand-soft hover:border-brand-cyan/60" : "border-gray-300 text-gray-600 hover:border-brand-teal")}
        >
          {word ? <>✋ {word.label}{extras.length ? ` +${extras.length} más` : ""}</> : "＋ Elegir palabra(s) del banco"}
        </button>
        {word?.thumbnail && (
          <div className="mt-2 flex items-center gap-2">
            <img src={word.thumbnail} alt={word.label} className="h-10 w-16 rounded-lg object-cover" />
            {extras.map((w) => <img key={w.id} src={w.thumbnail} alt={w.label} className="h-10 w-16 rounded-lg object-cover opacity-70" />)}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Repeticiones" isDark={isDark}>
          <input type="number" min={1} max={10} className={inputCls(isDark)} value={step.reps}
            onChange={(e) => onChange({ ...step, reps: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
        </Field>
        <Field label="Threshold (0–1, opcional)" isDark={isDark}>
          <input type="number" min={0} max={1} step={0.05} className={inputCls(isDark)} value={step.threshold ?? ""}
            onChange={(e) => onChange({ ...step, threshold: e.target.value === "" ? null : Math.min(1, Math.max(0, parseFloat(e.target.value))) })} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3">
        <Field label="Explicación del paso" isDark={isDark}>
          <input className={inputCls(isDark)} value={step.explanation || ""} onChange={(e) => onChange({ ...step, explanation: e.target.value })} placeholder="Texto que ve el alumno" />
        </Field>
        <Field label="Hint (opcional)" isDark={isDark}>
          <input className={inputCls(isDark)} value={step.hint || ""} onChange={(e) => onChange({ ...step, hint: e.target.value })} placeholder="Pista de la seña" />
        </Field>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────

export default function AdminLessonsPage({ isDark, navigate }) {
  const { user } = useAuth();
  const [admin, setAdmin] = useState(null); // null=checking, false=denied
  const [view, setView] = useState("list"); // list | edit
  const [lessons, setLessons] = useState([]);
  const [words, setWords] = useState([]);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [pickerStep, setPickerStep] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const wordsById = useMemo(() => Object.fromEntries(words.map((w) => [w.id, w])), [words]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) return;
    isAdminUser(user.id).then((ok) => { if (!cancelled) setAdmin(ok); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const reload = async () => {
    const [lRes, wRes] = await Promise.all([adminListLessons(), listWords()]);
    if (lRes.error) setLoadErr(lRes.error.message);
    setLessons(lRes.data || []);
    setWords(wRes.data || []);
  };

  useEffect(() => { if (admin) reload(); }, [admin]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  // ── editing helpers ──
  const openEditor = async (lesson) => {
    if (!lesson?.id) {
      setDraft(newLessonDraft(lessons.length));
    } else {
      const { data, error } = await adminGetLesson(lesson.id);
      if (error) { showToast("Error cargando lección"); return; }
      setDraft({
        ...data,
        steps: (data.steps || []).map((s) => ({
          ...s,
          _word: s.word_id ? wordsById[s.word_id] : null,
          _extraWords: (s.word_ids || []).map((id) => wordsById[id]).filter(Boolean),
        })),
      });
    }
    setView("edit");
  };

  const updateStep = (i, next) => {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? next : s)) }));
  };

  const moveStep = (from, to) => {
    setDraft((d) => {
      const steps = [...d.steps];
      const [moved] = steps.splice(from, 1);
      steps.splice(to, 0, moved);
      return { ...d, steps };
    });
  };

  const applyPicker = (picked) => {
    const i = pickerStep;
    setPickerStep(null);
    if (i == null || !picked.length) return;
    updateStep(i, {
      ...draft.steps[i],
      word_id: picked[0].id,
      _word: picked[0],
      word_ids: picked.slice(1).map((w) => w.id),
      _extraWords: picked.slice(1),
    });
  };

  const validate = (d) => {
    if (!d.title.trim()) return "El título es obligatorio";
    if (!d.steps.length) return "Agrega al menos un paso";
    for (const [i, s] of d.steps.entries()) {
      if (!STEP_TYPES.includes(s.type)) return `Paso ${i + 1}: tipo inválido`;
      if (MULTI_WORD_TYPES.has(s.type) || s.type === "mostrar_seña" || s.type === "deletrear" || s.type === "escucha_y_repite") {
        if (!s.word_id) return `Paso ${i + 1}: falta elegir una palabra`;
      }
      if ((s.type === "emparejar" || s.type === "opcion_multiple" || s.type === "elegir_correcta") && !s.word_ids?.length) {
        return `Paso ${i + 1}: este tipo necesita palabras adicionales (distractores/pares)`;
      }
    }
    return null;
  };

  const save = async (status) => {
    const d = { ...draft, status: status || draft.status, slug: draft.slug || slugify(draft.title) };
    const err = validate(d);
    if (err) { showToast("⚠ " + err); return; }
    setSaving(true);
    const { data, error } = await adminSaveLesson({
      ...d,
      created_by: d.created_by || user.id,
      steps: d.steps.map((s, i) => ({ ...s, position: i })),
    });
    setSaving(false);
    if (error) { showToast("Error: " + error.message); return; }
    setDraft((prev) => ({ ...prev, id: data.id, slug: data.slug, status: data.status }));
    showToast(status === "published" ? "✅ Lección publicada" : "💾 Borrador guardado");
    reload();
  };

  const togglePublish = async (lesson) => {
    const next = lesson.status === "published" ? "draft" : "published";
    const { error } = await adminSetLessonStatus(lesson.id, next);
    if (error) { showToast("Error: " + error.message); return; }
    showToast(next === "published" ? "✅ Publicada" : "📥 Movida a borrador");
    reload();
  };

  const removeLesson = async (lesson) => {
    if (!window.confirm(`¿Eliminar «${lesson.title}»? Esta acción no se puede deshacer.`)) return;
    const { error } = await adminDeleteLesson(lesson.id);
    if (error) { showToast("Error: " + error.message); return; }
    showToast("🗑 Lección eliminada");
    reload();
  };

  // ── render gates ──
  const wrap = (children) => (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
  );

  if (admin === null) {
    return wrap(<div className="flex justify-center py-24"><div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" /></div>);
  }

  if (admin === false) {
    return wrap(
      <div className="mx-auto max-w-md py-24 text-center">
        <p className="text-5xl">🔒</p>
        <h1 className={cx("font-display mt-4 text-2xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Acceso restringido</h1>
        <p className={cx("mt-2 text-sm", isDark ? "text-brand-soft" : "text-gray-600")}>
          Esta área es solo para administradores. Tu usuario ({user?.email}) no está en la tabla <code>admins</code> de Supabase.
        </p>
        <button onClick={() => navigate("/dashboard")} className="btn-press mt-6 rounded-xl bg-[#D97736] px-5 py-2.5 text-sm font-bold text-white">Volver al dashboard</button>
      </div>
    );
  }

  // ── LIST VIEW ──
  if (view === "list") {
    return wrap(
      <>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">— Lesson Builder</span>
            <h1 className={cx("font-display mt-1 text-3xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>
              Lecciones <span className="text-[#D97736]">del curso</span>
            </h1>
          </div>
          <button onClick={() => openEditor(null)} className="btn-press rounded-xl bg-[#D97736] px-5 py-3 text-sm font-bold text-white hover:bg-[#B85C2D]">
            + Nueva lección
          </button>
        </div>

        {loadErr && <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">Error cargando lecciones: {loadErr}. ¿Ya aplicaste la migración SQL?</p>}

        <div className="space-y-3">
          {lessons.map((l) => (
            <div key={l.id} className={cx("flex flex-wrap items-center gap-4 rounded-2xl border p-4", isDark ? "border-brand-line/30 bg-brand-card/60" : "border-gray-200 bg-white shadow-sm")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx("text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>{l.title}</span>
                  <Badge tone={l.status === "published" ? "green" : "amber"} isDark={isDark}>{l.status === "published" ? "Publicada" : "Borrador"}</Badge>
                  <Badge tone="slate" isDark={isDark}>Nivel {l.level}</Badge>
                  <Badge tone="slate" isDark={isDark}>{l.slug}</Badge>
                </div>
                <p className={cx("mt-1 text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>
                  {l.lesson_steps?.[0]?.count ?? 0} pasos · orden {l.position}{l.module ? ` · ${l.module}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEditor(l)} className={cx("btn-press rounded-xl px-3 py-2 text-xs font-bold", isDark ? "bg-brand-deep text-brand-soft hover:text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>Editar</button>
                <button onClick={() => togglePublish(l)} className={cx("btn-press rounded-xl px-3 py-2 text-xs font-bold", l.status === "published" ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500")}>
                  {l.status === "published" ? "Despublicar" : "Publicar"}
                </button>
                <button onClick={() => removeLesson(l)} className="btn-press rounded-xl px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-400/10">Eliminar</button>
              </div>
            </div>
          ))}
          {!lessons.length && !loadErr && (
            <div className={cx("rounded-2xl border border-dashed p-10 text-center", isDark ? "border-brand-line/40 text-brand-soft" : "border-gray-300 text-gray-500")}>
              <p className="text-sm">Aún no hay lecciones en Supabase.</p>
              <p className="mt-1 text-xs">Corre <code>node scripts/seed_lessons.mjs</code> para migrar el currículo actual, o crea una lección nueva.</p>
            </div>
          )}
        </div>

        {toast && <Toast msg={toast} isDark={isDark} />}
        {pickerStep !== null && (
          <WordPickerModal
            isDark={isDark} words={words} multi={MULTI_WORD_TYPES.has(draft?.steps?.[pickerStep]?.type)}
            onClose={() => setPickerStep(null)} onSelect={applyPicker}
            onWordCreated={(w) => setWords((prev) => [...prev.filter((x) => x.id !== w.id), w].sort((a, b) => a.label.localeCompare(b.label)))}
          />
        )}
      </>
    );
  }

  // ── EDIT VIEW ──
  return wrap(
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => { setView("list"); setDraft(null); }} className={cx("btn-press flex items-center gap-2 text-sm font-medium", isDark ? "text-brand-soft hover:text-white" : "text-gray-600 hover:text-brand-ink")}>
          ← Volver a la lista
        </button>
        <div className="flex items-center gap-2">
          <Badge tone={draft.status === "published" ? "green" : "amber"} isDark={isDark}>{draft.status === "published" ? "Publicada" : "Borrador"}</Badge>
          <button onClick={() => save("draft")} disabled={saving} className={cx("btn-press rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-40", isDark ? "bg-brand-card text-brand-soft" : "bg-gray-200 text-gray-700")}>
            {saving ? "Guardando…" : "Guardar borrador"}
          </button>
          <button onClick={() => save("published")} disabled={saving} className="btn-press rounded-xl bg-[#D97736] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#B85C2D]">
            Publicar
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Builder column ── */}
        <div className="space-y-5">
          <div className={cx("rounded-3xl border p-5", isDark ? "border-brand-line/30 bg-brand-card/60" : "border-gray-200 bg-white shadow-sm")}>
            <h2 className={cx("font-display mb-4 text-lg font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Datos de la lección</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Título *" isDark={isDark}>
                  <input className={inputCls(isDark)} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Saludos básicos" />
                </Field>
              </div>
              <Field label="Slug (id público)" isDark={isDark}>
                <input className={inputCls(isDark)} value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder={slugify(draft.title)} />
              </Field>
              <Field label="Módulo / categoría" isDark={isDark}>
                <input className={inputCls(isDark)} value={draft.module || ""} onChange={(e) => setDraft({ ...draft, module: e.target.value })} placeholder="Expresiones" />
              </Field>
              <Field label="Nivel" isDark={isDark}>
                <input type="number" min={1} max={10} className={inputCls(isDark)} value={draft.level} onChange={(e) => setDraft({ ...draft, level: parseInt(e.target.value, 10) || 1 })} />
              </Field>
              <Field label="Orden" isDark={isDark}>
                <input type="number" min={0} className={inputCls(isDark)} value={draft.position} onChange={(e) => setDraft({ ...draft, position: parseInt(e.target.value, 10) || 0 })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Intro (markdown)" isDark={isDark}>
                  <textarea rows={3} className={inputCls(isDark)} value={draft.intro_md || ""} onChange={(e) => setDraft({ ...draft, intro_md: e.target.value })} placeholder="Texto introductorio de la lección…" />
                </Field>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className={cx("font-display text-lg font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Pasos ({draft.steps.length})</h2>
              <button onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep(d.steps.length)] }))} className="btn-press rounded-xl bg-[#2AABB8]/15 px-3 py-2 text-xs font-bold text-[#2AABB8] hover:bg-[#2AABB8]/25">
                + Agregar paso
              </button>
            </div>
            <div className="space-y-3">
              {draft.steps.map((s, i) => (
                <StepCard
                  key={s.id || i}
                  step={s}
                  index={i}
                  isDark={isDark}
                  wordsById={wordsById}
                  dragProps={{
                    onDragStart: () => setDragIdx(i),
                    onDragOver: (e) => e.preventDefault(),
                    onDrop: () => { if (dragIdx !== null && dragIdx !== i) moveStep(dragIdx, i); setDragIdx(null); },
                  }}
                  onChange={(next) => updateStep(i, next)}
                  onRemove={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}
                  onOpenPicker={setPickerStep}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Live preview column ── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className={cx("rounded-3xl border p-5", isDark ? "border-brand-line/30 bg-brand-card/40" : "border-brand-mist/40 bg-brand-cream")}>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">— Vista del alumno</span>
            <h2 className={cx("font-display mt-1 text-xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>
              {draft.title || "Lección sin título"}
            </h2>
            <p className={cx("text-xs", isDark ? "text-brand-soft" : "text-gray-500")}>
              {draft.steps.filter((s) => s.word_id).length} señas · Nivel {draft.level}
            </p>
            {draft.intro_md && <p className={cx("mt-3 whitespace-pre-wrap rounded-xl p-3 text-xs", isDark ? "bg-brand-deep/50 text-brand-soft" : "bg-white text-gray-600")}>{draft.intro_md}</p>}
            <div className="mt-4 space-y-3">
              {draft.steps.map((s, i) => <StepPreview key={s.id || i} step={s} index={i} isDark={isDark} wordsById={wordsById} />)}
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast msg={toast} isDark={isDark} />}
      {pickerStep !== null && (
        <WordPickerModal
          isDark={isDark}
          words={words}
          multi={MULTI_WORD_TYPES.has(draft.steps[pickerStep]?.type)}
          initialSelection={[draft.steps[pickerStep]?._word, ...(draft.steps[pickerStep]?._extraWords || [])].filter(Boolean)}
          onClose={() => setPickerStep(null)}
          onSelect={applyPicker}
          onWordCreated={(w) => setWords((prev) => [...prev.filter((x) => x.id !== w.id), w].sort((a, b) => a.label.localeCompare(b.label)))}
        />
      )}
    </>
  );
}

function Toast({ msg, isDark }) {
  return (
    <div className={cx("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold shadow-2xl", isDark ? "bg-brand-card text-white border border-brand-line/40" : "bg-brand-ink text-white")}>
      {msg}
    </div>
  );
}
