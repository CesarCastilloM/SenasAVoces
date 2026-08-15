// model_test_page.jsx
// Banco de pruebas del modelo DTW entrenado desde video.
//
// A diferencia de /practice (que usa los templates geometricos estaticos de
// lsm_detector.js), esta pagina evalua EXCLUSIVAMENTE los patrones DTW de
// public/training_data/. Sirve para medir si el modelo realmente separa las
// senas entre si, viendo el ranking completo en vivo.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dynamicDetector, frameInfo, splitHands } from "../utils/dynamic_sign_detector.js";

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

// Cuantos frames sin mano antes de resetear el buffer.
const IDLE_FRAMES_TO_RESET = 8;
// Mínimo de frames en buffer antes de poder evaluar.
const MIN_FRAMES_TO_EVAL = 15;
// Máximo de frames en buffer antes de forzar evaluación.
const MAX_FRAMES_TO_EVAL = 260;
// Score máximo para aceptar una detección (menor = más estricto).
const DETECT_SCORE_THRESHOLD = 0.5;
// Margen mínimo entre #1 y #2 para aceptar detección.
const DETECT_MARGIN_THRESHOLD = 0.12;
// Cuántos frames consecutivos debe mantenerse una detección estable antes de aceptarla.
const STABLE_FRAMES_TO_ACCEPT = 3;
// Cada cuántos frames evaluar el ranking.
const EVAL_EVERY_N_FRAMES = 3;

export default function ModelTestPage({ isDark, navigate, useCameraMediaPipe, reloadDynamicPatterns }) {
  const [manifest, setManifest] = useState(null);
  const [signMeta, setSignMeta] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState("Cargando patrones entrenados…");

  const [activeCats, setActiveCats] = useState(() => new Set(["numeros", "palabras", "familia", "colores"]));
  const [targetIndex, setTargetIndex] = useState(0);

  const [ranking, setRanking] = useState([]);
  const [handDetected, setHandDetected] = useState(false);
  const [bufferSize, setBufferSize] = useState(0);
  const [lastResult, setLastResult] = useState(null); // { correct, guess, score, margin, target }
  const [stats, setStats] = useState({ correct: 0, total: 0, top3: 0 });
  const [history, setHistory] = useState([]);
  const lastSpokenRef = useRef(null);

  const idleRef = useRef(0);
  const activeFramesRef = useRef(0);
  const targetRef = useRef(null);
  const evaluatingRef = useRef(false);
  const frameCounterRef = useRef(0);
  // Reconocimiento continuo
  const stableGuessRef = useRef(null);  // { name, score } que se mantiene estable
  const stableCountRef = useRef(0);     // frames consecutivos con el mismo #1
  const lastDetectedRef = useRef(null); // última seña detectada (para evitar duplicados)

  // ── Inicializar voces de speechSynthesis ──────────────────
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // ── Carga de patrones ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [manRes, metaRes] = await Promise.all([
          fetch(`/api/training-data/manifest?t=${Date.now()}`),
          fetch(`/api/training-data/sign_metadata.json?t=${Date.now()}`),
        ]);
        if (!manRes.ok) throw new Error(`manifest HTTP ${manRes.status}`);
        const man = await manRes.json();
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (!cancelled) setSignMeta(meta);
        }
        if (cancelled) return;
        setManifest(man);
        setLoadingMsg("Cargando secuencias DTW…");
        const loaded = await reloadDynamicPatterns();
        if (cancelled) return;
        setLoadingMsg(null);
        if (!loaded || loaded.length === 0) {
          setLoadError("No se cargó ningún patrón. Revisa public/training_data/.");
        }
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadDynamicPatterns]);

  // Señas disponibles segun las categorias activas, en orden de secciones
  // (orden del manifest: categoría por categoría, seña por seña).
  const pool = useMemo(() => {
    if (!manifest) return [];
    const out = [];
    for (const [cat, signs] of Object.entries(manifest)) {
      if (!activeCats.has(cat) || !Array.isArray(signs)) continue;
      for (const s of signs) out.push({ name: s, category: cat });
    }
    return out;
  }, [manifest, activeCats]);

  const target = pool.length > 0 ? pool[Math.min(targetIndex, pool.length - 1)] : null;
  const targetMeta = target ? signMeta[target.name] : null;
  targetRef.current = target;

  const resetAttemptState = useCallback(() => {
    setRanking([]);
    setLastResult(null);
    dynamicDetector.clearBuffer();
    idleRef.current = 0;
    activeFramesRef.current = 0;
    evaluatingRef.current = false;
    stableGuessRef.current = null;
    stableCountRef.current = 0;
    lastDetectedRef.current = null;
    lastSpokenRef.current = null;
  }, []);

  const nextTarget = useCallback(() => {
    resetAttemptState();
    setTargetIndex(i => (pool.length === 0 ? 0 : (i + 1) % pool.length));
  }, [pool.length, resetAttemptState]);

  const prevTarget = useCallback(() => {
    resetAttemptState();
    setTargetIndex(i => (pool.length === 0 ? 0 : (i - 1 + pool.length) % pool.length));
  }, [pool.length, resetAttemptState]);

  const goToIndex = useCallback((idx) => {
    resetAttemptState();
    setTargetIndex(idx);
  }, [resetAttemptState]);

  // ── Evaluacion de un intento ─────────────────────────────────────────
  const evaluateAttempt = useCallback((guess, margin) => {
    const tgt = targetRef.current;
    if (!tgt || evaluatingRef.current) return;
    evaluatingRef.current = true;
    stableGuessRef.current = null;
    stableCountRef.current = 0;
    lastDetectedRef.current = guess.name;

    dynamicDetector.clearBuffer();
    activeFramesRef.current = 0;

    const position = 0; // ya sabemos que guess es #1
    const correct = guess.name === tgt.name;
    const inTop3 = correct;

    const result = {
      target: tgt.name,
      guess: guess.name,
      score: guess.score,
      margin,
      correct,
      inTop3,
      position: 1,
      targetScore: guess.score,
    };

    setLastResult(result);
    setStats(s => ({
      correct: s.correct + (correct ? 1 : 0),
      total: s.total + 1,
      top3: s.top3 + (inTop3 ? 1 : 0),
    }));
    setHistory(h => [result, ...h].slice(0, 12));
  }, []);

  // ── Loop de MediaPipe ────────────────────────────────────────────────
  const handleResults = useCallback(({ handRes, faceRes }) => {
    const { right, left } = splitHands(handRes);
    const lms = right || left;
    const faceLms = faceRes?.landmarks?.[0] || null;
    setHandDetected(!!lms);

    if (!lms) {
      idleRef.current += 1;
      // Reset buffer cuando no hay mano
      if (idleRef.current >= IDLE_FRAMES_TO_RESET) {
        dynamicDetector.clearBuffer();
        evaluatingRef.current = false;
        stableGuessRef.current = null;
        stableCountRef.current = 0;
        activeFramesRef.current = 0;
      }
      return;
    }

    // Mano de vuelta: reset si hubo pausa larga
    if (idleRef.current >= IDLE_FRAMES_TO_RESET) {
      evaluatingRef.current = false;
      setLastResult(null);
      dynamicDetector.clearBuffer();
      stableGuessRef.current = null;
      stableCountRef.current = 0;
    }
    idleRef.current = 0;
    activeFramesRef.current += 1;

    const info = frameInfo(right, left);

    // ── Reconocimiento continuo ──
    // Siempre acumular frames en el buffer
    dynamicDetector.pushFrameInfo(info);
    const bufLen = dynamicDetector.buffer.length;
    setBufferSize(bufLen);

    // Evaluar cada N frames si tenemos suficientes
    frameCounterRef.current++;
    if (bufLen >= MIN_FRAMES_TO_EVAL && frameCounterRef.current % EVAL_EVERY_N_FRAMES === 0) {
      const full = dynamicDetector.detectRanking();
      if (full.length > 0) {
        const guess = full[0];
        const margin = full.length > 1 ? full[1].score - guess.score : Infinity;
        const top5 = full.slice(0, 5);
        setRanking(top5);

        // Hablar la palabra objetivo si aparece en el top 5 del ranking DTW
        const tgt = targetRef.current;
        const foundInTop5 = tgt && top5.some(r => r.name === tgt.name);
        if (foundInTop5 && tgt.name !== lastSpokenRef.current && 'speechSynthesis' in window) {
          lastSpokenRef.current = tgt.name;
          const text = tgt.name.replace(/_/g, ' ');
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'es-MX';
          utterance.rate = 0.9;
          const voices = window.speechSynthesis.getVoices();
          const googleEs = voices.find(v => v.name.toLowerCase().includes('google') && v.lang.startsWith('es'));
          const esVoice = googleEs || voices.find(v => v.lang.startsWith('es'));
          if (esVoice) utterance.voice = esVoice;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }

        // Si el score es muy alto, el buffer no coincide con nada.
        // Resetear para eliminar frames idle y empezar fresco.
        if (guess.score > 2.5) {
          dynamicDetector.clearBuffer();
          stableGuessRef.current = null;
          stableCountRef.current = 0;
          setRanking([]);
          return;
        }

        // Detectar: score bajo + margen bueno + estable por N frames
        if (guess.score < DETECT_SCORE_THRESHOLD && margin > DETECT_MARGIN_THRESHOLD) {
          if (stableGuessRef.current?.name === guess.name) {
            stableCountRef.current++;
          } else {
            stableGuessRef.current = { name: guess.name, score: guess.score };
            stableCountRef.current = 1;
          }

          // Aceptar detección si es estable y no es duplicado de la última
          if (stableCountRef.current >= STABLE_FRAMES_TO_ACCEPT && lastDetectedRef.current !== guess.name) {
            evaluateAttempt(guess, margin);
          }
        } else {
          stableGuessRef.current = null;
          stableCountRef.current = 0;
        }

        // Si el buffer está lleno y no hay detección clara, resetear
        if (bufLen >= MAX_FRAMES_TO_EVAL && !evaluatingRef.current) {
          if (guess.score < DETECT_SCORE_THRESHOLD && lastDetectedRef.current !== guess.name) {
            evaluateAttempt(guess, margin);
          } else {
            dynamicDetector.clearBuffer();
            stableGuessRef.current = null;
            stableCountRef.current = 0;
          }
        }
      }
    }
  }, [evaluateAttempt]);

  const { videoRef, canvasRef, camReady, camError } = useCameraMediaPipe({ onResults: handleResults });

  const toggleCat = (cat) => {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      // Nunca dejar el pool vacio.
      return next.size === 0 ? prev : next;
    });
    resetAttemptState();
    setTargetIndex(0);
  };

  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  const top3Acc = stats.total > 0 ? Math.round((stats.top3 / stats.total) * 100) : 0;

  const panel = isDark ? "bg-brand-card border-brand-line" : "bg-white border-brand-mist";
  const textMain = isDark ? "text-white" : "text-brand-ink";
  const textSoft = isDark ? "text-brand-soft" : "text-brand-muted";

  return (
    <div className={cx("min-h-screen", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      {/* ── Barra superior ── */}
      <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3", panel)}>
        <div className="flex items-center gap-3">
          <h1 className={cx("text-sm font-bold", textMain)}>Banco de pruebas · Modelo DTW</h1>
          <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-mist text-brand-teal")}>
            {pool.length} señas
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={cx("text-[10px] font-semibold uppercase tracking-wide", textSoft)}>Top-1</div>
            <div className={cx("text-lg font-bold leading-none", accuracy >= 70 ? "text-green-400" : accuracy >= 40 ? "text-brand-orange" : "text-red-400")}>
              {accuracy}%
            </div>
          </div>
          <div className="text-right">
            <div className={cx("text-[10px] font-semibold uppercase tracking-wide", textSoft)}>Top-3</div>
            <div className={cx("text-lg font-bold leading-none", textMain)}>{top3Acc}%</div>
          </div>
          <div className="text-right">
            <div className={cx("text-[10px] font-semibold uppercase tracking-wide", textSoft)}>Intentos</div>
            <div className={cx("text-lg font-bold leading-none", textMain)}>{stats.total}</div>
          </div>
        </div>
      </div>

      {/* ── Filtros de categoria ── */}
      <div className={cx("flex flex-wrap items-center gap-2 border-b px-6 py-2", panel)}>
        <span className={cx("text-[11px] font-semibold", textSoft)}>Categorías:</span>
        {manifest && Object.entries(manifest).map(([cat, signs]) => {
          if (!Array.isArray(signs) || signs.length === 0) return null;
          const on = activeCats.has(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className={cx(
                "rounded-full px-3 py-1 text-[11px] font-bold transition-colors",
                on
                  ? "bg-brand-cyan text-white"
                  : isDark ? "bg-brand-card text-brand-muted" : "bg-brand-cream text-brand-soft"
              )}
            >
              {CATEGORY_LABELS[cat] || cat} ({signs.length})
            </button>
          );
        })}
      </div>

      {loadError && (
        <div className="mx-6 mt-4 rounded-lg bg-[#3A1B1B] px-4 py-3 text-sm font-semibold text-[#F5C9C9]">
          Error cargando el modelo: {loadError}
        </div>
      )}

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px]">
        {/* ── Camara + video de referencia ── */}
        <div className="relative overflow-hidden rounded-xl bg-black" style={{ minHeight: 420 }}>
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

          {loadingMsg && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-cyan border-t-transparent" />
              <p className="text-sm font-semibold text-white">{loadingMsg}</p>
            </div>
          )}

          {!camReady && !camError && !loadingMsg && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-cyan border-t-transparent" />
              <p className="text-sm font-semibold text-white">Iniciando cámara…</p>
            </div>
          )}

          {camError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-sm font-semibold text-red-400">{camError}</p>
              <p className="text-xs text-brand-soft">Permite el acceso a la cámara y recarga.</p>
            </div>
          )}

          {/* Seña objetivo */}
          {target && (
            <div className="absolute left-4 top-4 z-10 rounded-xl bg-black/70 px-4 py-2 backdrop-blur-sm">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-soft">
                Haz esta seña
              </div>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold leading-tight text-white">{target.name}</div>
                {targetMeta && (
                  <span className={cx(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold",
                    targetMeta.oneHanded
                      ? "bg-brand-cyan/30 text-brand-cyan"
                      : "bg-[#F0A500]/30 text-[#F0A500]"
                  )}>
                    {targetMeta.oneHanded ? "🖐 1 mano" : "🙌 2 manos"}
                  </span>
                )}
              </div>
              <div className="text-[10px] font-semibold text-brand-cyan">
                {CATEGORY_LABELS[target.category] || target.category}
              </div>
            </div>
          )}

          {/* Estado del buffer */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2">
            <span className={cx(
              "rounded-full px-3 py-1 text-[11px] font-bold backdrop-blur-sm",
              handDetected
                ? "bg-green-700/90 text-green-200"
                : "bg-black/60 text-brand-soft"
            )}>
              {handDetected ? `Buffer · ${bufferSize} frames` : "Sin mano"}
            </span>
            {!handDetected && (
              <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-brand-soft">
                Sube la mano y haz la seña
              </span>
            )}
          </div>

          {/* Video de referencia en la esquina */}
          {target && (
            <div className="absolute bottom-4 right-4 z-10 w-44 overflow-hidden rounded-xl border-2 border-white/25 bg-black shadow-2xl">
              <div className="bg-black/80 px-2 py-1 text-[10px] font-bold text-brand-cyan">
                Referencia · {target.name}
              </div>
              <video
                key={target.name}
                src={`/videos/signs/${encodeURIComponent(target.name)}.mp4`}
                className="block h-auto w-full"
                autoPlay
                loop
                muted
                playsInline
                onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }}
              />
            </div>
          )}

          {/* Veredicto del intento */}
          {lastResult && (
            <div className={cx(
              "absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl px-6 py-4 text-center backdrop-blur-md",
              lastResult.correct ? "bg-green-700/90" : "bg-red-900/90"
            )}>
              <div className="text-3xl font-bold text-white">
                {lastResult.correct ? "✓ Correcto" : "✗ Confundido"}
              </div>
              {!lastResult.correct && (
                <div className="mt-1 text-sm font-semibold text-white/90">
                  Detectó <b>{lastResult.guess}</b> en vez de <b>{lastResult.target}</b>
                </div>
              )}
              <div className="mt-1 text-xs font-semibold text-white/70">
                dist {lastResult.score.toFixed(3)}
                {lastResult.position && ` · objetivo en #${lastResult.position}`}
              </div>
            </div>
          )}
        </div>

        {/* ── Panel lateral ── */}
        <div className="flex flex-col gap-4">
          {target && (
            <div className={cx("flex items-center justify-between rounded-xl border px-3 py-2", panel)}>
              <span className={cx("text-[11px] font-bold uppercase tracking-wide", textSoft)}>
                {CATEGORY_LABELS[target.category] || target.category}
              </span>
              <span className={cx("text-[11px] font-mono font-semibold", textSoft)}>
                {targetIndex + 1} / {pool.length}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={prevTarget}
              className={cx("rounded-xl px-4 py-2.5 text-sm font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-brand-cream text-brand-muted")}
            >
              ← Anterior
            </button>
            <button
              onClick={nextTarget}
              className="flex-1 rounded-xl bg-brand-cyan px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#238E99]"
            >
              Siguiente seña →
            </button>
            <button
              onClick={() => { dynamicDetector.clearBuffer(); setRanking([]); setLastResult(null); activeFramesRef.current = 0; evaluatingRef.current = false; }}
              className={cx("rounded-xl px-4 py-2.5 text-sm font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-brand-cream text-brand-muted")}
            >
              Reiniciar
            </button>
          </div>

          {/* Ranking en vivo */}
          <div className={cx("rounded-xl border p-3", panel)}>
            <div className={cx("mb-2 text-[11px] font-bold uppercase tracking-wide", textSoft)}>
              Ranking DTW en vivo (menor = mejor)
            </div>
            {ranking.length === 0 ? (
              <p className={cx("py-3 text-center text-xs", textSoft)}>
                Mueve la mano frente a la cámara…
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {ranking.map((r, i) => {
                  const isTarget = target && r.name === target.name;
                  return (
                    <div
                      key={r.name}
                      className={cx(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5",
                        isTarget
                          ? "bg-brand-cyan/20 ring-1 ring-brand-cyan"
                          : isDark ? "bg-[#16272E]" : "bg-brand-cream"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cx("w-4 text-[10px] font-bold", textSoft)}>{i + 1}</span>
                        <span className={cx("text-xs font-bold", isTarget ? "text-brand-cyan" : textMain)}>
                          {r.name}
                        </span>
                      </div>
                      <span className={cx("font-mono text-[11px] font-semibold", textSoft)}>
                        {r.score.toFixed(3)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historial */}
          <div className={cx("rounded-xl border p-3", panel)}>
            <div className={cx("mb-2 text-[11px] font-bold uppercase tracking-wide", textSoft)}>
              Últimos intentos
            </div>
            {history.length === 0 ? (
              <p className={cx("py-3 text-center text-xs", textSoft)}>Sin intentos todavía.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className={cx("font-semibold", h.correct ? "text-green-400" : "text-red-400")}>
                      {h.correct ? "✓" : "✗"} {h.target}
                    </span>
                    {!h.correct && (
                      <span className={cx("font-mono", textSoft)}>
                        → {h.guess} {h.position ? `(#${h.position})` : "(fuera)"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
