/**
 * sign_sequence_buffer.js — Búfer de fotogramas CRUDOS para el clasificador ONNX.
 *
 * Cada fotograma guarda los landmarks tal como salen de MediaPipe
 * ({ landmarksRight, landmarksLeft, landmarksFace }); la normalización y el
 * remuestreo a 24 frames los hace onnx_classifier.js, igual que en
 * entrenamiento. Este módulo solo decide QUÉ fotogramas se le entregan:
 *
 *   - `window`:  los últimos `windowMs` (ventana deslizante), para señas
 *                estáticas y para una predicción continua.
 *   - `segment`: cuando la muñeca arranca, se mueve y se detiene, el tramo
 *                completo del movimiento. Es UNA predicción robusta para señas
 *                dinámicas, y llega justo cuando el usuario baja la mano.
 *
 * Qué mano es la derecha y cuál la izquierda se decide por continuidad de la
 * muñeca (como `assign_slots` de python_scripts/extract_face_hands.py), y la
 * etiqueta de MediaPipe solo desempata. Así el vector coincide con el de entrenamiento.
 *
 * Código puro (sin React ni ONNX): se prueba en Node.
 */

export const DEFAULT_BUFFER_CONFIG = {
  /** Duración de la ventana deslizante (ms). */
  windowMs: 1200,
  /** Mínimo de frames reales para emitir una ventana. */
  minWindowFrames: 12,
  /** Historial máximo guardado (ms). */
  maxHistoryMs: 4000,
  /** Velocidad de la muñeca (altos de frame / s) que inicia un movimiento. */
  motionStartSpeed: 0.5,
  /** Velocidad por debajo de la cual el movimiento se considera detenido. */
  motionStopSpeed: 0.25,
  /** Quieto este tiempo => el segmento terminó. */
  stopConfirmMs: 150,
  /** Movimiento mínimo para que un segmento cuente. */
  minMotionMs: 250,
  /** Movimiento máximo: se corta y se analiza aunque no se haya detenido. */
  maxMotionMs: 3000,
  /** Frames previos al arranque que se incluyen en el segmento. */
  preRollMs: 120,
  /** Sin mano durante este tiempo => se vacía el búfer. */
  noHandResetMs: 300,
  /** Ancho/alto del video, para medir distancias de forma isótropa. */
  aspect: 4 / 3,
};

// ---------------------------------------------------------------------------
// Asignación de manos a derecha / izquierda
// ---------------------------------------------------------------------------

/** Salto máximo (fracción del frame) de una muñeca entre frames para conservar su espacio. */
export const MAX_SLOT_JUMP = 0.25;
/** Frames sin ver una mano tras los cuales se olvida su última posición. */
const SLOT_MEMORY_FRAMES = 10;

export function createSlotTracker() {
  let prev = { right: null, left: null }; // { x, y, age }
  const dist = (w, p) => (p ? Math.hypot(w.x - p.x, w.y - p.y) : null);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function remember(out) {
    for (const slot of ["right", "left"]) {
      const hand = out[slot];
      if (hand) prev[slot] = { x: hand[0].x, y: hand[0].y, age: 0 };
      else if (prev[slot] && ++prev[slot].age > SLOT_MEMORY_FRAMES) prev[slot] = null;
    }
  }

  return {
    /** @param {Array<{handedness:string, landmarks:Array}>} hands  hasta 2 manos del frame */
    assign(hands) {
      const out = { right: null, left: null };
      const hs = (hands ?? []).slice(0, 2).filter((h) => h?.landmarks?.length >= 21);

      if (hs.length === 2) {
        const w0 = hs[0].landmarks[0];
        const w1 = hs[1].landmarks[0];
        const direct = [dist(w0, prev.right), dist(w1, prev.left)].filter((d) => d !== null);
        const swapped = [dist(w1, prev.right), dist(w0, prev.left)].filter((d) => d !== null);
        const useSwap =
          direct.length && swapped.length
            ? sum(swapped) < sum(direct)
            : hs[0].handedness === "Left" || hs[1].handedness === "Right";
        out.right = useSwap ? hs[1].landmarks : hs[0].landmarks;
        out.left = useSwap ? hs[0].landmarks : hs[1].landmarks;
      } else if (hs.length === 1) {
        const w = hs[0].landmarks[0];
        const dr = dist(w, prev.right);
        const dl = dist(w, prev.left);
        let toRight;
        if (dr !== null && dl !== null) toRight = dr <= dl;
        else if (dr !== null) toRight = dr <= MAX_SLOT_JUMP;
        else if (dl !== null) toRight = !(dl <= MAX_SLOT_JUMP);
        else toRight = hs[0].handedness !== "Left";
        if (toRight) out.right = hs[0].landmarks;
        else out.left = hs[0].landmarks;
      }
      remember(out);
      return out;
    },
    reset() {
      prev = { right: null, left: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Búfer
// ---------------------------------------------------------------------------

const plain = (pts) => pts.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));

export function createSequenceBuffer(userConfig = {}) {
  let cfg = { ...DEFAULT_BUFFER_CONFIG, ...userConfig };
  const tracker = createSlotTracker();

  const frames = []; // { t, frame:{landmarksRight,landmarksLeft,landmarksFace}, x, y }
  let motion = "idle"; // idle | moving | stopping
  let motionStart = 0;
  let stopSince = 0;
  let lastHandTs = 0;
  let faceCache = { src: null, plain: null };

  function clear() {
    frames.length = 0;
    motion = "idle";
    motionStart = 0;
    stopSince = 0;
    tracker.reset();
  }

  /** La cara cambia despacio y llega cada pocos frames: se copia una vez por detección. */
  function faceFrom(faceRes) {
    const src = faceRes?.faceLandmarks?.[0] ?? null;
    if (!src) return null;
    if (faceCache.src !== src) faceCache = { src, plain: plain(src) };
    return faceCache.plain;
  }

  function speedAt() {
    if (frames.length < 2) return 0;
    const last = frames[frames.length - 1];
    let i = frames.length - 2;
    while (i > 0 && last.t - frames[i].t < 50) i--;
    const dt = last.t - frames[i].t;
    if (dt <= 0) return 0;
    return (Math.hypot(last.x - frames[i].x, last.y - frames[i].y) * 1000) / dt;
  }

  const framesBetween = (from, to) => frames.filter((f) => f.t >= from && f.t <= to).map((f) => f.frame);

  function closeSegment(endTs) {
    const start = motionStart;
    motion = "idle";
    if (endTs - start < cfg.minMotionMs) return null;
    const seg = framesBetween(start - cfg.preRollMs, endTs);
    return seg.length >= 3 ? seg : null;
  }

  /**
   * @param {object} input
   * @param {object} input.handRes   resultado de HandLandmarker ({landmarks, handedness})
   * @param {object} [input.faceRes] último resultado de FaceLandmarker ({faceLandmarks})
   * @param {number} input.timestamp ms
   * @returns {{window:Array|null, segment:Array|null, moving:boolean, speed:number, frames:number}}
   */
  function push({ handRes, faceRes, timestamp: now }) {
    const handList = (handRes?.landmarks ?? []).map((landmarks, i) => ({
      handedness: handRes?.handedness?.[i]?.[0]?.categoryName ?? "Unknown",
      landmarks,
    }));
    if (!handList.length) return noHand(now);

    lastHandTs = now;
    const slots = tracker.assign(handList);
    const frame = {
      landmarksRight: slots.right ? plain(slots.right) : null,
      landmarksLeft: slots.left ? plain(slots.left) : null,
      landmarksFace: faceFrom(faceRes),
    };

    // Posición de la muñeca (promedio de las presentes), con ancho/alto isótropos
    const wrists = [frame.landmarksRight, frame.landmarksLeft].filter(Boolean).map((h) => h[0]);
    const x = (wrists.reduce((s, w) => s + w.x, 0) / wrists.length) * cfg.aspect;
    const y = wrists.reduce((s, w) => s + w.y, 0) / wrists.length;
    frames.push({ t: now, frame, x, y });
    while (frames.length && now - frames[0].t > cfg.maxHistoryMs) frames.shift();

    const speed = speedAt();
    let segment = null;
    if (motion === "idle") {
      if (speed >= cfg.motionStartSpeed) {
        motion = "moving";
        motionStart = now;
      }
    } else if (motion === "moving") {
      if (speed < cfg.motionStopSpeed) {
        motion = "stopping";
        stopSince = now;
      } else if (now - motionStart >= cfg.maxMotionMs) {
        segment = closeSegment(now);
      }
    } else if (motion === "stopping") {
      if (speed >= cfg.motionStartSpeed) motion = "moving";
      else if (now - stopSince >= cfg.stopConfirmMs) segment = closeSegment(stopSince);
    }

    const recent = framesBetween(now - cfg.windowMs, now);
    return {
      window: recent.length >= cfg.minWindowFrames ? recent : null,
      segment,
      moving: motion !== "idle",
      speed,
      frames: frames.length,
    };
  }

  /**
   * Llamar en los frames sin mano. Si la mano salió de cuadro a mitad de un
   * movimiento (el usuario la bajó al terminar la seña), ese movimiento se
   * cierra como segmento. Si la ausencia dura, se vacía el búfer.
   */
  function noHand(now) {
    let segment = null;
    if (motion !== "idle" && now - lastHandTs >= cfg.stopConfirmMs) segment = closeSegment(lastHandTs);
    if (frames.length && now - lastHandTs > cfg.noHandResetMs) clear();
    return { window: null, segment, moving: false, speed: 0, frames: frames.length };
  }

  return {
    push,
    noHand,
    clear,
    setConfig(partial) {
      cfg = { ...cfg, ...partial };
    },
    getConfig: () => ({ ...cfg }),
  };
}
