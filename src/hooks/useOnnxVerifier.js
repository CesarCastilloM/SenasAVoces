/**
 * useOnnxVerifier.js — Verifica con el modelo ONNX que el alumno hace la seña
 * objetivo de una lección.
 *
 *   cámara (useSimpleCamera)
 *     └─ push({ handRes, faceRes, timestamp })
 *          └─ sign_sequence_buffer  fotogramas crudos: ventana de ~1.2 s y segmentos de movimiento
 *               └─ onnx_classifier.classifySequence  probabilidades de las 238 clases
 *                    └─ probabilityOf(resultado, clase objetivo)
 *                         └─ lesson_engine  80 % sostenido 250 ms, "casi" al 50 %, memoria de 2 s
 *                              └─ { phase, score } para la interfaz  +  onCorrect una sola vez
 *
 * Si la seña no tiene clase en el modelo, `mode` es "none" y LessonView sigue con
 * su plantilla de dedos (o sin verificación automática si tampoco la tiene).
 *
 * Compuerta de calidad: el modelo solo verifica si su precisión de validación
 * registrada (public/model_meta.json, campo val_top1) es >= MIN_VAL_TOP1. Con un
 * modelo que casi nunca supera el 30 % de confianza ni en sus propias muestras,
 * pedir 80 % haría imposible aprobar y además quitaría la plantilla que hoy sí
 * funciona (letras A-K). En ese caso `mode` es "untrusted" y todo sigue como antes.
 * Para evaluar el modelo igualmente: localStorage.setItem("lsm_onnx_force", "1").
 *
 * `createVerifier` no usa React: se prueba aparte. `useOnnxVerifier` es la envoltura.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLessonJudge } from "../utils/lesson_engine.js";
import { createSequenceBuffer } from "../utils/sign_sequence_buffer.js";
import { createClassMap } from "../utils/sign_class_map.js";
import {
  classifySequence,
  getClassLabels,
  initClassifier,
  isClassifierReady,
  probabilityOf,
} from "../utils/onnx_classifier.js";

/** Cada cuántos frames con mano se clasifica la ventana (3 => ~10 veces por segundo). */
const PREDICT_EVERY = 3;
/** Una predicción de ventana más vieja que esto ya no cuenta. */
const WINDOW_FRESH_MS = 600;
/** Resolución del puntaje publicado a la interfaz (pasos del 5 %). */
const SCORE_STEPS = 20;
/** Precisión top-1 de validación mínima para fiarse del modelo en las lecciones. */
export const MIN_VAL_TOP1 = 0.5;

let trustPromise = null;
/** @returns {Promise<{trusted:boolean, valTop1?:number, forced?:boolean, unknown?:boolean}>} */
export function loadModelTrust() {
  trustPromise ??= (async () => {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("lsm_onnx_force") === "1") {
        return { trusted: true, forced: true };
      }
    } catch { /* sin localStorage */ }
    try {
      const res = await fetch("/model_meta.json");
      if (!res.ok) return { trusted: true, unknown: true }; // sin metadatos: no se bloquea
      const valTop1 = Number((await res.json()).val_top1);
      return { trusted: !(valTop1 < MIN_VAL_TOP1), valTop1 };
    } catch {
      return { trusted: true, unknown: true };
    }
  })();
  return trustPromise;
}

export const IDLE_STATE = { phase: "waiting", score: 0, peak: 0, moving: false };

/**
 * @param {object} opts
 * @param {string} opts.className  clase del modelo que se verifica
 * @param {(frames:Array)=>Promise<object|null>|object|null} opts.classify  normalmente classifySequence
 * @param {(state:{phase:string,score:number,peak:number,moving:boolean})=>void} [opts.onState]
 * @param {(info:{score:number})=>void} [opts.onCorrect]  se llama UNA vez al acertar
 * @param {{judge?:object, buffer?:object, predictEvery?:number}} [opts.config]
 */
export function createVerifier({ className, classify, onState, onCorrect, config = {} }) {
  const buffer = createSequenceBuffer(config.buffer);
  const judge = createLessonJudge(config.judge);
  const predictEvery = config.predictEvery ?? PREDICT_EVERY;

  let generation = 0; // sube en reset(): las respuestas viejas se descartan
  let inflight = false; // ort no admite dos run() a la vez sobre la misma sesión
  let queuedSegment = null;
  let frameCount = 0;
  let lastTs = 0;
  let windowScore = 0;
  let windowAt = -Infinity;
  let pendingSegmentScore = null;
  let published = { phase: null, bucket: -1, moving: null };

  async function run(frames, kind) {
    const gen = generation;
    inflight = true;
    try {
      const result = await classify(frames);
      if (gen !== generation || !result) return;
      const p = probabilityOf(result, className);
      if (kind === "segment") pendingSegmentScore = Math.max(pendingSegmentScore ?? 0, p);
      else {
        windowScore = p;
        windowAt = lastTs;
      }
    } catch (err) {
      console.warn("[verifier] error de inferencia:", err);
    } finally {
      inflight = false;
      // Un segmento que llegó mientras se clasificaba tiene prioridad sobre seguir con ventanas
      if (queuedSegment && gen === generation) {
        const frames2 = queuedSegment;
        queuedSegment = null;
        run(frames2, "segment");
      }
    }
  }

  function publish(v, moving) {
    const bucket = Math.floor(v.score * SCORE_STEPS);
    if (published.phase === v.phase && published.bucket === bucket && published.moving === moving) return;
    published = { phase: v.phase, bucket, moving };
    onState?.({ phase: v.phase, score: v.score, peak: v.peak, moving });
  }

  return {
    /** Llamar en cada frame de la cámara, con o sin mano. */
    push({ handRes, faceRes, timestamp }) {
      lastTs = timestamp;
      const hasHand = (handRes?.landmarks?.length ?? 0) > 0;
      const out = hasHand ? buffer.push({ handRes, faceRes, timestamp }) : buffer.noHand(timestamp);

      if (out.segment) {
        if (inflight) queuedSegment = out.segment;
        else run(out.segment, "segment");
      } else if (hasHand && out.window && ++frameCount % predictEvery === 0 && !inflight) {
        run(out.window, "window");
      }

      // La ventana solo cuenta con mano presente y reciente; sin mano el puntaje es 0
      // (la memoria de 2 s del juez conserva el pico de un movimiento recién terminado).
      const score = hasHand && timestamp - windowAt <= WINDOW_FRESH_MS ? windowScore : 0;
      const segmentScore = pendingSegmentScore;
      pendingSegmentScore = null;

      const verdict = judge.update({ score, segmentScore, timestamp });
      publish(verdict, out.moving);
      if (verdict.event === "correct") onCorrect?.({ score: Math.max(verdict.score, verdict.peak) });
    },

    /** Vuelve al estado inicial (nueva seña, "seguir practicando"…). */
    reset() {
      generation++;
      queuedSegment = null;
      pendingSegmentScore = null;
      windowScore = 0;
      windowAt = -Infinity;
      frameCount = 0;
      buffer.clear();
      judge.reset();
      published = { phase: null, bucket: -1, moving: null };
      onState?.({ ...IDLE_STATE });
    },

    dispose() {
      generation++;
      queuedSegment = null;
    },
  };
}

/**
 * Hook para LessonView.
 *
 * @param {object} opts
 * @param {string} opts.target  nombre de la seña de la lección (tal como se muestra)
 * @param {boolean} [opts.enabled=true]
 * @param {(info:{score:number})=>void} [opts.onCorrect]
 * @returns {{
 *   mode: 'loading'|'unavailable'|'untrusted'|'onnx'|'none',
 *   className: string|null, kind: string|null,
 *   phase: 'waiting'|'almost'|'correct', score: number, peak: number, moving: boolean,
 *   push: (frame:{handRes:object, faceRes?:object, timestamp:number})=>void,
 *   reset: ()=>void,
 * }}
 */
export function useOnnxVerifier({ target, enabled = true, onCorrect }) {
  const [ready, setReady] = useState(isClassifierReady());
  const [failed, setFailed] = useState(false);
  const [trust, setTrust] = useState(null);
  const [state, setState] = useState({ ...IDLE_STATE, key: "" });
  const verifierRef = useRef(null);
  const onCorrectRef = useRef(onCorrect);

  useEffect(() => {
    onCorrectRef.current = onCorrect;
  });

  // Carga el modelo una sola vez (el módulo recuerda si ya está listo)
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    initClassifier().then((ok) => {
      if (cancelled) return;
      setReady(ok);
      setFailed(!ok);
    });
    loadModelTrust().then((t) => {
      if (!cancelled) setTrust(t);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const classMap = useMemo(() => (ready ? createClassMap(getClassLabels()) : null), [ready]);
  const resolved = useMemo(() => (classMap && target ? classMap.resolve(target) : null), [classMap, target]);
  const className = resolved?.className ?? null;

  const trusted = Boolean(trust?.trusted);

  // Un verificador por seña objetivo (solo si el modelo es de fiar)
  useEffect(() => {
    if (!enabled || !className || !trusted) {
      verifierRef.current = null;
      return undefined;
    }
    const verifier = createVerifier({
      className,
      classify: classifySequence,
      onState: (s) => setState({ ...s, key: className }),
      onCorrect: (info) => onCorrectRef.current?.(info),
    });
    verifierRef.current = verifier;
    return () => {
      verifier.dispose();
      verifierRef.current = null;
    };
  }, [enabled, className, trusted]);

  const push = useCallback((frame) => verifierRef.current?.push(frame), []);
  const reset = useCallback(() => verifierRef.current?.reset(), []);

  const mode = !enabled
    ? "none"
    : failed
      ? "unavailable"
      : !ready || !trust
        ? "loading"
        : !className
          ? "none"
          : trusted
            ? "onnx"
            : "untrusted";
  // El estado de otra seña (o anterior a un cambio) nunca se muestra en la actual
  const live = state.key === className ? state : IDLE_STATE;

  return {
    mode,
    className,
    kind: resolved?.kind ?? null,
    phase: live.phase,
    score: live.score,
    peak: live.peak,
    moving: live.moving,
    push,
    reset,
  };
}
