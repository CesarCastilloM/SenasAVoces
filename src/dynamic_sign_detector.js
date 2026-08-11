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

  detectRanking() {
    if (this.buffer.length < this.minBufferSize) return [];
    const buf = this.buffer;

    // Etapa 1: pre-filtro por centroide (barato) → top-N candidatos
    const bufCentroid = this._bufferCentroid();
    const candidates = [];
    for (const pattern of this.patterns) {
      let bestCentDist = Infinity;
      for (const seq of pattern.sequences) {
        if (!pattern._centroids) pattern._centroids = new Map();
        let c = pattern._centroids.get(seq);
        if (!c) {
          c = this._computeCentroid(seq);
          pattern._centroids.set(seq, c);
        }
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

export const dynamicDetector = new DynamicSignDetector();
