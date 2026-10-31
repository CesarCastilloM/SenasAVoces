/**
 * sign_class_map.js — Une las señas de las lecciones con las clases del modelo ONNX.
 *
 * Las lecciones nombran las señas con acentos y espacios ("BUENOS DÍAS",
 * "¿CÓMO ESTÁS? (2)") y el modelo las guarda como identificadores en mayúsculas
 * sin acentos ("BUENOS_DIAS", "COMO_ESTAS"). Reglas, en orden:
 *
 *   1. directa    el nombre normalizado coincide con una clase.
 *   2. variante   "NOMBRE (n)" se asigna a la clase de NOMBRE. Las variantes
 *                 "(1)", "(2)"… son señas alternativas de la misma palabra y
 *                 el modelo aprendió una sola; se aceptan con esa reserva.
 *   3. alias      variantes ortográficas conocidas (OBSCURO -> OSCURO).
 *
 * Todo lo demás devuelve null: esa seña no tiene clase y sigue con su plantilla
 * (si la tiene) o sin verificación automática.
 */

/** Variantes ortográficas: clave y valor normalizados con signKey(). */
export const CLASS_ALIASES = {
  OBSCURO: "OSCURO",
};

/** minúsculas/acentos fuera, no alfanumérico => "_". La letra suelta Ñ se distingue de la N. */
export function signKey(label) {
  const s = String(label ?? "").trim().toUpperCase();
  const t = s === "Ñ" ? "NY" : s;
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const VARIANT_SUFFIX = /\s*\(\d+\)\s*$/;

/**
 * @param {string[]} classLabels  nombres de clase del modelo (sign_labels.json)
 * @param {{aliases?: Record<string,string>}} [opts]
 * @returns {{resolve:(label:string)=>({className:string, kind:'directa'|'variante'|'alias'}|null), size:number}}
 */
export function createClassMap(classLabels, { aliases = CLASS_ALIASES } = {}) {
  const byKey = new Map();
  for (const c of classLabels ?? []) byKey.set(signKey(c), c);

  function resolve(label) {
    const raw = String(label ?? "");
    if (!raw.trim()) return null;

    const direct = byKey.get(signKey(raw));
    if (direct) return { className: direct, kind: "directa" };

    const isVariant = VARIANT_SUFFIX.test(raw);
    const base = isVariant ? raw.replace(VARIANT_SUFFIX, "") : raw;
    const baseKey = signKey(base);

    const viaBase = isVariant ? byKey.get(baseKey) : null;
    if (viaBase) return { className: viaBase, kind: "variante" };

    const aliasTarget = aliases[baseKey];
    const viaAlias = aliasTarget ? byKey.get(aliasTarget) : null;
    if (viaAlias) return { className: viaAlias, kind: isVariant ? "variante" : "alias" };

    return null;
  }

  return { resolve, size: byKey.size };
}
