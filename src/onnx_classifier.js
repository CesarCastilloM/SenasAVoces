/**
 * onnx_classifier.js — Inferencia en el navegador del modelo LSTM+Attention
 * exportado a ONNX. Funciona en paralelo al detector DTW.
 *
 * Flujo:
 *   1. init() carga el modelo ONNX y el mapa de labels.
 *   2. classify(frameSequence) recibe un array de frames {landmarksRight, landmarksLeft, landmarksFace}
 *      los normaliza, remuestrea a 24 frames, y devuelve {top1, top5, confidence, ranking}.
 *
 * Formato: 42 hand landmarks + 82 face landmarks = 124 total → 372 dims (124*3).
 */
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.bundle.min.mjs";

const TARGET_FRAMES = 24;
const HAND_LM = 42;   // 21 right + 21 left
const FACE_LM = 82;
const TOTAL_LM = HAND_LM + FACE_LM;  // 124
const INPUT_DIM = TOTAL_LM * 3;       // 372

const FACE_LM_INDICES = [
    0, 1, 2, 3, 4,
    5, 6, 7, 8, 9,
    33, 130, 133, 144, 145, 153, 154, 155, 157, 158,
    263, 362, 363, 373, 374, 380, 381, 382, 384, 385,
    61, 78, 80, 81, 82, 84, 87, 88, 91, 95,
    96, 97, 146, 178, 181, 185, 191,
    291, 308, 310, 311, 312, 314, 317, 318, 321, 324,
    325, 326, 327, 376, 402, 405, 409, 415,
    19, 20, 168,
    10, 13, 14, 17, 18, 21, 23, 28, 32, 116, 117, 152, 172, 234,
];

let session = null;
let labels = null;
let initialized = false;

function handPresent(hand) {
  if (!hand || hand.length < 21) return false;
  for (const lm of hand) {
    if (lm.x !== 0 || lm.y !== 0 || (lm.z ?? 0) !== 0) return true;
  }
  return false;
}

function facePresent(face) {
  if (!face || face.length < 468) return false;
  for (let i = 0; i < FACE_LM_INDICES.length; i++) {
    const lm = face[FACE_LM_INDICES[i]];
    if (lm && (lm.x !== 0 || lm.y !== 0)) return true;
  }
  return false;
}

function normalizeSequence(frames) {
  // frames: [{landmarksRight, landmarksLeft, landmarksFace}, ...]
  // Devuelve Float32Array de (T, 372) normalizada
  const T = frames.length;
  const out = new Float32Array(T * INPUT_DIM);

  for (let f = 0; f < T; f++) {
    const fr = frames[f];
    const right = fr.landmarksRight;
    const left = fr.landmarksLeft;
    const face = fr.landmarksFace;
    const hasR = handPresent(right);
    const hasL = handPresent(left);
    const hasF = facePresent(face);

    let cx = 0, cy = 0, cz = 0, nWrists = 0;
    if (hasR) { cx += right[0].x; cy += right[0].y; cz += right[0].z ?? 0; nWrists++; }
    if (hasL) { cx += left[0].x; cy += left[0].y; cz += left[0].z ?? 0; nWrists++; }
    if (nWrists > 0) { cx /= nWrists; cy /= nWrists; cz /= nWrists; }
    else if (hasF && face[168]) { cx = face[168].x; cy = face[168].y; cz = face[168].z ?? 0; }

    let scale = 1.0, nScales = 0;
    if (hasR) {
      const dx = right[9].x - right[0].x;
      const dy = right[9].y - right[0].y;
      const dz = (right[9].z ?? 0) - (right[0].z ?? 0);
      scale += Math.sqrt(dx*dx + dy*dy + dz*dz);
      nScales++;
    }
    if (hasL) {
      const dx = left[9].x - left[0].x;
      const dy = left[9].y - left[0].y;
      const dz = (left[9].z ?? 0) - (left[0].z ?? 0);
      scale += Math.sqrt(dx*dx + dy*dy + dz*dz);
      nScales++;
    }
    if (nScales > 0) scale /= nScales;
    if (scale < 1e-6) scale = 1.0;

    const base = f * INPUT_DIM;
    // Hand landmarks: 42 * 3 = 126 values
    for (let l = 0; l < 21; l++) {
      if (hasR) {
        out[base + l * 3]     = (right[l].x - cx) / scale;
        out[base + l * 3 + 1] = (right[l].y - cy) / scale;
        out[base + l * 3 + 2] = ((right[l].z ?? 0) - cz) / scale;
      }
      if (hasL) {
        const li = 21 + l;
        out[base + li * 3]     = (left[l].x - cx) / scale;
        out[base + li * 3 + 1] = (left[l].y - cy) / scale;
        out[base + li * 3 + 2] = ((left[l].z ?? 0) - cz) / scale;
      }
    }
    // Face landmarks: 82 * 3 = 246 values (indices 42..123)
    if (hasF) {
      for (let i = 0; i < FACE_LM_INDICES.length; i++) {
        const lm = face[FACE_LM_INDICES[i]];
        if (!lm) continue;
        const fi = HAND_LM + i;
        out[base + fi * 3]     = (lm.x - cx) / scale;
        out[base + fi * 3 + 1] = (lm.y - cy) / scale;
        out[base + fi * 3 + 2] = ((lm.z ?? 0) - cz) / scale;
      }
    }
  }
  return out;
}

function resampleToLength(arr, T, targetLen) {
  // arr: Float32Array of (T, INPUT_DIM). Resample time axis to targetLen.
  const D = INPUT_DIM;
  if (T === targetLen) return arr;
  const out = new Float32Array(targetLen * D);
  if (T === 1) {
    for (let t = 0; t < targetLen; t++) {
      out.set(arr, t * D);
    }
    return out;
  }
  for (let t = 0; t < targetLen; t++) {
    const srcIdx = (t / (targetLen - 1)) * (T - 1);
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, T - 1);
    const frac = srcIdx - i0;
    for (let c = 0; c < D; c++) {
      out[t * D + c] = arr[i0 * D + c] * (1 - frac) + arr[i1 * D + c] * frac;
    }
  }
  return out;
}

export async function initClassifier() {
  if (initialized) return true;
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    console.log("[ONNX] Iniciando carga del modelo...");
    session = await ort.InferenceSession.create("/sign_model.onnx", {
      executionProviders: ["wasm"],
    });
    const res = await fetch("/sign_labels.json");
    const labelMap = await res.json();
    labels = Object.values(labelMap);
    initialized = true;
    console.log(`[ONNX] Modelo cargado: ${labels.length} clases`);
    return true;
  } catch (e) {
    console.error("[ONNX] Error cargando modelo:", e);
    return false;
  }
}

export function isClassifierReady() {
  return initialized;
}

export function classifySequence(frames) {
  if (!initialized || !frames || frames.length < 2) return null;
  const normalized = normalizeSequence(frames);
  const resampled = resampleToLength(normalized, frames.length, TARGET_FRAMES);
  const input = new ort.Tensor("float32", resampled, [1, TARGET_FRAMES, INPUT_DIM]);

  return session.run({ input }).then((results) => {
    const logits = results.logits.data; // Float32Array
    // Softmax
    let maxLogit = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > maxLogit) maxLogit = logits[i];
    }
    const exps = new Float32Array(logits.length);
    let sumExp = 0;
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i] - maxLogit);
      sumExp += exps[i];
    }
    const probs = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      probs[i] = exps[i] / sumExp;
    }

    // Top-5
    const indices = Array.from({ length: logits.length }, (_, i) => i);
    indices.sort((a, b) => probs[b] - probs[a]);
    const top5 = indices.slice(0, 5).map(i => ({
      name: labels[i],
      prob: probs[i],
    }));

    return {
      top1: top5[0].name,
      confidence: top5[0].prob,
      top5,
    };
  }).catch((e) => {
    console.warn("[ONNX] Error en inferencia:", e);
    return null;
  });
}
