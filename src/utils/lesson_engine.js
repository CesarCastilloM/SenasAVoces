/**
 * lesson_engine.js — Juez de verificación para las lecciones con cámara.
 *
 * Solo importa la probabilidad que el modelo da a la seña objetivo:
 *   >= correctThreshold (80 %) sostenida `holdMs` (250 ms)  => "correct" (evento, una sola vez)
 *   entre almostThreshold (50 %) y 80 %                      => "almost"  (¡Casi! Ajusta tu postura)
 *   menos                                                    => "waiting"
 *
 * El 80 % se exige sostenido para que un pico de un solo frame no cuente como
 * acierto (con cientos de clases esos picos aparecen).
 *
 * Señas con movimiento: el modelo da su mejor predicción cuando el movimiento
 * TERMINA, justo cuando la mano ya está bajando. Por eso el juez acepta un
 * `segmentScore` (probabilidad de un movimiento completo recién terminado) y
 * recuerda ese pico `peakMemoryMs` (2 s): aunque el usuario baje la mano o
 * salga de cuadro, el acierto no se pierde. Los puntajes de la ventana continua
 * NO tienen memoria, así que un parpadeo del modelo no se queda "pegado".
 *
 * Código puro (sin React ni ONNX): se prueba en Node.
 */

export const DEFAULT_LESSON_CONFIG = {
  correctThreshold: 0.8,
  almostThreshold: 0.5,
  /** El puntaje debe mantenerse >= correctThreshold durante este tiempo. */
  holdMs: 250,
  /** Ventana para suavizar el estado "casi" (evita parpadeo del mensaje). */
  almostWindowMs: 400,
  /** Cuánto se recuerda el pico de un movimiento completo. */
  peakMemoryMs: 2000,
};

export function createLessonJudge(userConfig = {}) {
  const cfg = { ...DEFAULT_LESSON_CONFIG, ...userConfig };
  let samples = []; // { t, score }  puntaje efectivo por frame
  let peak = null; // { score, t }  pico recordado de un segmento
  let solved = false;

  function reset() {
    samples = [];
    peak = null;
    solved = false;
  }

  /**
   * @param {object} frame
   * @param {number} frame.score  probabilidad actual de la seña objetivo (ventana deslizante); 0 si no hay mano
   * @param {number|null} [frame.segmentScore]  probabilidad de un movimiento completo que acaba de terminar
   * @param {number} frame.timestamp  ms
   * @returns {{phase:'waiting'|'almost'|'correct', score:number, peak:number, event:'correct'|null}}
   */
  function update({ score, segmentScore = null, timestamp: now }) {
    if (peak && now - peak.t > cfg.peakMemoryMs) peak = null;
    if (segmentScore != null) {
      // Se conserva el pico más alto que siga vigente
      if (!peak || segmentScore >= peak.score) peak = { score: segmentScore, t: now };
    }
    const remembered = peak ? peak.score : 0;
    const effective = Math.max(score, remembered);

    if (solved) return { phase: 'correct', score: effective, peak: remembered, event: null };

    samples.push({ t: now, score: effective });
    const keep = Math.max(cfg.holdMs, cfg.almostWindowMs) + 100;
    while (samples.length && now - samples[0].t > keep) samples.shift();

    // ¿Todo el tramo de holdMs estuvo por encima del umbral?
    const holdFrom = now - cfg.holdMs;
    const spansHold = samples.length > 1 && samples[0].t <= holdFrom + 1;
    const recentHold = samples.filter((s) => s.t >= holdFrom);
    if (spansHold && recentHold.length && recentHold.every((s) => s.score >= cfg.correctThreshold)) {
      solved = true;
      return { phase: 'correct', score: effective, peak: remembered, event: 'correct' };
    }

    const best = Math.max(...samples.filter((s) => s.t >= now - cfg.almostWindowMs).map((s) => s.score));
    if (best >= cfg.almostThreshold) {
      // Si ya hay >= 80 % pero aún no se sostuvo holdMs, sigue siendo "casi".
      return { phase: 'almost', score: best, peak: remembered, event: null };
    }
    return { phase: 'waiting', score: best, peak: remembered, event: null };
  }

  return { update, reset, isSolved: () => solved, getConfig: () => ({ ...cfg }) };
}
