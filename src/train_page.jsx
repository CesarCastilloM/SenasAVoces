// train_page.jsx
// Página de grabación de ejemplos DTW para entrenar el modelo con grabaciones reales.
// Permite seleccionar una seña existente o crear una nueva, grabar con la cámara,
// y guardar los frames via /api/train-sign.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dynamicDetector, frameInfo, splitHands } from "./dynamic_sign_detector.js";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

const CATEGORY_LABELS = {
  numeros: "Números",
  palabras: "Palabras",
  familia: "Familia",
  colores: "Colores",
  salud: "Salud",
  tecnologia: "Tecnología",
  expresiones: "Expresiones",
};

const IDLE_FRAMES_TO_STOP = 15;
const MIN_FRAMES_FOR_SAVE = 6;
const MAX_FRAMES = 30;

export default function TrainPage({ isDark, navigate, useCameraMediaPipe, reloadDynamicPatterns }) {
  const [manifest, setManifest] = useState(null);
  const [category, setCategory] = useState("palabras");
  const [signName, setSignName] = useState("");
  const [selectedSign, setSelectedSign] = useState(null);
  const [recording, setRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [handDetected, setHandDetected] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exampleCount, setExampleCount] = useState({});

  const framesRef = useRef([]);
  const idleRef = useRef(0);
  const recordingRef = useRef(false);
  const autoStopRef = useRef(true);

  // Cargar manifest
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/training-data/manifest?t=${Date.now()}`);
        const man = await res.json();
        if (cancelled) return;
        setManifest(man);
        // Contar ejemplos por seña en paralelo
        const countTasks = [];
        for (const [cat, signs] of Object.entries(man)) {
          for (const sign of signs) {
            for (let i = 1; i <= 20; i++) {
              countTasks.push(
                fetch(`/api/training-data/${cat}/${sign}_${i}.json`)
                  .then(r => r.ok ? `${cat}/${sign}` : null)
                  .catch(() => null)
              );
            }
          }
        }
        const countResults = await Promise.all(countTasks);
        const counts = {};
        for (const key of countResults) {
          if (key) counts[key] = (counts[key] || 0) + 1;
        }
        if (cancelled) return;
        setExampleCount(counts);
      } catch (e) {
        if (!cancelled) setSavedMsg({ type: "error", text: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Señas de la categoría seleccionada
  const signsInCat = useMemo(() => {
    if (!manifest || !manifest[category]) return [];
    return manifest[category];
  }, [manifest, category]);

  // ── Grabación ──
  const startRecording = useCallback(() => {
    framesRef.current = [];
    idleRef.current = 0;
    recordingRef.current = true;
    setRecording(true);
    setFrameCount(0);
    setSavedMsg(null);
  }, []);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const saveRecording = useCallback(async () => {
    const frames = framesRef.current;
    if (frames.length < MIN_FRAMES_FOR_SAVE) {
      setSavedMsg({ type: "error", text: `Muy pocos frames (${frames.length}). Necesitas al menos ${MIN_FRAMES_FOR_SAVE}.` });
      return;
    }
    const sign = (selectedSign || signName || "").trim().toUpperCase();
    if (!sign) {
      setSavedMsg({ type: "error", text: "Selecciona o escribe el nombre de la seña." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/train-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signName: sign,
          category,
          examples: [frames],
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedMsg({ type: "success", text: `Guardado: ${data.files.join(", ")}` });
        // Actualizar contador
        setExampleCount(prev => ({
          ...prev,
          [`${category}/${sign}`]: (prev[`${category}/${sign}`] || 0) + data.saved,
        }));
        // Recargar patrones
        if (reloadDynamicPatterns) await reloadDynamicPatterns();
      } else {
        setSavedMsg({ type: "error", text: data.error || "Error al guardar" });
      }
    } catch (e) {
      setSavedMsg({ type: "error", text: e.message });
    }
    setSaving(false);
    framesRef.current = [];
    setFrameCount(0);
  }, [selectedSign, signName, category, reloadDynamicPatterns]);

  // ── Loop de MediaPipe ──
  const handleResults = useCallback(({ handRes }) => {
    const { right, left } = splitHands(handRes);
    const lms = right || left;
    setHandDetected(!!lms);

    if (!lms) {
      if (recordingRef.current) {
        idleRef.current += 1;
        if (autoStopRef.current && idleRef.current >= IDLE_FRAMES_TO_STOP && framesRef.current.length >= MIN_FRAMES_FOR_SAVE) {
          stopRecording();
          // Auto-guardar
          setTimeout(() => saveRecording(), 200);
        }
      }
      return;
    }

    idleRef.current = 0;

    if (recordingRef.current && framesRef.current.length < MAX_FRAMES) {
      const info = frameInfo(right, left);
      if (info) {
        const toPrecision = (lm) => ({ x: +lm.x.toFixed(4), y: +lm.y.toFixed(4), z: +lm.z.toFixed(4) });
        framesRef.current.push({
          videoTime: framesRef.current.length * 0.033,
          landmarksRight: right ? right.map(toPrecision) : null,
          landmarksLeft: left ? left.map(toPrecision) : null,
        });
        setFrameCount(framesRef.current.length);
      }
    } else if (recordingRef.current && framesRef.current.length >= MAX_FRAMES) {
      stopRecording();
    }
  }, [stopRecording, saveRecording]);

  const { videoRef, canvasRef, camReady, camError } = useCameraMediaPipe({ onResults: handleResults });

  const panel = isDark ? "bg-brand-card border-brand-line" : "bg-white border-brand-mist";
  const textMain = isDark ? "text-white" : "text-brand-ink";
  const textSoft = isDark ? "text-brand-soft" : "text-brand-muted";
  const inputClass = isDark
    ? "bg-brand-deep border-brand-line text-white placeholder-brand-muted"
    : "bg-brand-cream border-brand-mist text-brand-ink placeholder-brand-soft";

  return (
    <div className={cx("min-h-screen", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3", panel)}>
        <div className="flex items-center gap-3">
          <h1 className={cx("text-sm font-bold", textMain)}>Entrenamiento · Grabar ejemplos DTW</h1>
        </div>
        <button
          onClick={() => navigate("/model-test")}
          className="rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-bold text-white"
        >
          Probar modelo →
        </button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
        {/* ── Cámara ── */}
        <div className="relative overflow-hidden rounded-xl bg-black" style={{ minHeight: 420 }}>
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

          {!camReady && !camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-cyan border-t-transparent" />
              <p className="text-sm font-semibold text-white">Iniciando cámara…</p>
            </div>
          )}

          {camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm font-semibold text-red-400">{camError}</p>
            </div>
          )}

          {/* Estado de grabación */}
          <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
            {recording && (
              <div className="flex items-center gap-2 rounded-xl bg-red-900/90 px-4 py-2 backdrop-blur-sm">
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-400" />
                <span className="text-sm font-bold text-white">REC · {frameCount} frames</span>
              </div>
            )}
            <div className={cx(
              "rounded-xl px-3 py-1.5 text-xs font-semibold backdrop-blur-sm",
              handDetected ? "bg-green-700/90 text-green-200" : "bg-black/60 text-brand-soft"
            )}>
              {handDetected ? "Mano detectada" : "Sin mano"}
            </div>
          </div>

          {/* Contador de frames */}
          {recording && (
            <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
              <div className="h-2 w-48 overflow-hidden rounded-full bg-black/50">
                <div
                  className="h-full bg-brand-cyan transition-all"
                  style={{ width: `${(frameCount / MAX_FRAMES) * 100}%` }}
                />
              </div>
              <div className="mt-1 text-center text-[10px] font-bold text-white/80">
                {frameCount} / {MAX_FRAMES}
              </div>
            </div>
          )}

          {/* Instrucciones cuando no graba */}
          {!recording && camReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
              <p className="text-center text-sm font-semibold text-white/90">
                Selecciona una seña y pulsa "Grabar"
              </p>
              <p className="text-center text-xs text-white/60">
                Haz la seña frente a la cámara. Al bajar la mano, se guarda automáticamente.
              </p>
            </div>
          )}
        </div>

        {/* ── Panel de control ── */}
        <div className="flex flex-col gap-4">
          {/* Selector de categoría */}
          <div className={cx("rounded-xl border p-3", panel)}>
            <label className={cx("mb-1 block text-[11px] font-bold uppercase tracking-wide", textSoft)}>
              Categoría
            </label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setSelectedSign(null); setSignName(""); }}
              className={cx("w-full rounded-lg border px-3 py-2 text-sm font-semibold", inputClass)}
            >
              {manifest && Object.keys(manifest).map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat} ({manifest[cat]?.length || 0})</option>
              ))}
            </select>
          </div>

          {/* Selector de seña */}
          <div className={cx("rounded-xl border p-3", panel)}>
            <label className={cx("mb-1 block text-[11px] font-bold uppercase tracking-wide", textSoft)}>
              Seña existente
            </label>
            <select
              value={selectedSign || ""}
              onChange={(e) => { setSelectedSign(e.target.value || null); setSignName(e.target.value || ""); }}
              className={cx("w-full rounded-lg border px-3 py-2 text-sm font-semibold", inputClass)}
            >
              <option value="">— Nueva seña —</option>
              {signsInCat.map(s => {
                const count = exampleCount[`${category}/${s}`] || 0;
                return (
                  <option key={s} value={s}>{s} ({count} ej.)</option>
                );
              })}
            </select>

            {!selectedSign && (
              <>
                <label className={cx("mt-2 mb-1 block text-[11px] font-bold uppercase tracking-wide", textSoft)}>
                  Nombre de la nueva seña
                </label>
                <input
                  type="text"
                  value={signName}
                  onChange={(e) => setSignName(e.target.value.toUpperCase())}
                  placeholder="EJ: HOLA"
                  className={cx("w-full rounded-lg border px-3 py-2 text-sm font-semibold", inputClass)}
                />
              </>
            )}

            {selectedSign && (
              <div className="mt-2 text-xs font-semibold text-brand-cyan">
                {exampleCount[`${category}/${selectedSign}`] || 0} ejemplos actuales
              </div>
            )}
          </div>

          {/* Botones de grabación */}
          <div className="flex gap-2">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={!camReady || (!selectedSign && !signName.trim())}
                className="flex-1 rounded-xl bg-red-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#6A2222] disabled:opacity-40"
              >
                ● Grabar
              </button>
            ) : (
              <button
                onClick={() => { stopRecording(); }}
                className="flex-1 rounded-xl bg-brand-card px-4 py-2.5 text-sm font-bold text-white"
              >
                ■ Detener
              </button>
            )}
            <button
              onClick={() => { framesRef.current = []; setFrameCount(0); setSavedMsg(null); }}
              className={cx("rounded-xl px-4 py-2.5 text-sm font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-brand-cream text-brand-muted")}
            >
              Limpiar
            </button>
          </div>

          {/* Auto-stop toggle */}
          <label className={cx("flex items-center gap-2 text-xs font-semibold", textSoft)}>
            <input
              type="checkbox"
              checked={autoStopRef.current}
              onChange={(e) => { autoStopRef.current = e.target.checked; }}
              className="h-4 w-4 accent-[#2AABB8]"
            />
            Auto-guardar al bajar la mano
          </label>

          {/* Guardar manual */}
          {!recording && frameCount >= MIN_FRAMES_FOR_SAVE && (
            <button
              onClick={saveRecording}
              disabled={saving}
              className="rounded-xl bg-brand-cyan px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#238E99] disabled:opacity-40"
            >
              {saving ? "Guardando…" : `Guardar ${frameCount} frames`}
            </button>
          )}

          {/* Mensaje de estado */}
          {savedMsg && (
            <div className={cx(
              "rounded-xl px-4 py-3 text-sm font-semibold",
              savedMsg.type === "success" ? "bg-green-700/20 text-green-400" : "bg-[#3A1B1B] text-red-400"
            )}>
              {savedMsg.text}
            </div>
          )}

          {/* Información */}
          <div className={cx("rounded-xl border p-3 text-xs", panel)}>
            <div className={cx("mb-1 font-bold uppercase tracking-wide", textSoft)}>Cómo usar</div>
            <ol className={cx("list-decimal pl-4 leading-relaxed", textSoft)}>
              <li>Selecciona categoría y seña (o escribe una nueva)</li>
              <li>Pulsa <b>Grabar</b> y haz la seña frente a la cámara</li>
              <li>Baja la mano para terminar (auto-guarda)</li>
              <li>Repite para sumar más ejemplos por seña</li>
              <li>Ve a <b>Probar modelo</b> para evaluar</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
