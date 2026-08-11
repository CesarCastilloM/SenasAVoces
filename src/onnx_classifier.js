/**
 * onnx_classifier.js — Inferencia en el navegador del modelo LSTM+Attention
 * exportado a ONNX. Funciona en paralelo al detector DTW.
 *
 * Flujo:
 *   1. init() carga el modelo ONNX y el mapa de labels.
 *   2. classify(frameSequence) recibe un array de frames {landmarksRight, landmarksLeft}
 *      (igual formato que usa el detector DTW), los normaliza, remuestrea a 24 frames,
 *      y devuelve {top1, top5, confidence, ranking}.
 */
import * as ort from "onnxruntime-web";

const TARGET_FRAMES = 24;
let session = null;
let labels = null; // ["ABRIL", "AHORA", ...] indexado por idx del modelo
let initialized = false;

function handPresent(hand) {
  if (!hand || hand.length < 21) return false;
  for (const lm of hand) {
    if (lm.x !== 0 || lm.y !== 0 || (lm.z ?? 0) !== 0) return true;
  }
  return false;
}

function normalizeSequence(frames) {
  // frames: [{landmarksRight, landmarksLeft}, ...]
  // Devuelve Float32Array de (T, 126) normalizada (centro/escala por manos presentes)
  const T = frames.length;
  const out = new Float32Array(T * 126);

  for (let f = 0; f < T; f++) {
    const fr = frames[f];
    const right = fr.landmarksRight;
    const left = fr.landmarksLeft;
    const hasR = handPresent(right);
    const hasL = handPresent(left);

    let cx = 0, cy = 0, cz = 0, nWrists = 0;
    if (hasR) { cx += right[0].x; cy += right[0].y; cz += right[0].z ?? 0; nWrists++; }
    if (hasL) { cx += left[0].x; cy += left[0].y; cz += left[0].z ?? 0; nWrists++; }
    if (nWrists > 0) { cx /= nWrists; cy /= nWrists; cz /= nWrists; }

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

    const base = f * 126;
    for (let l = 0; l < 21; l++) {
      // Right hand landmarks 0..20 -> indices 0..62
      if (hasR) {
        out[base + l * 3]     = (right[l].x - cx) / scale;
        out[base + l * 3 + 1] = (right[l].y - cy) / scale;
        out[base + l * 3 + 2] = ((right[l].z ?? 0) - cz) / scale;
      }
      // Left hand landmarks 0..20 -> indices 63..125
      if (hasL) {
        const li = 21 + l;
        out[base + li * 3]     = (left[l].x - cx) / scale;
        out[base + li * 3 + 1] = (left[l].y - cy) / scale;
        out[base + li * 3 + 2] = ((left[l].z ?? 0) - cz) / scale;
      }
    }
  }
  return out;
}

function resampleToLength(arr, T, targetLen) {
  // arr: Float32Array of (T, 126). Resample time axis to targetLen.
  if (T === targetLen) return arr;
  const out = new Float32Array(targetLen * 126);
  if (T === 1) {
    for (let t = 0; t < targetLen; t++) {
      out.set(arr, t * 126);
    }
    return out;
  }
  for (let t = 0; t < targetLen; t++) {
    const srcIdx = (t / (targetLen - 1)) * (T - 1);
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, T - 1);
    const frac = srcIdx - i0;
    for (let c = 0; c < 126; c++) {
      out[t * 126 + c] = arr[i0 * 126 + c] * (1 - frac) + arr[i1 * 126 + c] * frac;
    }
  }
  return out;
}

export async function initClassifier() {
  if (initialized) return true;
  try {
    ort.env.wasm.wasmPaths = "/";
    session = await ort.InferenceSession.create("/sign_model.onnx");
    const res = await fetch("/sign_labels.json");
    const labelMap = await res.json();
    labels = Object.values(labelMap);
    initialized = true;
    console.log(`[ONNX] Modelo cargado: ${labels.length} clases`);
    return true;
  } catch (e) {
    console.warn("[ONNX] Error cargando modelo:", e);
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
  const input = new ort.Tensor("float32", resampled, [1, TARGET_FRAMES, 126]);

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
