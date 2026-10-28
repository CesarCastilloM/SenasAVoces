// dynamic_sign_detector.js
// Detector de señas dinámicas usando DTW sobre secuencias de vectores de características.
// El "modelo entrenado" es una colección de secuencias JSON en public/training_data/.

import { fingerStates as computeFingerStates } from "./lsm_detector.js";

export const WRIST_WEIGHT = 4.0;
const ACCEL_WEIGHT = 2.5;
const WRIST_POS_WEIGHT = 3.0; // peso posición absoluta de muñeca
const TOP_K = 3;
const PRE_FILTER_N = 40; // solo DTW en los top-40 candidatos del pre-filtro

const HAND_DIM = 15;
const ZERO_HAND = new Array(HAND_DIM).fill(0);

// ── Utilidades ──
// Voltea horizontalmente una lista de landmarks: x -> 1 - x.
function flipHand(landmarks) {
  if (!landmarks) return null;
  return landmarks.map(lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z }));
}

// ── Proporción de imagen ──
// MediaPipe normaliza x e y a [0,1] por separado, así que la misma mano sale
// "estirada" en x en un video 9:16 respecto a uno 16:9 o a la webcam 4:3.
// Multiplicar x (y z, que viene en la escala de x) por ancho/alto, centrado en
// 0.5, deja todo en unidades del alto de la imagen; el espejo x -> 1 - x sigue
// siendo simétrico alrededor de 0.5.
export function correctHandAspect(landmarks, aspect) {
  if (!landmarks || !aspect || aspect === 1) return landmarks;
  return landmarks.map(lm => ({ x: 0.5 + (lm.x - 0.5) * aspect, y: lm.y, z: (lm.z || 0) * aspect }));
}

export function correctFrameAspect(frame, aspect) {
  return {
    ...frame,
    landmarksRight: correctHandAspect(frame.landmarksRight ?? null, aspect),
    landmarksLeft: correctHandAspect(frame.landmarksLeft ?? null, aspect),
  };
}

// ── Ejemplos por seña ──
// Entradas de public/training_data/examples.json (python_scripts/examples_index.py)
// que se cargan como patrones: las grabaciones reales primero. Cada patrón es
// un DTW más en cada evaluación en vivo, así que se recorta a `max`.
export const MAX_PATTERN_EXAMPLES = 24;

export function selectPatternExamples(entries, max = MAX_PATTERN_EXAMPLES) {
  return [...entries]
    .sort((a, b) => (a.kind === "real" ? 0 : 1) - (b.kind === "real" ? 0 : 1) || a.n - b.n)
    .slice(0, max);
}

// ── Remuestreo temporal ──
// Cada patrón comprime la seña completa (1–4 s de video) en 24 cuadros. Una
// ventana en vivo se remuestrea igual antes de compararla, para que el DTW y
// las velocidades vean la misma escala de tiempo.
export const PATTERN_FRAMES = 24;

function lerpHand(a, b, f) {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * f,
    y: p.y + (b[i].y - p.y) * f,
    z: (p.z || 0) + ((b[i].z || 0) - (p.z || 0)) * f,
  }));
}

export function resampleLandmarkFrames(frames, targetLen = PATTERN_FRAMES) {
  const n = frames.length;
  if (n === 0) return [];
  const out = [];
  for (let t = 0; t < targetLen; t++) {
    const s = n === 1 || targetLen === 1 ? 0 : (t * (n - 1)) / (targetLen - 1);
    const i0 = Math.floor(s);
    const i1 = Math.min(i0 + 1, n - 1);
    const f = s - i0;
    const hand = (key) => {
      const a = frames[i0][key];
      const b = frames[i1][key];
      if (a && b) return lerpHand(a, b, f);
      // Una mano que solo existe en un extremo no se interpola hacia ceros.
      return (f < 0.5 ? a || b : b || a) || null;
    };
    out.push({ landmarksRight: hand("landmarksRight"), landmarksLeft: hand("landmarksLeft") });
  }
  return out;
}

// ── Huecos de detección ──
// MediaPipe a veces pierde una mano unos cuadros a mitad de una seña de dos
// manos; frameInfo trataría esos cuadros como de una mano (otras
// características y un salto enorme de velocidad). Un hueco de hasta
// `maxGap` cuadros con la mano presente antes y después se interpola.
export const PATTERN_MAX_GAP = 3; // cuadros, en patrones de PATTERN_FRAMES

export function fillHandGaps(frames, maxGap) {
  const out = frames.map(f => ({ ...f }));
  for (const key of ["landmarksRight", "landmarksLeft"]) {
    let last = -1;
    for (let i = 0; i < out.length; i++) {
      if (!out[i][key]) continue;
      const gap = i - last - 1;
      if (last >= 0 && gap > 0 && gap <= maxGap) {
        for (let j = last + 1; j < i; j++) out[j][key] = lerpHand(out[last][key], out[i][key], (j - last) / (i - last));
      }
      last = i;
    }
  }
  return out;
}

// ── Mano en reposo ──
// MediaPipe detecta cualquier mano visible, incluida la que solo descansa en el
// encuadre, y las aumentaciones `_2.._N` se guardaron sin ella. Mismo criterio
// que python_scripts/analyze_hands.py (con el que se limpiaron), aplicado a las
// dos manos para no depender de la etiqueta Left/Right de MediaPipe. Pensado
// para secuencias de PATTERN_FRAMES cuadros: el movimiento es por cuadro.
const REST_MOTION_RATIO = 0.25; // fracción del movimiento de la otra mano
const REST_MIN_MOTION = 0.06;   // escalas de mano por cuadro
const REST_MIN_COVERAGE = 0.4;  // fracción de cuadros con esa mano

function wristMotion(frames, key) {
  let total = 0, steps = 0, present = 0;
  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i][key];
    if (!cur) continue;
    present++;
    const prev = i > 0 ? frames[i - 1][key] : null;
    if (!prev) continue;
    const scale = Math.hypot(cur[9].x - cur[0].x, cur[9].y - cur[0].y) || 1e-9;
    total += Math.hypot(cur[0].x - prev[0].x, cur[0].y - prev[0].y) / scale;
    steps++;
  }
  return { motion: steps ? total / steps : 0, coverage: frames.length ? present / frames.length : 0 };
}

// Quita la mano que no participa. Si ninguna se mueve lo suficiente (seña
// estática), se queda la que más se mueve, como hizo la limpieza original.
export function dropRestingHand(frames) {
  const r = wristMotion(frames, "landmarksRight");
  const l = wristMotion(frames, "landmarksLeft");
  if (r.coverage === 0 || l.coverage === 0) return frames;
  const participates = (h, other) => h.coverage >= REST_MIN_COVERAGE
    && h.motion >= REST_MIN_MOTION
    && h.motion >= REST_MOTION_RATIO * Math.max(other.motion, 1e-9);
  const keepR = participates(r, l), keepL = participates(l, r);
  if (keepR && keepL) return frames;
  const drop = keepR ? "landmarksLeft" : keepL ? "landmarksRight"
    : (l.motion <= r.motion ? "landmarksLeft" : "landmarksRight");
  return frames.map(f => ({ ...f, [drop]: null }));
}

// Un ejemplo de entrenamiento listo para cargarse como patrón del recognizer
// en vivo: misma geometría que la cámara corregida (aspect = ancho/alto de su
// video), huecos cortos rellenos y, si cleanRestingHand, sin la mano en reposo.
export function preparePatternFrames(frames, { aspect = null, cleanRestingHand = false } = {}) {
  let out = aspect ? frames.map(f => correctFrameAspect(f, aspect)) : frames;
  out = fillHandGaps(out, PATTERN_MAX_GAP);
  return cleanRestingHand ? dropRestingHand(out) : out;
}

// ── Vector de características enriquecido (forma de mano + orientación 3D) ──
// Describe UNA sola mano. La mayoría de las señas de LSM usan dos manos, así
// que frameInfo/buildSequence combinan dos llamadas a esta función (Right + Left).
export function featureFromFingerStates(fs) {
  if (!fs) return null;
  const ang = fs.ang || {};
  const norm = (v) => {
    if (typeof v !== "number") return 0;
    return v / 180.0;
  };
  return [
    norm(ang.index),
    norm(ang.middle),
    norm(ang.ring),
    norm(ang.pinky),
    norm(ang.thumb),
    fs.thumb  ? 1 : 0,
    fs.index  ? 1 : 0,
    fs.middle ? 1 : 0,
    fs.ring   ? 1 : 0,
    fs.pinky  ? 1 : 0,
    ((fs.palmOriY || 0) + 1) / 2,
    ((fs.fingerOriY || 0) + 1) / 2,
    // Features adicionales para mejor diferenciación
    ((fs.fingerOriZ || 0) + 1) / 2,   // orientación de dedos en Z (hacia adelante/atrás)
    (fs.palmNormalZ || 0),             // normal de la palma en Z
    (fs.imGap || 0),                   // separación índice-medio
  ];
}

// Separa el resultado crudo de HandLandmarker ({landmarks, handedness}) en
// mano derecha/izquierda según la categoría reportada por MediaPipe.
export function splitHands(handRes) {
  const lmsList = handRes?.landmarks || [];
  const handedness = handRes?.handedness || [];
  let right = null, left = null;
  for (let i = 0; i < lmsList.length; i++) {
    const cat = handedness[i]?.[0]?.categoryName;
    if (cat === "Left") left = lmsList[i];
    else if (cat === "Right") right = lmsList[i];
    else if (!right) right = lmsList[i];
    else if (!left) left = lmsList[i];
  }
  return { right, left };
}

// Extrae información por frame para hasta dos manos: vectores de características,
// muñecas y escala. `landmarksLeft` es opcional (señas de una sola mano).
export function frameInfo(landmarksRight, landmarksLeft) {
  const fsR = (landmarksRight && landmarksRight.length >= 21) ? computeFingerStates(landmarksRight) : null;
  const fsL = (landmarksLeft && landmarksLeft.length >= 21) ? computeFingerStates(landmarksLeft) : null;
  const ffR = featureFromFingerStates(fsR);
  const ffL = featureFromFingerStates(fsL);
  if (!ffR && !ffL) return null;

  // Si solo hay una mano, duplicar sus features al otro slot para que
  // el vector sea invariante a si la mano está en Right o Left.
  // Para una mano, palmNormalZ se hace simétrica con abs() para que el
  // espejo (x invertido) no cambie el signo de la normal.
  if (ffR && !ffL) {
    const wrist = landmarksRight[0];
    const m = landmarksRight[9];
    const scale = Math.hypot(m.x - wrist.x, m.y - wrist.y) || 1e-9;
    const ffSym = [...ffR];
    ffSym[13] = Math.abs(ffSym[13]); // palmNormalZ mirror-symmetric
    return {
      ffR: ffSym, presentR: 1, wristR: wrist,
      ffL: ffSym, presentL: 1, wristL: wrist,
      scale, oneHanded: true,
    };
  }
  if (ffL && !ffR) {
    const wrist = landmarksLeft[0];
    const m = landmarksLeft[9];
    const scale = Math.hypot(m.x - wrist.x, m.y - wrist.y) || 1e-9;
    const ffSym = [...ffL];
    ffSym[13] = Math.abs(ffSym[13]); // palmNormalZ mirror-symmetric
    return {
      ffR: ffSym, presentR: 1, wristR: wrist,
      ffL: ffSym, presentL: 1, wristL: wrist,
      scale, oneHanded: true,
    };
  }

  const refLms = (ffR ? landmarksRight : landmarksLeft);
  const wrist = refLms[0];
  const m = refLms[9];
  const scale = Math.hypot(m.x - wrist.x, m.y - wrist.y) || 1e-9;
  return {
    ffR: ffR || ZERO_HAND,
    presentR: ffR ? 1 : 0,
    wristR: ffR ? landmarksRight[0] : null,
    ffL: ffL || ZERO_HAND,
    presentL: ffL ? 1 : 0,
    wristL: ffL ? landmarksLeft[0] : null,
    scale,
  };
}

function handVelocity(curWrist, prevWrist, scale) {
  if (!curWrist || !prevWrist) return [0, 0];
  return [(curWrist.x - prevWrist.x) / scale, (curWrist.y - prevWrist.y) / scale];
}

// Construye una secuencia de vectores DTW a partir de infos {ffR, ffL, wristR, wristL, scale}.
// A cada frame le añade velocidad/aceleración de cada muñeca y la posición
// relativa entre ambas manos (clave para señas de dos manos).
export function buildSequence(infos) {
  const seq = [];
  let prevWristR = null, prevWristL = null;
  let prevVxR = 0, prevVyR = 0, prevVxL = 0, prevVyL = 0;
  for (let i = 0; i < infos.length; i++) {
    const cur = infos[i];
    if (!cur) continue;
    let [vxR, vyR] = handVelocity(cur.wristR, prevWristR, cur.scale);
    let [vxL, vyL] = handVelocity(cur.wristL, prevWristL, cur.scale);
    // Para señas de una mano, usar abs(vx) para que el espejo (x invertido)
    // no cambie el signo de la velocidad horizontal.
    if (cur.oneHanded) {
      vxR = Math.abs(vxR);
      vxL = Math.abs(vxL);
    }
    const axR = vxR - prevVxR, ayR = vyR - prevVyR;
    const axL = vxL - prevVxL, ayL = vyL - prevVyL;
    prevVxR = vxR; prevVyR = vyR; prevVxL = vxL; prevVyL = vyL;
    if (cur.wristR) prevWristR = cur.wristR;
    if (cur.wristL) prevWristL = cur.wristL;

    let relDx = 0, relDy = 0, relPresent = 0;
    if (cur.wristR && cur.wristL) {
      relDx = (cur.wristL.x - cur.wristR.x) / cur.scale;
      relDy = (cur.wristL.y - cur.wristR.y) / cur.scale;
      relPresent = 1;
    }

    // Posición absoluta de muñeca (normalizada) — clave para distinguir
    // signos hechos en distintas partes del cuerpo (frente vs pecho vs cara).
    // Para one-handed, abs(x-0.5) para mirror invariance.
    const wrx = cur.wristR ? (cur.oneHanded ? Math.abs(cur.wristR.x - 0.5) : cur.wristR.x) : 0;
    const wry = cur.wristR ? cur.wristR.y : 0;
    const wlx = cur.wristL ? (cur.oneHanded ? Math.abs(cur.wristL.x - 0.5) : cur.wristL.x) : 0;
    const wly = cur.wristL ? cur.wristL.y : 0;

    seq.push([
      ...cur.ffR, cur.presentR,
      ...cur.ffL, cur.presentL,
      relDx, relDy, relPresent,
      vxR * WRIST_WEIGHT, vyR * WRIST_WEIGHT, axR * ACCEL_WEIGHT, ayR * ACCEL_WEIGHT,
      vxL * WRIST_WEIGHT, vyL * WRIST_WEIGHT, axL * ACCEL_WEIGHT, ayL * ACCEL_WEIGHT,
      wrx * WRIST_POS_WEIGHT, wry * WRIST_POS_WEIGHT,
      wlx * WRIST_POS_WEIGHT, wly * WRIST_POS_WEIGHT,
    ]);
  }
  return seq;
}

// Secuencia DTW directamente desde frames {landmarksRight, landmarksLeft}.
export function sequenceFromFrames(frames) {
  return buildSequence(frames.map(f => frameInfo(f.landmarksRight, f.landmarksLeft)).filter(Boolean));
}

// ── Utilidades ──
function landmarkDistance(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// DTW entre dos secuencias de vectores de características
function dtw(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return Infinity;
  let prev = new Array(m + 1).fill(Infinity);
  let curr = new Array(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const cost = landmarkDistance(seqA[i - 1], seqB[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(Infinity);
  }
  return prev[m] / (n + m);
}

// Subsequence DTW: encuentra la mejor subsecuencia del buffer que coincide
// con el patrón completo. Permite que el gesto comience en cualquier punto
// del buffer (frames idle al inicio no contaminan el score).
function dtwSubseq(buffer, pattern) {
  const n = buffer.length;
  const m = pattern.length;
  if (n === 0 || m === 0) return Infinity;
  // Inicializar primera fila a 0: el patrón puede empezar en cualquier frame
  let prev = new Array(m + 1).fill(0);
  let curr = new Array(m + 1).fill(Infinity);
  let bestEnd = Infinity;
  for (let i = 1; i <= n; i++) {
    curr[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const cost = landmarkDistance(buffer[i - 1], pattern[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    // Trackear el menor costo en la última columna (patrón completamente alineado)
    if (curr[m] < bestEnd) bestEnd = curr[m];
    [prev, curr] = [curr, prev];
    curr.fill(Infinity);
  }
  return bestEnd / m;
}

// ── Clase principal ──
export class DynamicSignDetector {
  constructor() {
    this.patterns = [];
    this.buffer = [];
    this.previousInfo = null;
    this.maxBufferSize = 260;
    this.minBufferSize = 4;
    this.threshold = 3.0;
    this.minMargin = 0.08;
    this.cooldownFrames = 0;
  }

  // Cargar un patrón desde JSON de training_data. Acumula ejemplos por nombre.
  // Soporta el formato nuevo (landmarksRight/landmarksLeft, dos manos) y el
  // formato antiguo de una sola mano (`landmarks`), que se trata como mano derecha.
  // Normaliza manos: si la mayoría de frames tienen solo landmarksLeft, los
  // mueve a landmarksRight para que coincidan con la detección en vivo.
  loadPattern(name, frames) {
    // Detectar si hay desbalance de manos (todo en Left, nada en Right)
    let rightCount = 0, leftOnlyCount = 0;
    for (const f of frames) {
      const hasR = (f.landmarksRight && f.landmarksRight.length >= 21);
      const hasL = (f.landmarksLeft && f.landmarksLeft.length >= 21);
      if (hasR) rightCount++;
      if (hasL && !hasR) leftOnlyCount++;
    }
    // Si la mayoría de frames tienen solo Left (sin Right), intercambiar manos
    const leftTotal = leftOnlyCount + frames.filter(f => {
      const hasR = (f.landmarksRight && f.landmarksRight.length >= 21);
      const hasL = (f.landmarksLeft && f.landmarksLeft.length >= 21);
      return hasR && hasL;
    }).length;
    const shouldSwap = leftTotal > frames.length * 0.7 && rightCount < frames.length * 0.15;

    const normalizedFrames = shouldSwap
      ? frames.map(f => ({
          ...f,
          landmarksRight: flipHand(f.landmarksLeft),
          landmarksLeft: f.landmarksRight ?? null,
        }))
      : frames;

    // Determinar si es seña de una sola mano. Si lo es, generar también
    // una versión espejo para soportar la otra mano (ambidiestro).
    const anyHand = normalizedFrames.length;
    const oneHandedFrames = normalizedFrames.filter(f => {
      const hasR = (f.landmarksRight && f.landmarksRight.length >= 21);
      const hasL = (f.landmarksLeft && f.landmarksLeft.length >= 21);
      return (hasR && !hasL) || (!hasR && hasL);
    }).length;
    // Umbral relajado: si >60% de frames son de una mano, tratar como
    // seña de una mano (las señas de dos manos tienen ~0% frames one-handed).
    const oneHanded = oneHandedFrames > anyHand * 0.6;

    const build = (frames) => {
      const infos = frames
        .map(f => frameInfo(f.landmarksRight ?? f.landmarks ?? null, f.landmarksLeft ?? null))
        .filter(Boolean);
      return buildSequence(infos);
    };

    const seq = build(normalizedFrames);
    if (seq.length === 0) return;

    let existing = this.patterns.find(p => p.name === name);
    if (!existing) {
      existing = { name, sequences: [], oneHanded };
      this.patterns.push(existing);
    }

    const addSeq = (s) => {
      if (s.length === 0) return;
      const isDup = existing.sequences.some(es => es.length === s.length && dtw(es, s) < 1e-6);
      if (!isDup) existing.sequences.push(s);
    };

    addSeq(seq);

    // Para señas de una mano, agregar versión espejo (x invertido) para
    // soportar la otra mano. Como frameInfo duplica features a ambos slots
    // cuando solo hay una mano, solo necesitamos invertir x para que la
    // velocidad horizontal sea correcta.
    if (oneHanded) {
      const mirroredFrames = normalizedFrames.map(f => {
        const hand = f.landmarksRight || f.landmarksLeft;
        const flipped = flipHand(hand);
        return {
          ...f,
          landmarksRight: f.landmarksRight ? flipped : null,
          landmarksLeft: f.landmarksLeft ? flipped : null,
        };
      });
      const mirrorSeq = build(mirroredFrames);
      addSeq(mirrorSeq);
    }
  }

  loadPatterns(patternsObj) {
    for (const [name, frames] of Object.entries(patternsObj)) {
      this.loadPattern(name, frames);
    }
  }

  clearPatterns() {
    this.patterns = [];
  }

  clearBuffer() {
    this.buffer = [];
    this.previousInfo = null;
    this.prevVxR = 0;
    this.prevVyR = 0;
    this.prevVxL = 0;
    this.prevVyL = 0;
    this.cooldownFrames = 0;
  }

  pushFrameInfo(info) {
    if (!info) return;
    const prev = this.previousInfo;
    let [vxR, vyR] = handVelocity(info.wristR, prev?.wristR, info.scale);
    let [vxL, vyL] = handVelocity(info.wristL, prev?.wristL, info.scale);
    // Para señas de una mano, usar abs(vx) para coincidir con buildSequence
    if (info.oneHanded) {
      vxR = Math.abs(vxR);
      vxL = Math.abs(vxL);
    }
    const axR = vxR - (this.prevVxR || 0), ayR = vyR - (this.prevVyR || 0);
    const axL = vxL - (this.prevVxL || 0), ayL = vyL - (this.prevVyL || 0);
    this.prevVxR = vxR; this.prevVyR = vyR; this.prevVxL = vxL; this.prevVyL = vyL;
    this.previousInfo = info;

    let relDx = 0, relDy = 0, relPresent = 0;
    if (info.wristR && info.wristL) {
      relDx = (info.wristL.x - info.wristR.x) / info.scale;
      relDy = (info.wristL.y - info.wristR.y) / info.scale;
      relPresent = 1;
    }

    // Posición absoluta de muñeca — debe coincidir con buildSequence
    const wrx = info.wristR ? (info.oneHanded ? Math.abs(info.wristR.x - 0.5) : info.wristR.x) : 0;
    const wry = info.wristR ? info.wristR.y : 0;
    const wlx = info.wristL ? (info.oneHanded ? Math.abs(info.wristL.x - 0.5) : info.wristL.x) : 0;
    const wly = info.wristL ? info.wristL.y : 0;

    this.pushFrame([
      ...info.ffR, info.presentR,
      ...info.ffL, info.presentL,
      relDx, relDy, relPresent,
      vxR * WRIST_WEIGHT, vyR * WRIST_WEIGHT, axR * ACCEL_WEIGHT, ayR * ACCEL_WEIGHT,
      vxL * WRIST_WEIGHT, vyL * WRIST_WEIGHT, axL * ACCEL_WEIGHT, ayL * ACCEL_WEIGHT,
      wrx * WRIST_POS_WEIGHT, wry * WRIST_POS_WEIGHT,
      wlx * WRIST_POS_WEIGHT, wly * WRIST_POS_WEIGHT,
    ]);
  }

  pushFrame(featureVector) {
    if (!featureVector) return;
    this.buffer.push(featureVector);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  // Pre-filtro: calcula el centroide (vector medio) de cada patrón y
  // compara contra el centroide del buffer. Solo los top-N más cercanos
  // pasan a DTW completo. Esto reduce de ~1362 DTW a ~150 por frame.
  _computeCentroid(seq) {
    if (!seq || seq.length === 0) return null;
    const dim = seq[0].length;
    const c = new Array(dim).fill(0);
    for (const v of seq) {
      for (let i = 0; i < dim; i++) c[i] += v[i];
    }
    for (let i = 0; i < dim; i++) c[i] /= seq.length;
    return c;
  }

  _bufferCentroid() {
    if (this.buffer.length === 0) return null;
    const dim = this.buffer[0].length;
    const c = new Array(dim).fill(0);
    for (const v of this.buffer) {
      for (let i = 0; i < dim; i++) c[i] += v[i];
    }
    for (let i = 0; i < dim; i++) c[i] /= this.buffer.length;
    return c;
  }

  _patternCentroid(pattern, seq) {
    if (!pattern._centroids) pattern._centroids = new Map();
    let c = pattern._centroids.get(seq);
    if (!c) {
      c = this._computeCentroid(seq);
      pattern._centroids.set(seq, c);
    }
    return c;
  }

  detectRanking() {
    if (this.buffer.length < this.minBufferSize) return [];
    const buf = this.buffer;

    // Etapa 1: pre-filtro por centroide (barato) → top-N candidatos
    const bufCentroid = this._bufferCentroid();
    const candidates = [];
    for (const pattern of this.patterns) {
      let bestCentDist = Infinity;
      for (const seq of pattern.sequences) {
        const c = this._patternCentroid(pattern, seq);
        if (c) {
          const d = landmarkDistance(bufCentroid, c);
          if (d < bestCentDist) bestCentDist = d;
        }
      }
      candidates.push({ pattern, centDist: bestCentDist });
    }
    candidates.sort((a, b) => a.centDist - b.centDist);
    const topCandidates = candidates.slice(0, PRE_FILTER_N);

    // Etapa 2: DTW solo en los top-N candidatos.
    // Usa los últimos seqLen frames del buffer y DTW completo.
    // En vivo, detect() se llama cada frame, asi que la ventana deslizante
    // eventualmente captura la seña completa cuando coincide con el patron.
    const ranking = [];
    for (const { pattern } of topCandidates) {
      let best = Infinity;
      for (const seq of pattern.sequences) {
        const seqLen = seq.length;
        let score;
        if (buf.length >= seqLen) {
          const subBuf = buf.slice(buf.length - seqLen);
          score = dtw(subBuf, seq);
        } else {
          score = dtw(buf, seq);
        }
        if (score < best) best = score;
      }
      if (best === Infinity) continue;
      ranking.push({ name: pattern.name, score: best });
    }
    ranking.sort((a, b) => a.score - b.score);
    return ranking;
  }

  // Ranking de varias secuencias candidatas a la vez (las ventanas en vivo ya
  // remuestreadas a PATTERN_FRAMES). Pre-filtro por centroide con la ventana
  // más cercana a cada seña y DTW solo en las `prefilterN` mejores.
  // Cada entrada indica qué ventana (`window`, índice en `sequences`) ganó.
  rankSequences(sequences, prefilterN = PRE_FILTER_N) {
    const seqs = (sequences || []).filter(s => Array.isArray(s) && s.length > 0);
    if (seqs.length === 0 || this.patterns.length === 0) return [];
    const queryCentroids = seqs.map(s => this._computeCentroid(s));
    const candidates = [];
    for (const pattern of this.patterns) {
      let bestCentDist = Infinity;
      for (const seq of pattern.sequences) {
        const c = this._patternCentroid(pattern, seq);
        for (const qc of queryCentroids) {
          const d = landmarkDistance(qc, c);
          if (d < bestCentDist) bestCentDist = d;
        }
      }
      candidates.push({ pattern, centDist: bestCentDist });
    }
    candidates.sort((a, b) => a.centDist - b.centDist);

    const ranking = [];
    for (const { pattern } of candidates.slice(0, prefilterN)) {
      let best = Infinity, window = -1;
      for (const ps of pattern.sequences) {
        for (let w = 0; w < seqs.length; w++) {
          const score = dtw(seqs[w], ps);
          if (score < best) { best = score; window = w; }
        }
      }
      if (best !== Infinity) ranking.push({ name: pattern.name, score: best, window });
    }
    ranking.sort((a, b) => a.score - b.score);
    return ranking;
  }

  // Detectar la mejor seña comparando sub-ventanas del buffer.
  // El margen se mide contra la SIGUIENTE seña distinta: comparar contra otra
  // ventana del mismo patron daria un margen casi cero siempre.
  detect() {
    if (this.cooldownFrames > 0) { this.cooldownFrames--; }
    const ranking = this.detectRanking();
    if (ranking.length === 0) return null;
    const bestScore = ranking[0].score;
    const margin = ranking.length > 1 ? ranking[1].score - bestScore : Infinity;
    const confidence = Math.max(0, Math.min(100, Math.round((1 - bestScore) * 100)));
    const accepted = bestScore <= this.threshold && margin >= this.minMargin && this.cooldownFrames === 0;
    // Si se aceptó, limpiar buffer y entrar en cooldown para evitar re-detección
    if (accepted) {
      this.buffer = [];
      this.previousInfo = null;
      this.prevVxR = 0; this.prevVyR = 0; this.prevVxL = 0; this.prevVyL = 0;
      this.cooldownFrames = 15; // ~0.5s a 30fps
    }
    return {
      matched: ranking[0].name,
      score: bestScore,
      confidence,
      margin,
      ranking,
      accepted,
    };
  }

  // Clasifica una o varias secuencias completas (por ejemplo, los segmentos de un video)
  // comparándolas contra cada seña entrenada. Usa el PROMEDIO por seña de la mejor
  // distancia por secuencia, para que ninguna gane solo por tener más ejemplos.
  classifySequences(sequences) {
    const seqs = (sequences || []).filter(s => Array.isArray(s) && s.length > 0);
    if (seqs.length === 0 || this.patterns.length === 0) return null;
    const ranking = [];
    for (const pattern of this.patterns) {
      let best = Infinity;
      for (const ps of pattern.sequences) {
        for (const seq of seqs) best = Math.min(best, dtw(seq, ps));
      }
      if (best !== Infinity) ranking.push({ name: pattern.name, score: best });
    }
    if (ranking.length === 0) return null;
    ranking.sort((a, b) => a.score - b.score);
    const best = ranking[0];
    const margin = ranking.length > 1 ? ranking[1].score - best.score : Infinity;
    const accepted = ranking.length === 1 || margin >= Math.max(0.01, best.score * 0.02);
    return { matched: best.name, score: best.score, margin, accepted, ranking };
  }

  getStatus() {
    return {
      patternsLoaded: this.patterns.map(p => p.name),
      totalSequences: this.patterns.reduce((a, p) => a + p.sequences.length, 0),
      bufferSize: this.buffer.length,
    };
  }
}

// ── Reconocimiento en vivo por ventanas ──
// No se sabe cuánto dura la seña de quien está frente a la cámara, así que en
// cada evaluación se prueban varias duraciones que terminan en el cuadro más
// reciente; cada una se remuestrea a PATTERN_FRAMES antes del DTW.
// Umbrales calibrados con scripts/sim_live_detection.mjs: la distancia del #1
// casi no separa aciertos de errores (medianas 1.2 contra 1.65), el margen
// contra el #2 sí (0.41 contra 0.10), así que la regla se apoya en el margen.
// Los errores llegan al principio, con la seña a medias en la ventana
// (mediana 0.5 s contra 2.1 s de los aciertos): de ahí minAcceptMs.
export const LIVE_DEFAULTS = {
  windowsMs: [1200, 2000, 2800], // duraciones de seña probadas al final del buffer
  bufferMs: 2800,                // lo más viejo que se conserva (= ventana más larga)
  minWindowFrames: 10,           // ~0.33 s a 30 fps
  maxGapFrames: 6,               // huecos de una mano que se rellenan (~0.2 s a 30 fps)
  evalEveryMs: 150,
  prefilterN: PRE_FILTER_N,
  // Mano en reposo en cada ventana: "off" tal cual, "drop" sin ella, "both"
  // compara las dos versiones (el filtro decide distinto que en el patrón
  // cuando el movimiento está cerca del umbral). Los patrones se cargan con
  // cleanRestingHand para que coincidan.
  restingHand: "both",
  scoreThreshold: 2.0,           // distancia DTW máxima del #1
  marginThreshold: 0.3,          // distancia del #2 menos la del #1
  relMarginThreshold: 0,         // ese margen dividido entre la distancia del #1
  stableEvals: 2,                // evaluaciones seguidas con el mismo #1
  minAcceptMs: 1200,             // tiempo con manos a la vista antes de aceptar
};

// Un paso de la regla de aceptación: el #1 debe pasar los umbrales y
// repetirse en `stableEvals` evaluaciones seguidas, y no antes de
// `minAcceptMs` desde que aparecieron las manos (`elapsedMs`). Función pura
// para que la página y la simulación usen exactamente la misma regla.
export function acceptanceStep(state, ranking, opts, elapsedMs = Infinity) {
  const guess = ranking[0];
  if (!guess) return { name: null, count: 0, margin: Infinity, accepted: false };
  const margin = ranking.length > 1 ? ranking[1].score - guess.score : Infinity;
  const passes = elapsedMs >= (opts.minAcceptMs ?? 0)
    && guess.score < opts.scoreThreshold
    && margin > opts.marginThreshold
    && margin / Math.max(guess.score, 1e-6) > (opts.relMarginThreshold ?? 0);
  const count = passes ? (state.name === guess.name ? state.count + 1 : 1) : 0;
  return { name: passes ? guess.name : null, count, margin, accepted: passes && count >= opts.stableEvals };
}

export class LiveSignRecognizer {
  constructor(detector, options = {}) {
    this.detector = detector;
    this.opts = { ...LIVE_DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.frames = [];
    this.startedAt = null;
    this.lastEvalAt = -Infinity;
    this.state = { name: null, count: 0 };
  }

  get bufferSize() {
    return this.frames.length;
  }

  // frame: {landmarksRight, landmarksLeft} ya corregido por proporción; t en ms.
  // Devuelve null si no tocaba evaluar, o { ranking, guess, margin, accepted, elapsedMs }.
  push(frame, t) {
    const o = this.opts;
    if (this.startedAt === null) this.startedAt = t;
    this.frames.push({ landmarksRight: frame.landmarksRight, landmarksLeft: frame.landmarksLeft, t });
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop].t < t - o.bufferMs) drop++;
    if (drop > 0) this.frames.splice(0, drop);
    if (t - this.lastEvalAt < o.evalEveryMs || this.frames.length < o.minWindowFrames) return null;
    this.lastEvalAt = t;

    const ranking = this.detector.rankSequences(this.windowSequences(t), o.prefilterN);
    const elapsedMs = t - this.startedAt;
    const step = acceptanceStep(this.state, ranking, o, elapsedMs);
    this.state = { name: step.name, count: step.count };
    return { ranking, guess: ranking[0] || null, margin: step.margin, accepted: step.accepted, elapsedMs };
  }

  windowSequences(t) {
    const o = this.opts;
    const seqs = [];
    let prevLen = 0;
    for (const w of o.windowsMs) {
      let start = 0;
      while (start < this.frames.length && this.frames[start].t < t - w) start++;
      const len = this.frames.length - start;
      // Una ventana más larga que el buffer repetiría la anterior.
      if (len < o.minWindowFrames || len === prevLen) continue;
      prevLen = len;
      const win = resampleLandmarkFrames(fillHandGaps(this.frames.slice(start), o.maxGapFrames), PATTERN_FRAMES);
      const cleaned = o.restingHand === "off" ? win : dropRestingHand(win);
      if (cleaned === win || o.restingHand === "both") seqs.push(sequenceFromFrames(win));
      if (cleaned !== win) seqs.push(sequenceFromFrames(cleaned));
    }
    return seqs;
  }
}

export const dynamicDetector = new DynamicSignDetector();
