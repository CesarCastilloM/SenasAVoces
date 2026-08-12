import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { HandLandmarker, PoseLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import "./styles/styles.css";
import { GLOSARIO_LESSONS, ALPHABET_LESSON } from "./lessons_glosario.js";
import { fingerStates, scoreTarget, detectBestLetter, MATCH_THR, scoreLetter, LSM_ALPHABET, NUMBER_TEMPLATES } from "./lsm_detector.js";
import { dynamicDetector, featureFromFingerStates, frameInfo, buildSequence, splitHands } from "./dynamic_sign_detector.js";
import { parseNpy, npyToFrames } from "./npy_parser.js";
import { initClassifier, classifySequence, isClassifierReady } from "./onnx_classifier.js";
import ModelTestPage from "./model_test_page.jsx";
import TrainPage from "./train_page.jsx";
import TrainingViewerPage from "./training_viewer_page.jsx";
import RetrainPage from "./retrain_page.jsx";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import AuthPage from "./components/AuthPage";
import EmailConfirmationPage from "./components/EmailConfirmationPage";
import { updateSignProgress, updateModuleProgress, updateStreak, recordVideoView, updateWeeklyActivity, updatePracticeDays, getRecommendations } from "./services/progressService";
import { Analytics } from "@vercel/analytics/react";
import { supabase } from "./lib/supabaseClient";

const navItems = [
  { path: "/", label: "Acceso", icon: "lock" },
  { path: "/dashboard", label: "Dashboard", icon: "trophy" },
  { path: "/learn", label: "Progreso", icon: "sparkles" },
  { path: "/lesson", label: "Lecciones", icon: "book" },
  { path: "/practice", label: "Práctica", icon: "camera" },
  { path: "/video-test", label: "Videos", icon: "video" },
  { path: "/model-test", label: "Probar modelo", icon: "beaker" },
  { path: "/train", label: "Entrenar", icon: "pencil" },
  { path: "/retrain", label: "Re-entrenar", icon: "refresh" },
  { path: "/training-viewer", label: "Ver entrenamiento", icon: "chart" }
];

const modules = [ALPHABET_LESSON, ...GLOSARIO_LESSONS].map((lesson, i) => ({
  id: lesson.id,
  title: lesson.title,
  desc: `${lesson.items.length} señas · Nivel ${lesson.level}`,
  signs: lesson.items.length,
  status: i === 0 ? "current" : i < 3 ? "completed" : "locked",
  items: lesson.items,
  level: lesson.level,
  icon: getModuleIcon(lesson.title),
}));

function getModuleIcon(title) {
  const iconMap = {
    "Abecedario LSM (A–Z + Ñ)": "abc",
    "Números (todos)": "numbers",
    "Expresiones cotidianas": "expressions",
    "Colores (todos)": "colors",
    "Familia (50 señas)": "family",
    "Salud y medicina": "health",
    "Educación y escuela": "education",
    "Tecnología y redes": "technology",
  };
  return iconMap[title] || "book";
}

function getSignIcon(name) {
  const iconMap = {
    // Números
    "1": "number-1",
    "2": "number-2",
    "3": "number-3",
    "4": "number-4",
    "5": "number-5",
    "6": "number-6",
    "7": "number-7",
    "8": "number-8",
    "9": "number-9",
    "10": "number-10",
    "20": "number-20",
    "100": "number-100",
    // Expresiones
    "DISCULPA": "sorry",
    "POR FAVOR": "please",
    "¿CÓMO ESTÁS?": "how-are-you",
    "¿CÓMO TE LLAMAS?": "what-name",
    "¡SORPRESA!": "surprise",
    "¡QUÉ MILAGRO!": "miracle",
    // Colores
    "ROJO": "red",
    "AZUL": "blue",
    "VERDE": "green",
    "AMARILLO": "yellow",
    "BLANCO": "white",
    "NEGRO": "black",
    "NARANJA": "orange",
    "MORADO": "purple",
    "ROSA": "pink",
    "CAFÉ": "brown",
    // Familia
    "MAMÁ": "mom",
    "PAPÁ": "dad",
    "HERMANO": "brother",
    "ABUELO": "grandpa",
    "ABUELA": "grandma",
    "TÍO": "uncle",
    "ESPOSO": "spouse",
    // Salud
    "DOCTOR": "doctor",
    "HOSPITAL": "hospital",
    "MEDICINA": "medicine",
    "ENFERMEDAD": "disease",
    "EMERGENCIA": "emergency",
    // Tecnología
    "INTERNET": "internet",
    "TELÉFONO": "phone",
    "COMPUTADORA": "computer",
    "INSTAGRAM": "instagram",
    "YOUTUBE": "youtube",
  };
  return iconMap[name] || "sparkles";
}

// signsQueue generado desde ALPHABET_LESSON + currículum del lsm_teacher.py
// Orden: Abecedario (G0) → Números (G1) → Expresiones → Colores → Familia → Salud → Tecnología
const signsQueue = [
  // ── G0: Abecedario LSM (orden del build_curriculum de lsm_teacher.py) ──
  ...ALPHABET_LESSON.items.map((it) => ({
    name:       it.label,
    difficulty: it.mov ? "Media" : "Fácil",
    module:     "Abecedario",
    hint:       it.hint,
    template:   it.template,
    mov:        it.mov,
    video_ref:  it.video_ref,
    thumbnail:  it.thumbnail,
  })),
  // ── G1: Números 1-10 (geométricos, fáciles) ──
  { name:"1",  difficulty:"Fácil",   module:"Números", hint:"Índice extendido hacia arriba; resto del puño cerrado.",          template:"CECCC", mov:false },
  { name:"2",  difficulty:"Fácil",   module:"Números", hint:"Índice y medio extendidos en V. Mano quieta.",                    template:"CEECC", mov:false },
  { name:"3",  difficulty:"Fácil",   module:"Números", hint:"Índice, medio y anular extendidos (como la W).",                  template:"CEEEC", mov:false },
  { name:"4",  difficulty:"Fácil",   module:"Números", hint:"Cuatro dedos extendidos, pulgar cerrado.",                        template:"CEEEE", mov:false },
  { name:"5",  difficulty:"Fácil",   module:"Números", hint:"Mano abierta, los cinco dedos extendidos.",                      template:"EEEEE", mov:false },
  { name:"6",  difficulty:"Media",   module:"Números", hint:"4 dedos extendidos + pulgar doblado tocando la palma (no el costado).", template:"CEEEE", mov:false },
  { name:"7",  difficulty:"Media",   module:"Números", hint:"Índice+medio+meñique extendidos; anular doblado hacia el pulgar.", template:"CEEEC", mov:false },
  { name:"8",  difficulty:"Media",   module:"Números", hint:"Índice+anular+meñique extendidos; medio doblado al pulgar.",       template:"CEECE", mov:false },
  { name:"9",  difficulty:"Media",   module:"Números", hint:"Medio+anular+meñique extendidos; índice doblado al pulgar.",       template:"CECEE", mov:false },
  { name:"10", difficulty:"Difícil", module:"Números", hint:"Pulgar e índice extendidos — mueve la mano de lado a lado.",       template:null,    mov:true  },
  { name:"20", difficulty:"Difícil", module:"Números", hint:"Pulgar e índice en círculo — mueve la mano en círculos pequeños.", template:null,    mov:true  },
  { name:"100",difficulty:"Difícil", module:"Números", hint:"Seña LSM de cien — usa el botón Saltar si no tienes template.",    template:null,    mov:false },
  // ── G2: Expresiones cotidianas ──
  { name:"DISCULPA",         difficulty:"Fácil",   module:"Expresiones", hint:"Mano en el pecho, movimiento hacia afuera." },
  { name:"POR FAVOR",        difficulty:"Fácil",   module:"Expresiones", hint:"Palma hacia arriba, movimiento circular." },
  { name:"¿CÓMO ESTÁS?",     difficulty:"Media",   module:"Expresiones", hint:"Expresión facial + seña combinada." },
  { name:"¿CÓMO TE LLAMAS?", difficulty:"Media",   module:"Expresiones", hint:"Pregunta con cejas arriba." },
  { name:"¡SORPRESA!",       difficulty:"Media",   module:"Expresiones", hint:"Ojos abiertos + manos abiertas.", },
  { name:"¡QUÉ MILAGRO!",    difficulty:"Difícil", module:"Expresiones", hint:"Expresión facial enfatizada." },
  // ── G3: Colores ──
  { name:"ROJO",    difficulty:"Fácil",   module:"Colores", hint:"Índice rozando el labio hacia abajo." },
  { name:"AZUL",    difficulty:"Fácil",   module:"Colores", hint:"Mano en 'A' moviéndose hacia el lado." },
  { name:"VERDE",   difficulty:"Fácil",   module:"Colores", hint:"Mano en 'V' con movimiento." },
  { name:"AMARILLO",difficulty:"Fácil",   module:"Colores", hint:"Mano en 'Y' con movimiento." },
  { name:"BLANCO",  difficulty:"Media",   module:"Colores", hint:"Mano abierta sobre el pecho, cierra al separar." },
  { name:"NEGRO",   difficulty:"Media",   module:"Colores", hint:"Índice cruza la frente." },
  { name:"NARANJA", difficulty:"Media",   module:"Colores", hint:"Mano en 'C' abriendo y cerrando." },
  { name:"MORADO",  difficulty:"Media",   module:"Colores", hint:"Mano en 'M' moviéndose." },
  { name:"ROSA",    difficulty:"Difícil", module:"Colores", hint:"Dedo medio rozando los labios hacia abajo." },
  { name:"CAFÉ",    difficulty:"Difícil", module:"Colores", hint:"Mano en 'C' sobre la otra mano." },
  // ── G4: Familia ──
  { name:"MAMÁ",    difficulty:"Fácil",   module:"Familia", hint:"Mano abierta, pulgar toca la barbilla." },
  { name:"PAPÁ",    difficulty:"Fácil",   module:"Familia", hint:"Mano abierta, pulgar toca la frente." },
  { name:"HERMANO", difficulty:"Fácil",   module:"Familia", hint:"Índices juntos moviéndose en paralelo." },
  { name:"ABUELO",  difficulty:"Media",   module:"Familia", hint:"Mano en 'A' desde la barbilla hacia afuera." },
  { name:"ABUELA",  difficulty:"Media",   module:"Familia", hint:"Mano en 'A' desde la barbilla, dos movimientos." },
  { name:"TÍO",     difficulty:"Media",   module:"Familia", hint:"Mano en 'T' moviéndose." },
  { name:"ESPOSO",  difficulty:"Difícil", module:"Familia", hint:"Seña de hombre + anillo." },
  // ── G5: Salud ──
  { name:"DOCTOR",     difficulty:"Media",   module:"Salud", hint:"Dedos en 'D' tocando la muñeca." },
  { name:"HOSPITAL",   difficulty:"Media",   module:"Salud", hint:"Cruz dibujada en el brazo." },
  { name:"MEDICINA",   difficulty:"Media",   module:"Salud", hint:"Pastilla entre dedos índice y pulgar." },
  { name:"ENFERMEDAD", difficulty:"Difícil", module:"Salud", hint:"Dedos en la frente y el estómago." },
  { name:"EMERGENCIA", difficulty:"Difícil", module:"Salud", hint:"Manos en movimiento urgente." },
  // ── G7: Tecnología ──
  { name:"INTERNET",    difficulty:"Media",   module:"Tecnología", hint:"Dedos en 'W' moviéndose en círculo." },
  { name:"TELÉFONO",    difficulty:"Media",   module:"Tecnología", hint:"Mano en 'Y' en la oreja." },
  { name:"COMPUTADORA", difficulty:"Media",   module:"Tecnología", hint:"Dedos sobre teclado imaginario." },
  { name:"INSTAGRAM",   difficulty:"Difícil", module:"Tecnología", hint:"Seña compuesta." },
  { name:"YOUTUBE",     difficulty:"Difícil", module:"Tecnología", hint:"Seña compuesta." },
];

const learningMoments = [
  { label: "Memoria visual", value: "Alta", detail: "Reconoces patrones de mano con buena precisión." },
  { label: "Ritmo", value: "12 días", detail: "Tu constancia desbloquea práctica avanzada." },
  { label: "Siguiente foco", value: "Familia", detail: "Practica parentescos antes de pasar a comida." }
];

const dailyQuest = [
  { task: "Completa 3 señas de Familia", done: true },
  { task: "Repite una seña difícil", done: true },
  { task: "Graba una práctica corta", done: false }
];

const accountActions = [
  { label: "Mi perfil", helper: "Datos y preferencias", icon: "user", path: "/dashboard" },
  { label: "Progreso", helper: "Racha y módulos", icon: "trophy", path: "/learn" },
  { label: "Práctica", helper: "Abrir cámara", icon: "camera", path: "/practice" },
  { label: "Cerrar sesión", helper: "Volver al acceso", icon: "lock", path: "/" }
];

const LOGO_SRC = "/logo-senas-a-voces-crop.png";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [state, setState] = useState(null);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to, options = {}) => {
    window.history.pushState(options.state || {}, "", to);
    setPath(to);
    setState(options.state || null);
  }, []);

  return [path, navigate, state];
}

function Icon({ name, className = "h-5 w-5" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className };
  const filled = { viewBox: "0 0 20 20", fill: "currentColor", className };
  const icons = {
    moon: <svg {...filled}><path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8 8 0 1 0 10.586 10.586z" /></svg>,
    sun: <svg {...common} viewBox="-2 -2 28 28"><circle cx="12" cy="12" r="4" /><path d="M12 1v3" /><path d="M12 20v3" /><path d="M4.22 4.22 6.34 6.34" /><path d="m17.66 17.66 2.12 2.12" /><path d="M1 12h3" /><path d="M20 12h3" /><path d="m4.22 19.78 2.12-2.12" /><path d="m17.66 6.34 2.12-2.12" /></svg>,
    mail: <svg {...filled}><path d="M3 4a2 2 0 0 0-2 2v1.16l8.44 4.22a1.25 1.25 0 0 0 1.12 0L19 7.16V6a2 2 0 0 0-2-2H3Z" /><path d="m19 8.84-7.77 3.88a2.75 2.75 0 0 1-2.46 0L1 8.84V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.84Z" /></svg>,
    lock: <svg {...filled}><path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" /></svg>,
    user: <svg {...filled}><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493A7.002 7.002 0 0 1 16.54 14.49c.196.507.022 1.077-.408 1.41A9.957 9.957 0 0 1 10 18a9.957 9.957 0 0 1-6.125-2.095 1.23 1.23 0 0 1-.41-1.412Z" /></svg>,
    eye: <svg {...filled}><path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" /></svg>,
    play: <svg {...common}><polygon points="5 3 19 12 5 21 5 3" /></svg>,
    camera: <svg {...common}><path d="m23 7-7 5 7 5V7Z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>,
    book: <svg {...common}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>,
    refresh: <svg {...common}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>,
    check: <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>,
    arrow: <svg {...filled}><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" /></svg>,
    flame: <svg {...common}><path fill="currentColor" fillOpacity="0.26" d="M8.5 14.5A4.5 4.5 0 0 0 13 19a5 5 0 0 0 5-5c0-3.5-2.5-5.8-5.4-8.7-.5 2.9-2 4.3-4.1 5.7C7 12 6 13.2 6 15a5 5 0 0 0 10 0c0-1.2-.4-2.2-1.1-3.1-.2 2.2-1.4 3.6-3 3.6-1.2 0-2.3-.7-3.4-1Z" /><path d="M8.5 14.5A4.5 4.5 0 0 0 13 19a5 5 0 0 0 5-5c0-3.5-2.5-5.8-5.4-8.7-.5 2.9-2 4.3-4.1 5.7C7 12 6 13.2 6 15a5 5 0 0 0 10 0c0-1.2-.4-2.2-1.1-3.1-.2 2.2-1.4 3.6-3 3.6-1.2 0-2.3-.7-3.4-1Z" /></svg>,
    sparkles: <svg {...common}><path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9L12 3Z" /><path d="m19 14 .7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14Z" /><path d="m5 13 .7 2.1L8 16l-2.3.9L5 19l-.7-2.1L2 16l2.3-.9L5 13Z" /></svg>,
    trophy: <svg {...common}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M5 5H3v2a4 4 0 0 0 4 4" /><path d="M19 5h2v2a4 4 0 0 1-4 4" /></svg>,
    x: <svg {...filled}><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" /></svg>,
    // Iconos específicos para módulos
    abc: <svg {...common} viewBox="0 0 24 24"><text x="12" y="17" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">Aa</text></svg>,
    numbers: <svg {...common} viewBox="0 0 24 24"><text x="12" y="17" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor">123</text></svg>,
    expressions: <svg {...common}><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><path d="M8 14c1 2 3 3 4 3s3-1 4-3" strokeLinecap="round" /></svg>,
    colors: <svg {...common}><circle cx="8" cy="10" r="4" fill="currentColor" fillOpacity="0.5"/><circle cx="16" cy="10" r="4" fill="currentColor" fillOpacity="0.8"/><circle cx="12" cy="16" r="4" fill="currentColor" /></svg>,
    family: <svg {...common}><circle cx="7" cy="7" r="2.5" fill="currentColor"/><circle cx="17" cy="7" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.7"/><path d="M7 11v8M17 11v8M12 16v3" strokeLinecap="round" /></svg>,
    health: <svg {...common}><path d="M9 2v6H3v8h6v6h6v-6h6V8h-6V2H9z" fill="currentColor" fillOpacity="0.85" /><path d="M9 2v6H3v8h6v6h6v-6h6V8h-6V2H9z" /></svg>,
    education: <svg {...common}><path d="M3 9l9-4 9 4-9 4-9-4z" fill="currentColor" fillOpacity="0.2" /><path d="M3 9l9-4 9 4-9 4-9-4z" /><path d="M7 11v5c0 1 2 2 5 2s5-1 5-2v-5" /><path d="M21 9v5" strokeLinecap="round" /></svg>,
    technology: <svg {...common}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M2 17h20M9 21h6M12 17v4" strokeLinecap="round" /></svg>,
    // Iconos específicos para señas individuales
    "number-1": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">1</text></svg>,
    "number-2": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">2</text></svg>,
    "number-3": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">3</text></svg>,
    "number-4": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">4</text></svg>,
    "number-5": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">5</text></svg>,
    "number-6": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">6</text></svg>,
    "number-7": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">7</text></svg>,
    "number-8": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">8</text></svg>,
    "number-9": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="bold" fill="currentColor">9</text></svg>,
    "number-10": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">10</text></svg>,
    "number-20": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">20</text></svg>,
    "number-100": <svg {...common}><text x="12" y="17" textAnchor="middle" fontSize="12" fontWeight="bold" fill="currentColor">100</text></svg>,
    "sorry": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "please": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>,
    "how-are-you": <svg {...common}><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><path d="M12 14c-1.5 0-2.8.8-3.5 2h7c-.7-1.2-2-2-3.5-2z" /></svg>,
    "what-name": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2 15h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z" /></svg>,
    "surprise": <svg {...common}><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><path d="M12 14c-2 0-3.7 1.3-4.5 3h9c-.8-1.7-2.5-3-4.5-3z" /></svg>,
    "miracle": <svg {...common}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>,
    "red": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>,
    "blue": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.7"/></svg>,
    "green": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.5"/></svg>,
    "yellow": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.9"/></svg>,
    "white": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.3"/></svg>,
    "black": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>,
    "orange": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.8"/></svg>,
    "purple": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.6"/></svg>,
    "pink": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.7"/></svg>,
    "brown": <svg {...common}><circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.5"/></svg>,
    "mom": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "dad": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2 15h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z" /></svg>,
    "brother": <svg {...common}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>,
    "grandpa": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "grandma": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "uncle": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "spouse": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "doctor": <svg {...common}><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z" /></svg>,
    "hospital": <svg {...common}><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z" /></svg>,
    "medicine": <svg {...common}><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>,
    "disease": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>,
    "emergency": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>,
    "internet": <svg {...common}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>,
    "phone": <svg {...common}><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>,
    "computer": <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M6 17h12M12 17v4" /></svg>,
    "instagram": <svg {...common}><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="3" /><circle cx="18" cy="6" r="1" /></svg>,
    "youtube": <svg {...common}><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" /><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" /></svg>
  };
  return icons[name] || icons.play;
}

function Logo({ isDark, compact = false }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Señas a Voces Academy"
      className={cx("h-auto object-contain", compact ? "w-40 sm:w-48 md:w-56" : "w-56 sm:w-72", isDark && "logo-on-dark")}
    />
  );
}

function ThemeToggle({ isDark, setIsDark }) {
  return (
    <button onClick={() => setIsDark(!isDark)} className={cx("btn-press rounded-xl p-2", isDark ? "text-brand-orange hover:bg-brand-card" : "text-brand-teal hover:bg-white")} aria-label="Cambiar tema">
      <Icon name={isDark ? "sun" : "moon"} />
    </button>
  );
}

function FontSizeSelector({ fontScale, setFontScale, isDark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const options = [
    { key: 'sm', label: 'A', size: 'text-xs', desc: 'Pequeño' },
    { key: 'md', label: 'A', size: 'text-sm', desc: 'Mediano' },
    { key: 'lg', label: 'A', size: 'text-base', desc: 'Grande' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cx(
          "btn-press flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-200 active:scale-95",
          isDark ? "bg-brand-card text-brand-cyan hover:bg-brand-card/80" : "bg-brand-cream text-brand-teal hover:bg-brand-cream/80"
        )}
        aria-label="Tamaño de texto"
        title="Tamaño de texto"
      >
        Aa
      </button>
      {open && (
        <div className={cx("absolute right-0 top-12 z-[200] w-44 rounded-2xl border p-2 shadow-lg", isDark ? "border-brand-line bg-brand-card" : "border-[#E8E4D8] bg-white")}>
          <div className={cx("mb-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-[#607274]")}>
            Tamaño de texto
          </div>
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => { setFontScale?.(opt.key); setOpen(false); }}
              className={cx(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors",
                fontScale === opt.key
                  ? (isDark ? "bg-brand-deep text-white" : "bg-brand-cream text-brand-ink")
                  : (isDark ? "text-brand-soft hover:bg-brand-deep/50" : "text-brand-muted hover:bg-brand-cream/50")
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cx("font-bold", opt.size)}>{opt.label}</span>
                <span className="text-xs font-semibold">{opt.desc}</span>
              </span>
              {fontScale === opt.key && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FontSizeInline({ fontScale, setFontScale, isDark }) {
  const options = [
    { key: 'sm', label: 'A', size: 'text-xs', desc: 'Pequeño' },
    { key: 'md', label: 'A', size: 'text-sm', desc: 'Mediano' },
    { key: 'lg', label: 'A', size: 'text-base', desc: 'Grande' },
  ];

  return (
    <div className="w-full">
      <div className={cx("mb-2 text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-brand-muted")}>
        Tamaño de texto
      </div>
      <div className="flex gap-2">
        {options.map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFontScale?.(opt.key)}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 transition-colors",
              fontScale === opt.key
                ? (isDark ? "bg-brand-cyan text-brand-deep" : "bg-brand-teal text-white")
                : (isDark ? "bg-brand-card text-brand-soft" : "bg-white text-brand-muted border border-[#E8E4D8]")
            )}
          >
            <span className={cx("font-bold", opt.size)}>{opt.label}</span>
            <span className="text-[10px] font-semibold">{opt.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AppHeader({ isDark, setIsDark, navigate, path, fontScale = 'md', setFontScale }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef(null);
  const mobileNavRef = useRef(null);
  const { profile, signOut } = useAuth();

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeFromOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  const selectAccountAction = (to) => {
    if (to === "/") {
      signOut();
    } else {
      navigate(to);
    }
    setMenuOpen(false);
  };

  const userInitials = profile?.avatar_initials || profile?.full_name?.substring(0, 2).toUpperCase() || "US";
  const userName = profile?.full_name || "Usuario";
  const userEmail = profile?.email || "";

  return (
    <header className={cx("sticky top-0 z-[100] transition-colors backdrop-blur-xl border-b", isDark ? "bg-brand-deep border-brand-line" : "bg-white border-[#E8E4D8]")}>
      <div className="mx-auto px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate("/dashboard")} className="btn-press flex items-center gap-3">
            <Logo isDark={isDark} compact />
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.slice(1).map((item, index) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cx(
                  "group relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all duration-200 active:scale-95",
                  path === item.path
                    ? (isDark ? "bg-brand-cyan text-brand-deep" : "bg-brand-teal text-white")
                    : (isDark ? "text-brand-soft hover:bg-brand-card/50" : "text-brand-muted hover:bg-brand-cream/50")
                )}
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>

            <div className="flex items-center gap-3">
              {/* Mobile Navigation Button - Toggle */}
              <button 
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                className={cx("md:hidden btn-press relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 active:scale-95", isDark ? "bg-brand-orange text-white" : "bg-brand-orange text-white")}
                aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"}
              >
                {mobileNavOpen ? (
                  <Icon name="x" className="h-5 w-5" />
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>

              {/* Desktop Actions */}
              <div className="hidden items-center gap-3 md:flex">
                <FontSizeSelector fontScale={fontScale} setFontScale={setFontScale} isDark={isDark} />
                <ThemeToggle isDark={isDark} setIsDark={setIsDark} />
                <div ref={menuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    className={cx(
                      "profile-trigger btn-press relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-200 active:scale-95",
                      isDark ? "bg-brand-cyan text-brand-deep hover:bg-brand-cyan/80" : "bg-brand-teal text-white hover:bg-brand-teal/80"
                    )}
                  >
                    {userInitials}
                    {menuOpen && (
                      <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-brand-orange" />
                    )}
                  </button>
                  {menuOpen && (
                    <div className={cx("account-menu", isDark ? "account-menu-dark" : "account-menu-light")} role="menu">
                      <div className="account-menu-head">
                        <span className={cx("flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal text-white")}>{userInitials}</span>
                        <span>
                          <strong className={cx("block text-sm", isDark ? "text-white" : "text-brand-ink")}>{userName}</strong>
                          <small className={cx("block text-xs", isDark ? "text-brand-soft" : "text-brand-muted")}>{userEmail}</small>
                        </span>
                      </div>
                      <div className="mt-2">
                        {accountActions.map((action) => (
                          <button key={action.label} type="button" role="menuitem" className="account-menu-item text-left" onClick={() => selectAccountAction(action.path)}>
                            <span className={cx("account-menu-icon", isDark ? "text-brand-cyan" : "text-brand-teal")}><Icon name={action.icon} className="h-4 w-4" /></span>
                            <span>
                              <strong className={cx("block text-xs", isDark ? "text-white" : "text-brand-ink")}>{action.label}</strong>
                              <small className={cx("block text-[10px]", isDark ? "text-brand-soft" : "text-brand-muted")}>{action.helper}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* Mobile Navigation Drawer — rendered via portal to escape header stacking context */}
      {mobileNavOpen && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-black/50 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={mobileNavRef}
            className={cx(
              "fixed right-0 top-0 z-[9999] flex h-full w-[280px] max-w-[85vw] flex-col md:hidden",
              isDark ? "bg-brand-deep" : "bg-white"
            )}
            style={{
              boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
              animation: 'slideInRight 200ms ease-out'
            }}
          >
            <div className={cx("flex shrink-0 items-center justify-between px-5 py-4 border-b", isDark ? "border-brand-line" : "border-[#E8E4D8]")}>
              <span className={cx("text-sm font-bold", isDark ? "text-white" : "text-[#1A2E3B]")}>Menú</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                className={cx("flex h-8 w-8 items-center justify-center rounded-lg transition-colors", isDark ? "bg-brand-card text-white hover:bg-brand-card/80" : "bg-[#F4EFE6] text-[#1A2E3B] hover:bg-[#E8E4D8]")}
                aria-label="Cerrar"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <span className={cx("mb-2 block text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-[#607274]")}>
                Navegación
              </span>
              <div className="mb-6 space-y-1">
                {navItems.slice(1).map((item) => {
                  const active = path === item.path;
                  return (
                    <button
                      key={item.path}
                      onClick={() => { navigate(item.path); setMobileNavOpen(false); }}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition-colors",
                        active
                          ? (isDark ? "bg-brand-cyan text-brand-deep" : "bg-brand-teal text-white")
                          : (isDark ? "text-brand-soft hover:bg-brand-card" : "text-[#1A2E3B] hover:bg-[#F4EFE6]")
                      )}
                    >
                      <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <span className={cx("mb-2 block text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-[#607274]")}>
                Ajustes
              </span>

              <div className="mb-3">
                <button
                  onClick={() => setIsDark(!isDark)}
                  className={cx(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
                    isDark ? "bg-brand-card text-white hover:bg-brand-card/80" : "bg-[#F4EFE6] text-[#1A2E3B] hover:bg-[#E8E4D8]"
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isDark ? "🌙" : "☀️"}
                    <span>{isDark ? "Modo oscuro" : "Modo claro"}</span>
                  </span>
                  <span className="text-[10px] font-bold uppercase text-brand-orange">
                    {isDark ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              <div className="mb-6">
                <FontSizeInline fontScale={fontScale} setFontScale={setFontScale} isDark={isDark} />
              </div>
            </div>

            <div className={cx("shrink-0 border-t px-5 py-4", isDark ? "border-brand-line" : "border-[#E8E4D8]")}>
              <div className="mb-3 flex items-center gap-3">
                <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold", isDark ? "bg-brand-cyan text-brand-deep" : "bg-brand-teal text-white")}>{userInitials}</span>
                <div className="min-w-0 flex-1">
                  <p className={cx("truncate text-xs font-bold", isDark ? "text-white" : "text-[#1A2E3B]")}>{userName}</p>
                  <p className={cx("truncate text-[10px]", isDark ? "text-brand-soft" : "text-[#607274]")}>{userEmail}</p>
                </div>
              </div>
              <button
                onClick={() => { signOut(); setMobileNavOpen(false); }}
                className="btn-press w-full rounded-lg bg-brand-orange px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-orange/90"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </header>
  );
}

function WaveBackground({ isDark }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className={cx("animate-wave-drift absolute -left-20 -top-20 h-[400px] w-[600px]", isDark ? "text-brand-card" : "text-brand-teal")} viewBox="0 0 600 400" fill="currentColor" opacity="0.06">
        <path d="M0 200C100 100 200 300 300 200C400 100 500 300 600 200V0H0V200Z" />
      </svg>
      <svg className={cx("animate-wave-drift absolute -bottom-16 -right-16 h-[350px] w-[500px]", isDark ? "text-brand-cyan" : "text-brand-orange")} viewBox="0 0 500 350" fill="currentColor" opacity="0.05" style={{ animationDelay: "2s" }}>
        <path d="M0 150C80 50 160 250 240 150C320 50 400 250 500 150V350H0V150Z" />
      </svg>
    </div>
  );
}


function Card({ isDark, className = "", children }) {
  return (
    <div className={cx(
      "surface-card flex flex-col overflow-hidden rounded-3xl transition-all duration-300",
      isDark 
        ? "border border-brand-line/50 bg-brand-card shadow-sm" 
        : "border border-gray-200/50 bg-white shadow-sm",
      className
    )}>
      <div className={cx("flex flex-1 flex-col p-6 sm:p-8", isDark ? "relative" : "relative")}>
        {children}
      </div>
    </div>
  );
}

function LearningPulse({ isDark }) {
  return (
    <Card isDark={isDark} className="mb-6 opacity-90">
      <div className="relative">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-6">
          <div className="flex-1">
            <div className="mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
                — Brújula de aprendizaje
              </span>
            </div>
            <h2 className="font-display text-xl font-extrabold sm:text-2xl text-[#1A2E3B]">
              Hoy conviene practicar <span className="text-[#D97736]">Familia</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#607274]">
              Tu ruta detecta buena memoria visual. Mantén sesiones cortas y repite las señas que mezclan parentesco y saludo.
            </p>
          </div>
          <div className={cx(
            "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex",
            isDark ? "bg-brand-cyan/10 text-brand-cyan" : "bg-[#D97736]/5 text-[#D97736]"
          )}>
            <Icon name="sparkles" className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {learningMoments.map((item, index) => (
            <div
              key={item.label}
              className={cx(
                "group relative overflow-hidden rounded-xl border p-3 transition-all duration-200",
                isDark
                  ? "border-brand-line/20 bg-transparent hover:border-brand-cyan/30"
                  : "border-[#E8E4D8] bg-transparent hover:border-[#8C4A27]/30"
              )}
            >
              <div className="relative">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#607274]">
                  {item.label}
                </span>
                <strong className={cx("mt-1 block text-base font-extrabold sm:text-lg", isDark ? "text-white" : "text-[#1A2E3B]")}>
                  {item.value}
                </strong>
                <p className={cx("mt-1 text-xs leading-relaxed", isDark ? "text-brand-soft" : "text-[#607274]")}>
                  {item.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function QuestList({ isDark, quests }) {
  const completedCount = quests.filter(q => q.done).length;
  const totalCount = quests.length;
  const questPct = totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0;

  return (
    <Card isDark={isDark} className="h-full w-full">
      <div className="flex h-full flex-col">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
              — Reto de hoy
            </span>
            <h3 className={cx("font-display mt-1.5 text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")}>Misiones diarias</h3>
          </div>
          <div className={cx("rounded-lg px-2.5 py-1 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-[#D97736]/10 text-[#D97736]")}>
            {completedCount}/{totalCount}
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {quests.map((quest, index) => (
            <div 
              key={quest.task} 
              className={cx(
                "group flex items-center gap-4 rounded-2xl p-4 transition-all duration-300",
                quest.done 
                  ? (isDark ? "bg-brand-deep/30 opacity-70" : "bg-gray-100 opacity-70") 
                  : (isDark ? "bg-brand-deep/50 hover:bg-brand-deep/70" : "bg-gray-50 hover:bg-gray-100")
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className={cx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                quest.done 
                  ? "bg-brand-teal text-white" 
                  : (isDark ? "border-2 border-brand-line text-brand-soft" : "border-2 border-gray-300 text-gray-600")
              )}>
                <Icon name={quest.done ? "check" : quest.icon || "sparkles"} className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cx(
                  "text-sm font-semibold transition-all duration-300",
                  quest.done 
                    ? (isDark ? "text-brand-soft line-through" : "text-gray-500 line-through") 
                    : (isDark ? "text-white" : "text-gray-900")
                )}>
                  {quest.task}
                </p>
                {quest.progress != null && !quest.done && (
                  <p className={cx("mt-0.5 text-[11px] font-medium", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>
                    {quest.progress}
                  </p>
                )}
              </div>
              {!quest.done && (
                <span className={cx(
                  "h-2 w-2 shrink-0 rounded-full animate-pulse",
                  isDark ? "bg-brand-orange" : "bg-brand-teal"
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Footer summary — fills remaining height */}
        <div className="mt-5 border-t pt-4" style={{ borderColor: isDark ? "#1A5C6A" : "#E8E4D8" }}>
          <div className="flex items-center justify-between">
            <span className={cx("text-xs font-medium", isDark ? "text-brand-soft" : "text-[#607274]")}>Progreso del día</span>
            <span className={cx("font-display text-sm font-extrabold", isDark ? "text-brand-cyan" : "text-[#D97736]")} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {questPct}%
            </span>
          </div>
          <div className={cx("mt-2 h-1.5 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#F4EFE6]")}>
            <div className="h-full rounded-full bg-[#D97736] transition-all duration-700" style={{ width: `${questPct}%` }} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function PageTitle({ isDark, title, accent, subtitle }) {
  const parts = title.split(accent);
  return (
    <div className="animate-fade mb-8">
      <h1 className={cx("font-display text-2xl font-extrabold md:text-3xl lg:text-4xl", isDark ? "text-white" : "text-brand-ink")} role="heading" aria-level="1">
        {parts[0]}<span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>{accent}</span>{parts[1]}
      </h1>
      <p className={cx("mt-2 text-sm md:text-base", isDark ? "text-brand-soft" : "text-brand-muted")} role="doc-subtitle">
        {subtitle}
      </p>
    </div>
  );
}

function SectionLabel({ isDark, children }) {
  return <h3 className={cx("text-sm font-bold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-brand-muted")}>{children}</h3>;
}

function ProgressCard({ isDark, currentLevel, currentLesson, totalSignsLearned, totalPracticeTime, averageAccuracy, moduleProgressPercent, practiceDays }) {
  const stats = [
    [totalSignsLearned, "Señas aprendidas", "sparkles"],
    [`${totalPracticeTime} min`, "Tiempo total", "clock"],
    [`${Math.min(100, Math.round((averageAccuracy || 0) * 100))}%`, "Precisión", "trophy"],
    [practiceDays, "Días practicados", "flame"]
  ];
  
  return (
    <Card isDark={isDark}>
      <div className="mb-6 flex items-center justify-between">
        <div className="mb-6">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
            — Progreso actual
          </span>
        </div>
        <div className={cx("px-3 py-1.5 text-xs font-bold", isDark ? "text-brand-cyan" : "text-[#D97736]")}>
          Nivel {currentLevel}
        </div>
      </div>
      
      <div className="mb-6">
        <h3 className={cx("font-display text-2xl font-extrabold sm:text-3xl", isDark ? "text-white" : "text-gray-900")}>
          Lección {currentLesson}
        </h3>
        <p className={cx("mt-1 text-sm font-medium", isDark ? "text-brand-soft" : "text-gray-600")}>
          Progreso del módulo
        </p>
      </div>
      
      {/* Simplified Progress Bar */}
      <div className="mb-8">
        <div className={cx("relative h-3 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-gray-200")}>
          <div 
            className={cx(
              "absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out",
              "bg-brand-teal"
            )}
            style={{ width: `${moduleProgressPercent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between">
          <span className={cx("text-xs font-medium", isDark ? "text-brand-soft" : "text-gray-600")}>
            {moduleProgressPercent}% completado
          </span>
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 border-t border-dashed pt-6 sm:grid-cols-4" style={{ borderColor: isDark ? "#1A5C6A" : "#E8EEEF" }}>
        {stats.map(([value, label, icon], index) => (
          <div 
            key={label} 
            className="text-center transition-all duration-300 hover:scale-105"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className={cx("flex items-center justify-center gap-1 mb-1", isDark ? "text-brand-cyan" : "text-brand-teal")}>
              <Icon name={icon} className="h-3 w-3" />
            </div>
            <div className={cx("text-xl font-extrabold sm:text-2xl", isDark ? "text-white" : "text-gray-900")}>
              {value}
            </div>
            <div className={cx("mt-1 text-[10px] font-medium uppercase tracking-wider", isDark ? "text-[#5A8A94]" : "text-gray-600")}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BarRow({ label, value, isDark }) {
  return <div className="flex items-center gap-3"><span className={cx("w-8 text-xs font-semibold", isDark ? "text-brand-soft" : "text-[#607274]")}>{label}</span><div className={cx("h-2 flex-1 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#F4EFE6]")}><div className={cx("h-full rounded-full", isDark ? "bg-brand-teal" : "bg-[#D97736]")} style={{ width: `${Math.min(100, (value / 60) * 100)}%` }} /></div><span className={cx("w-10 text-right text-xs font-medium", isDark ? "text-[#5A8A94]" : "text-[#607274]")}>{value ? `${value}m` : "-"}</span></div>;
}

function QuickAction({ isDark, icon, title, desc, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "btn-press group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all duration-200",
        isDark
          ? "border-brand-line/30 bg-transparent hover:border-brand-cyan/50"
          : "border-[#E8E4D8] bg-transparent hover:border-[#8C4A27]/50"
      )}
    >
      <div className={cx(
        "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
        accent
          ? "bg-[#8C4A27]/10 text-[#8C4A27]"
          : isDark
            ? "bg-brand-teal/10 text-brand-cyan"
            : "bg-[#D97736]/10 text-[#D97736]"
      )}>
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <span className={cx("block text-sm font-semibold", isDark ? "text-white" : "text-[#1A2E3B]")}>{title}</span>
        <span className={cx("block text-xs mt-0.5", isDark ? "text-[#5A8A94]" : "text-[#607274]")}>{desc}</span>
      </div>
      <div className={cx(
        "flex h-6 w-6 items-center justify-center rounded transition-all duration-200 opacity-0 group-hover:opacity-100",
        isDark ? "text-brand-cyan" : "text-[#8C4A27]"
      )}>
        <Icon name="arrow" className="h-4 w-4" />
      </div>
    </button>
  );
}

/* ===== Activity Heatmap (Anki / Migaku Academy style) ===== */
function ActivityHeatmap({ history, isDark }) {
  // history: [{ date: 'YYYY-MM-DD', count, accuracy }]
  const DAYS = 140; // ~20 weeks
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build a map date -> entry for O(1) lookup
  const map = new Map();
  for (const h of history || []) map.set(h.date, h);

  // Find max count to scale levels (1..4)
  const maxCount = Math.max(1, ...(history || []).map((h) => h.count));

  // Generate the last DAYS days, oldest first
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = map.get(key);
    days.push({ date: key, dow: d.getDay(), count: entry?.count || 0, accuracy: entry?.accuracy || 0 });
  }

  // Align to week columns: pad the start so the first day lands on its weekday row
  const firstDow = days[0].dow;
  const padded = [...Array(firstDow).fill(null), ...days];
  const numWeeks = Math.ceil(padded.length / 7);

  const levelFor = (count) => {
    if (count <= 0) return 0;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  };

  const activeDays = (history || []).filter((h) => h.count > 0).length;
  const totalSessions = (history || []).reduce((s, h) => s + h.count, 0);

  // Month labels: one per week column where the month starts
  const monthLabels = (() => {
    const labels = [];
    let lastMonth = -1;
    for (let i = 0; i < days.length; i++) {
      const m = new Date(days[i].date).getMonth();
      if (m !== lastMonth && new Date(days[i].date).getDate() <= 7) {
        labels.push({ colIndex: Math.floor((i + firstDow) / 7), label: new Date(days[i].date).toLocaleDateString('es-MX', { month: 'short' }) });
        lastMonth = m;
      }
    }
    return labels;
  })();

  return (
    <Card isDark={isDark}>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">— Actividad</span>
          <h3 className={cx("font-display mt-1.5 text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")}>
            {activeDays} días activos · {totalSessions} sesiones
          </h3>
        </div>
      </div>

      {/* Month labels row — aligned to week columns */}
      <div
        className="mb-1 grid gap-[3px] text-[10px] font-medium text-[#607274]"
        style={{ gridTemplateColumns: `repeat(${numWeeks}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: numWeeks }, (_, weekIdx) => {
          const label = monthLabels.find((m) => m.colIndex === weekIdx);
          return <span key={weekIdx} className="truncate">{label ? label.label : ''}</span>;
        })}
      </div>

      {/* Heatmap grid — fills full card width */}
      <div
        className="heatmap"
        style={{ gridTemplateColumns: `repeat(${numWeeks}, minmax(0, 1fr))` }}
      >
        {padded.map((d, i) =>
          d === null ? (
            <div key={`pad-${i}`} className="heatmap-cell" style={{ visibility: 'hidden' }} />
          ) : (
            <div
              key={d.date}
              className="heatmap-cell"
              data-level={levelFor(d.count)}
              title={`${d.date}${d.count > 0 ? ` · ${d.count} sesiones${d.accuracy > 0 ? ` · ${Math.round(d.accuracy * 100)}% precisión` : ''}` : ''}`}
            />
          )
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className={cx("text-[11px]", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Hace 20 semanas</span>
        <div className="heatmap-legend">
          <span className={cx("mr-1 text-[10px]", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Menos</span>
          <span className="heatmap-cell" data-level="0" />
          <span className="heatmap-cell" data-level="1" />
          <span className="heatmap-cell" data-level="2" />
          <span className="heatmap-cell" data-level="3" />
          <span className="heatmap-cell" data-level="4" />
          <span className={cx("ml-1 text-[10px]", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Más</span>
        </div>
        <span className={cx("text-[11px]", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Hoy</span>
      </div>
    </Card>
  );
}

/* ===== Streak flame (Duolingo-style) ===== */
function StreakFlame({ days, isDark }) {
  const count = Number(days) || 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="streak-flame">
        <svg width="44" height="52" viewBox="0 0 44 52" fill="none" aria-hidden="true">
          <path
            d="M22 2C22 2 8 14 8 30c0 11 6.5 20 14 20s14-9 14-20c0-6-3-11-3-11s-1 4-3 4c-2 0-2-4-2-7 0-7-6-14-6-14z"
            fill="url(#flameGrad)"
          />
          <defs>
            <linearGradient id="flameGrad" x1="22" y1="2" x2="22" y2="50" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFD15C" />
              <stop offset="0.5" stopColor="#EC9960" />
              <stop offset="1" stopColor="#D96B6B" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <span className={cx("font-display text-2xl font-extrabold leading-none", isDark ? "text-white" : "text-[#1A2E3B]")} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </span>
      <span className={cx("text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>
        Racha
      </span>
    </div>
  );
}

/* ===== Progress ring (circular, Duolingo-style) ===== */
function ProgressRing({ percent, label, value, isDark, size = 120, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="progress-ring" style={{ '--ring-size': `${size}px`, '--ring-stroke': `${stroke}px` }}>
      <svg className="progress-ring__svg" viewBox={`0 0 ${size} ${size}`}>
        <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={r} />
        <circle
          className="progress-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="progress-ring__center">
        <span className={cx("font-display text-2xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        <span className={cx("mt-1 text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>
          {label}
        </span>
      </div>
    </div>
  );
}

/* ===== Stat tile (Duolingo-style big number) ===== */
function StatTile({ icon, value, label, color, isDark }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__icon" style={{ background: `${color}1A`, color }}>
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div className={cx("stat-tile__value", isDark ? "text-white" : "text-[#1A2E3B]")}>{value}</div>
      <div className="stat-tile__label">{label}</div>
    </div>
  );
}

function DashboardPage({ isDark, navigate }) {
  const { profile, userProgress, moduleProgress, practiceHistory } = useAuth();

  // Real stats from Supabase
  const completedSigns = moduleProgress?.reduce((sum, mp) => sum + (mp.signs_completed || 0), 0) || 0;
  const totalSigns = modules.reduce((sum, m) => sum + m.signs, 0);
  const progressPct = totalSigns > 0 ? Math.min(100, Math.round((completedSigns / totalSigns) * 100)) : 0;
  const streakDays = userProgress?.streak_days || 0;
  const practiceTime = userProgress?.total_practice_time || 0;
  const averageAccuracy = userProgress?.average_accuracy || 0;
  const totalSignsLearned = userProgress?.total_signs_learned || completedSigns;
  const practiceDays = userProgress?.practice_days || 0;
  const currentLevel = userProgress?.current_level || 1;
  const currentLesson = userProgress?.current_lesson || 1;
  // Has the user actually practiced? If not, accuracy is meaningless
  const hasPracticed = (practiceHistory || []).some((h) => h.count > 0) || practiceTime > 0 || completedSigns > 0;

  // Daily goal: 10 signs per day. Today's count from practiceHistory.
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const todayCount = (practiceHistory || []).find((h) => h.date === todayKey)?.count || 0;
  const dailyGoal = 10;
  const dailyPct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));

  const accuracyPct = Math.min(100, Math.round((averageAccuracy || 0) * 100));
  const accuracyDisplay = hasPracticed ? `${accuracyPct}%` : '—';

  // Time spent in the last 7 days (from practiceHistory, timeSpent in seconds)
  const last7DaysSeconds = (practiceHistory || [])
    .filter((h) => {
      const d = new Date(h.date);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return d >= sevenDaysAgo;
    })
    .reduce((sum, h) => sum + (h.timeSpent || 0), 0);
  const last7DaysHours = last7DaysSeconds > 0
    ? `${(last7DaysSeconds / 3600).toFixed(1)}h`
    : '0h';

  // Dynamic daily quests based on real user data
  const quests = [
    {
      task: `Practica ${dailyGoal} señas hoy`,
      icon: "sparkles",
      done: todayCount >= dailyGoal,
      progress: todayCount > 0 && todayCount < dailyGoal ? `${todayCount}/${dailyGoal} completadas` : undefined,
    },
    {
      task: "Mantén tu racha activa",
      icon: "flame",
      done: streakDays > 0,
      progress: streakDays === 0 ? "Practica para empezar tu racha" : `${streakDays} día${streakDays !== 1 ? 's' : ''} consecutivo${streakDays !== 1 ? 's' : ''}`,
    },
    {
      task: "Completa un módulo",
      icon: "book",
      done: (moduleProgress || []).some(mp => mp.status === 'completed'),
      progress: (() => {
        const completed = (moduleProgress || []).filter(mp => mp.status === 'completed').length;
        const total = modules.length;
        return completed > 0 ? `${completed}/${total} módulos completados` : `${completed}/${total} módulos completados`;
      })(),
    },
    {
      task: "Alcanza 70% de precisión",
      icon: "trophy",
      done: hasPracticed && accuracyPct >= 70,
      progress: !hasPracticed ? "Practica para medir tu precisión" : accuracyPct < 70 ? `Actual: ${accuracyPct}%` : undefined,
    },
    {
      task: "Practica 10 minutos",
      icon: "clock",
      done: practiceTime >= 10,
      progress: practiceTime < 10 ? `${practiceTime}/10 min` : undefined,
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Welcome + compact stats inline */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold sm:text-4xl text-[#1A2E3B]">
            Hola, <span className="text-[#D97736]">{profile?.full_name || "Usuario"}</span>
          </h1>
          <p className="mt-1 text-sm text-[#607274]">
            Continúa tu aprendizaje de lengua de señas mexicana
          </p>
        </div>
        {/* Prominent stat pills */}
        <div className="flex flex-wrap gap-3">
          <div className={cx("flex items-center gap-2.5 rounded-xl px-4 py-2.5", isDark ? "bg-brand-card" : "bg-white border border-[#E8E4D8]")}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EC9960]/15 text-[#EC9960]">
              <Icon name="flame" className="h-5 w-5" />
            </div>
            <div className="flex flex-col leading-none">
              <span className={cx("font-display text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")} style={{ fontVariantNumeric: 'tabular-nums' }}>{streakDays}</span>
              <span className={cx("text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Racha</span>
            </div>
          </div>
          <div className={cx("flex items-center gap-2.5 rounded-xl px-4 py-2.5", isDark ? "bg-brand-card" : "bg-white border border-[#E8E4D8]")}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D97736]/15 text-[#D97736]">
              <Icon name="sparkles" className="h-5 w-5" />
            </div>
            <div className="flex flex-col leading-none">
              <span className={cx("font-display text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")} style={{ fontVariantNumeric: 'tabular-nums' }}>{totalSignsLearned}</span>
              <span className={cx("text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Señas</span>
            </div>
          </div>
          <div className={cx("flex items-center gap-2.5 rounded-xl px-4 py-2.5", isDark ? "bg-brand-card" : "bg-white border border-[#E8E4D8]")}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#8C4A27]/15 text-[#8C4A27]">
              <Icon name="trophy" className="h-5 w-5" />
            </div>
            <div className="flex flex-col leading-none">
              <span className={cx("font-display text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")} style={{ fontVariantNumeric: 'tabular-nums' }}>{accuracyDisplay}</span>
              <span className={cx("text-[10px] font-semibold uppercase tracking-wider", isDark ? "text-[#8AACB4]" : "text-[#607274]")}>Precisión</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Learning Actions — PRIORITY: right below welcome */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => navigate("/lesson")}
          className={cx(
            "btn-press group flex items-center gap-4 rounded-2xl p-6 text-left transition-all duration-200 shadow-lg",
            "bg-[#D97736] text-white hover:bg-[#B85C2D] hover:shadow-xl"
          )}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20">
            <Icon name="book" className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-bold">Continuar lección</div>
            <div className="text-sm opacity-90">Lección {currentLesson} · Nivel {currentLevel}</div>
          </div>
          <Icon name="arrow" className="h-6 w-6 transition-transform group-hover:translate-x-1" />
        </button>

        <button
          onClick={() => navigate("/practice")}
          className={cx(
            "btn-press group flex items-center gap-4 rounded-2xl p-6 text-left transition-all duration-200 shadow-lg",
            "bg-[#8C4A27] text-white hover:bg-[#6B3A1F] hover:shadow-xl"
          )}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20">
            <Icon name="camera" className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-bold">Practicar ahora</div>
            <div className="text-sm opacity-90">Mejora tu técnica con la cámara</div>
          </div>
          <Icon name="arrow" className="h-6 w-6 transition-transform group-hover:translate-x-1" />
        </button>
      </div>

      {/* Daily goal ring + Activity Heatmap — side by side on desktop */}
      <div className="mb-8 grid gap-4 lg:grid-cols-4">
        {/* Daily goal ring — fills height to match heatmap */}
        <Card isDark={isDark} className="h-full lg:col-span-1">
          <div className="flex h-full flex-col items-center justify-center">
            <ProgressRing percent={dailyPct} label="Meta diaria" value={`${todayCount}/${dailyGoal}`} isDark={isDark} size={180} stroke={14} />
          </div>
        </Card>

        {/* Heatmap — fills remaining width */}
        <div className="lg:col-span-3">
          <ActivityHeatmap history={practiceHistory} isDark={isDark} />
        </div>
      </div>

      {/* Module progress + Quests */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Module progress */}
        <div className="lg:col-span-2">
          <Card isDark={isDark}>
            <div className="mb-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">— Módulos</span>
              <h3 className={cx("font-display mt-1.5 text-xl font-extrabold", isDark ? "text-white" : "text-[#1A2E3B]")}>Progreso por módulo</h3>
            </div>

            <div className="space-y-2.5">
              {modules.map((m) => {
                const mp = moduleProgress?.find((p) => p.module_id === m.id);
                const done = mp?.signs_completed || 0;
                const pct = m.signs > 0 ? Math.min(100, Math.round((done / m.signs) * 100)) : 0;
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className={cx("w-28 shrink-0 truncate text-xs font-semibold", isDark ? "text-brand-soft" : "text-[#1A2E3B]")}>{m.title}</span>
                    <div className={cx("h-2 flex-1 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#F4EFE6]")}>
                      <div className="h-full rounded-full bg-[#D97736] transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={cx("w-14 shrink-0 text-right text-xs font-medium", isDark ? "text-[#8AACB4]" : "text-[#607274]")} style={{ fontVariantNumeric: 'tabular-nums' }}>{done}/{m.signs}</span>
                  </div>
                );
              })}
            </div>

            {/* Consolidated stats row inside same card */}
            <div className="mt-6 grid grid-cols-4 gap-3 border-t pt-5" style={{ borderColor: isDark ? "#1A5C6A" : "#E8E4D8" }}>
              <StatTile icon="book" value={completedSigns} label="Completadas" color="#D97736" isDark={isDark} />
              <StatTile icon="clock" value={`${practiceTime}m`} label="Tiempo total" color="#8C4A27" isDark={isDark} />
              <StatTile icon="sparkles" value={last7DaysHours} label="Esta semana" color="#EC9960" isDark={isDark} />
              <StatTile icon="trophy" value={`${progressPct}%`} label="Progreso" color="#D97736" isDark={isDark} />
            </div>
          </Card>
        </div>

        {/* Daily quests */}
        <div className="lg:col-span-1">
          <QuestList isDark={isDark} quests={quests} />
        </div>
      </div>

    </main>
  );
}

function LearnPage({ isDark, navigate }) {
  const { userProgress, moduleProgress } = useAuth();

  // Merge module data with progress from database
  const modulesWithProgress = useMemo(() => {
    return modules.map((module, index) => {
      const progressData = moduleProgress?.find(mp => mp.module_id === module.id);
      const signsCompleted = progressData?.signs_completed || 0;
      const isCompleted = signsCompleted >= module.signs;
      
      // Lógica de desbloqueo progresivo
      let status = 'locked';
      if (index === 0) {
        // Primer módulo siempre desbloqueado
        status = isCompleted ? 'completed' : 'current';
      } else {
        // Verificar si el módulo anterior está completado
        const prevModule = modules[index - 1];
        const prevProgressData = moduleProgress?.find(mp => mp.module_id === prevModule.id);
        const prevCompleted = (prevProgressData?.signs_completed || 0) >= prevModule.signs;
        
        if (prevCompleted) {
          status = isCompleted ? 'completed' : 'current';
        } else {
          status = 'locked';
        }
      }
      
      return {
        ...module,
        status: progressData?.status || status,
        signs_completed: signsCompleted,
      };
    });
  }, [moduleProgress]);

  const completedSigns = modulesWithProgress.reduce((sum, m) => sum + (m.signs_completed || 0), 0);
  const totalSigns = modulesWithProgress.reduce((sum, m) => sum + m.signs, 0);
  const progress = totalSigns > 0 ? Math.min(100, Math.round((completedSigns / totalSigns) * 100)) : 0;

  const handleNodeClick = (module) => {
    if (module.status === 'locked') return;
    navigate('/lesson');
  };

  // ===== Continuous zigzag roadmap =====
  // Nodes alternate left↔right down the page. Every curve connects two nodes
  // directly, so there are no empty U-turns. The path flows like a sine wave.
  const NODE_SPACING = 175; // px between consecutive node centers (vertical)
  const numNodes = modulesWithProgress.length;

  // Zigzag x positions as percentages — alternating wide left/right swings
  // with slight variation so it feels organic, not mechanical
  const xPattern = [50, 82, 18, 75, 25, 78, 22, 50];

  // Compute positions: each node at (xPct, yPx)
  const nodePositions = modulesWithProgress.map((_, index) => ({
    xPct: xPattern[index % xPattern.length],
    yPx: index * NODE_SPACING,
  }));

  // Build a single smooth SVG path through all node centers
  // Uses cubic Bezier S-curves for buttery-smooth flow between each pair
  const buildPath = () => {
    if (numNodes === 0) return "";
    const first = nodePositions[0];
    let d = `M ${first.xPct} 0`;
    for (let i = 1; i < numNodes; i++) {
      const prev = nodePositions[i - 1];
      const curr = nodePositions[i];
      const y0 = prev.yPx;
      const y1 = curr.yPx;
      const midY = (y0 + y1) / 2;
      // Smooth S-curve: control points keep the previous direction then ease into the next
      // This creates a flowing sine-wave-like path with no empty sections
      d += ` C ${prev.xPct} ${midY}, ${curr.xPct} ${midY}, ${curr.xPct} ${y1}`;
    }
    return d;
  };

  const pathD = buildPath();
  const pathHeight = (numNodes - 1) * NODE_SPACING;

  return (
    <div className="roadmap-page">
      {/* Title + progress */}
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-6 text-center sm:px-6 sm:pt-12">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
          — Tu Progreso
        </span>
        <h1 className={cx("font-display mt-1 text-2xl font-extrabold sm:text-4xl", isDark ? "text-white" : "text-[#1A2E3B]")}>
          Avance en <span className="text-[#D97736]">módulos</span>
        </h1>

        {/* Progress bar */}
        <div className="mx-auto mt-4 flex max-w-xs items-center gap-3">
          <div className={cx("h-3 flex-1 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#F4EFE6]")}>
            <div
              className="h-full rounded-full bg-[#D97736] transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className={cx("font-display text-sm font-extrabold tabular-nums", isDark ? "text-white" : "text-[#1A2E3B]")}>
            {completedSigns}/{totalSigns}
          </span>
        </div>
      </div>

      {/* Roadmap — full page horizontal snake path */}
      <div
        className="roadmap-container"
        style={{
          '--node-spacing': `${NODE_SPACING}px`,
          minHeight: `${pathHeight + 160}px`,
        }}
      >
        {/* Continuous SVG path behind the nodes */}
        <svg
          className="roadmap-path"
          viewBox={`0 0 100 ${pathHeight}`}
          preserveAspectRatio="none"
          style={{ height: pathHeight }}
          aria-hidden="true"
        >
          <path
            d={pathD}
            vectorEffect="non-scaling-stroke"
            className={cx(
              "roadmap-path-stroke",
              isDark ? "roadmap-path-stroke--dark" : "roadmap-path-stroke--light"
            )}
          />
        </svg>

        {/* Nodes positioned on top of the path */}
        <div className="roadmap-nodes">
          {modulesWithProgress.map((module, index) => {
            const completed = module.status === "completed";
            const current = module.status === "current";
            const locked = module.status === "locked";
            const pos = nodePositions[index];

            return (
              <div
                key={module.id}
                className="roadmap-node"
                style={{
                  '--node-x': `${pos.xPct}%`,
                  '--node-y': `${pos.yPx}px`,
                }}
              >
                <button
                  onClick={() => handleNodeClick(module)}
                  disabled={locked}
                  className={cx(
                    "roadmap-circle",
                    completed && "roadmap-circle--completed",
                    current && "roadmap-circle--current",
                    locked && "roadmap-circle--locked"
                  )}
                  aria-label={`${module.title} - ${locked ? 'Bloqueado' : completed ? 'Completado' : 'En progreso'}`}
                >
                  <Icon name={module.icon || "book"} className="h-7 w-7 sm:h-9 sm:w-9" />
                  <span className={cx(
                    "roadmap-badge",
                    completed ? "bg-[#0D5C6F] text-white" : current ? "bg-[#D97736] text-white" : "bg-[#E8E4D8] text-[#B0A89A]"
                  )}>
                    {completed ? "✓" : current ? "▶" : "🔒"}
                  </span>
                </button>

                <div className="roadmap-label">
                  <span className={cx(
                    "block text-xs font-bold leading-tight sm:text-sm",
                    locked ? (isDark ? "text-[#5A7A82]" : "text-[#B0A89A]") : (isDark ? "text-white" : "text-[#1A2E3B]")
                  )}>
                    {module.title}
                  </span>
                  <span className={cx(
                    "mt-0.5 block text-[10px] font-medium",
                    isDark ? "text-brand-soft" : "text-[#607274]"
                  )}>
                    {module.signs_completed || 0}/{module.signs} señas
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA at the bottom */}
      <div className="mx-auto max-w-md px-4 pb-12 sm:px-6">
        <button
          onClick={() => navigate('/lesson')}
          className="btn-press flex w-full items-center justify-center gap-2 rounded-xl bg-[#D97736] px-6 py-3.5 text-sm font-bold text-white transition-all active:scale-95 hover:bg-[#B85C2D]"
        >
          <Icon name="book" className="h-5 w-5" />
          Continuar aprendiendo
        </button>
      </div>
    </div>
  );
}


function SkillNode({ module, index, isDark, selected, onClick }) {
  const completed = module.status === "completed";
  const current = module.status === "current";
  const locked = module.status === "locked";

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={cx(
          "group btn-press relative flex w-full items-center gap-4 text-left transition-all duration-300",
          locked && "cursor-default opacity-50",
          !locked && "hover:scale-[1.01]"
        )}
        disabled={locked}
        aria-pressed={selected}
        aria-label={`${module.title} - ${module.desc} - ${locked ? 'Bloqueado' : completed ? 'Completado' : 'En progreso'}`}
      >
        <div className="relative">
          <div className={cx(
            "relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition-all duration-300 sm:h-16 sm:w-16",
            isDark
              ? "border-2 border-brand-line bg-brand-card text-brand-orange"
              : "border-2 border-gray-300 bg-gray-100 text-brand-orange"
          )} aria-hidden="true">
            <Icon name={module.icon || "book"} className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className={cx(
            "absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-300 sm:h-7 sm:w-7",
            isDark ? "border-brand-deep bg-brand-card" : "border-white bg-white",
            completed ? "text-brand-teal" : current ? "text-brand-orange" : "text-gray-400"
          )}>
            {completed ? <Icon name="check" className="h-3 w-3 sm:h-4 sm:w-4" />
              : current ? <Icon name="play" className="h-3 w-3 sm:h-4 sm:w-4" />
              : <Icon name="lock" className="h-3 w-3 sm:h-3 sm:w-3" />}
          </div>
        </div>
        <div className={cx(
          "flex-1 rounded-xl p-4 transition-all duration-200 sm:p-5",
          selected
            ? (isDark ? "border-2 border-brand-cyan/50 bg-brand-card" : "border-2 border-[#D97736]/50 bg-white")
            : (isDark ? "border border-brand-line/30 bg-transparent hover:border-brand-cyan/50" : "border border-[#E8E4D8] bg-transparent hover:border-[#8C4A27]/50")
        )}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <span className={cx("block text-sm font-bold sm:text-base", isDark ? "text-white" : "text-gray-900")}>{module.title}</span>
              <span className={cx("block text-xs mt-1", isDark ? "text-[#5A8A94]" : "text-gray-600")}>{module.desc}</span>
            </div>
            {module.signs_completed !== undefined && (
              <div className={cx("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold", isDark ? "bg-brand-deep/50 text-brand-soft" : "bg-gray-100 text-gray-600")}>
                <span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>{module.signs_completed}</span>
                <span>/</span>
                <span>{module.signs}</span>
              </div>
            )}
          </div>
          {module.signs_completed !== undefined && (
            <div className="mt-3">
              <div className={cx("h-1.5 w-full overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-gray-200")}>
                <div className={cx("h-full rounded-full transition-all duration-500", completed ? "bg-brand-teal" : current ? "bg-brand-orange" : "bg-gray-400")} style={{ width: `${(module.signs_completed / module.signs) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function LessonPage({ isDark, navigate }) {
  const { userProgress, moduleProgress } = useAuth();
  const [selected, setSelected] = useState(modules[0]);
  const [activeSign, setActiveSign] = useState(null);
  const [search, setSearch] = useState("");

  // Auto-advance to next sign in current module
  const handleNextSign = () => {
    if (!selected || !activeSign) return;
    const currentIndex = selected.items.findIndex(item => item.label === activeSign.label);
    if (currentIndex !== -1 && currentIndex < selected.items.length - 1) {
      setActiveSign(selected.items[currentIndex + 1]);
    }
  };

  // Merge module data with progress from database
  const modulesWithProgress = useMemo(() => {
    return modules.map((module, index) => {
      const progressData = moduleProgress?.find(mp => mp.module_id === module.id);
      const signsCompleted = progressData?.signs_completed || 0;
      const isCompleted = signsCompleted >= module.signs;
      
      let status = 'locked';
      if (index === 0) {
        status = isCompleted ? 'completed' : 'current';
      } else {
        const prevModule = modules[index - 1];
        const prevProgressData = moduleProgress?.find(mp => mp.module_id === prevModule.id);
        const prevCompleted = (prevProgressData?.signs_completed || 0) >= prevModule.signs;
        
        if (prevCompleted) {
          status = isCompleted ? 'completed' : 'current';
        } else {
          status = 'locked';
        }
      }
      
      return {
        ...module,
        status: progressData?.status || status,
        signs_completed: signsCompleted,
      };
    });
  }, [moduleProgress]);

  const filteredItems = useMemo(() => {
    if (!selected) return [];
    if (!search.trim()) return selected.items;
    return selected.items.filter((item) =>
      item.label.toLowerCase().includes(search.toLowerCase())
    );
  }, [selected, search]);

  return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={() => {}} navigate={navigate} path="/lesson" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Enhanced Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/learn")}
            className={cx(
              "btn-press group flex items-center gap-2 text-sm font-medium transition-all duration-200",
              isDark ? "text-brand-soft hover:text-white" : "text-brand-muted hover:text-brand-ink"
            )}
          >
            <Icon name="arrow" className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-1" />
            Volver a Progreso
          </button>
          
          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
                  — Lecciones
                </span>
              </div>
              <h1 className={cx("font-display text-3xl font-extrabold sm:text-4xl", isDark ? "text-white" : "text-brand-ink")}>
                Explora y <span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>aprende</span>
              </h1>
            </div>
            <div className="w-20" />
          </div>
        </div>

        {!activeSign ? (
          <div className="grid gap-8 lg:grid-cols-12">
            {/* Enhanced Module List */}
            <section className="space-y-4 lg:col-span-4">
              <div className={cx(
                "rounded-3xl border p-6 backdrop-blur-xl",
                isDark ? "border-brand-line/30 bg-brand-card/50" : "border-brand-mist/30 bg-white/50"
              )}>
                <div className="mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#8C4A27]">
                    — Módulos
                  </span>
                </div>
                
                <div className="space-y-3 max-h-[60vh] lg:max-h-[80vh] overflow-y-auto pr-2">
                  {modulesWithProgress.map((module, index) => (
                    <SkillNode
                      key={module.id} 
                      module={module} 
                      index={index} 
                      isDark={isDark}
                      selected={selected?.id === module.id}
                      onClick={() => { setSelected(module); setSearch(""); }}
                    />
                  ))}
                </div>
              </div>
            </section>
            
            {/* Enhanced Sign Grid */}
            <section className="space-y-6 lg:col-span-8">
              {selected && (
                <Card isDark={isDark}>
                  <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className={cx("flex h-14 w-14 items-center justify-center rounded-2xl", isDark ? "bg-brand-orange/20 text-brand-orange" : "bg-brand-orange/20 text-brand-orange")}>
                        <Icon name={selected.icon || "book"} className="h-7 w-7" />
                      </div>
                      <div>
                        <h3 className={cx("text-xl font-bold", isDark ? "text-white" : "text-gray-900")}>{selected.title}</h3>
                        <p className={cx("text-sm", isDark ? "text-[#5A8A94]" : "text-gray-600")}>{selected.signs} señas · Nivel {selected.level}</p>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <Icon name="sparkles" className={cx("absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4", isDark ? "text-brand-soft" : "text-brand-muted")} />
                      <input
                        value={search} 
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar seña..."
                        className={cx(
                          "pl-11 pr-4 py-3 rounded-xl text-sm w-48 sm:w-64 transition-all duration-200 focus:ring-2 focus:ring-brand-cyan/50",
                          isDark ? "bg-brand-deep text-white border border-brand-line placeholder:text-[#5A8A94]" : "bg-white text-brand-ink border border-gray-200 placeholder:text-[#8AA8B0]"
                        )}
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 max-h-96 overflow-y-auto pr-2">
                    {filteredItems.map((item, index) => (
                      <button
                        key={item.label} 
                        onClick={() => setActiveSign(item)}
                        className={cx(
                          "btn-press group flex flex-col items-center gap-3 rounded-2xl p-4 text-center transition-all duration-300 hover:scale-105",
                          isDark 
                            ? "bg-brand-deep/40 hover:bg-brand-deep/60 border border-brand-line/30 hover:border-brand-cyan/50" 
                            : "bg-gray-100 hover:bg-gray-200 border border-gray-300 hover:border-brand-teal/50 shadow-sm"
                        )}
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        <div className="relative h-24 w-full overflow-hidden rounded-xl shadow-md">
                          <img 
                            src={item.thumbnail} 
                            alt={item.label} 
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" 
                            loading="lazy" 
                          />
                          <div className="absolute inset-0 bg-black/10" />
                          {/* Icon overlay */}
                          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
                            <Icon name={getSignIcon(item.label)} className="h-3 w-3 text-gray-800" />
                          </div>
                        </div>
                        <span className={cx("text-xs font-semibold leading-tight", isDark ? "text-brand-soft" : "text-gray-700")}>
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              )}
            </section>
          </div>
        ) : (
          <LessonView
            sign={activeSign}
            isDark={isDark}
            onClose={() => setActiveSign(null)}
            moduleId={selected.id}
            onNextSign={handleNextSign}
          />
        )}
      </main>
    </div>
  );
}

function SignVideoPanel({ sign, isDark, onClose, moduleId }) {
  const { user } = useAuth();
  const [viewRecorded, setViewRecorded] = useState(false);

  useEffect(() => {
    if (!viewRecorded && user && sign) {
      recordVideoView(user.id, sign.label || sign.name, moduleId, sign.lessonId || moduleId);
      setViewRecorded(true);
    }
  }, [user, sign, moduleId, viewRecorded]);

  return (
    <Card isDark={isDark}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className={cx("font-display text-xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{sign.label}</h3>
          <p className={cx("text-xs", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{sign.hint || sign.desc}</p>
        </div>
        <button onClick={onClose} className={cx("btn-press rounded-lg p-2", isDark ? "bg-brand-deep text-brand-soft hover:text-white" : "bg-brand-cream text-brand-muted hover:text-brand-ink")}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <div className="overflow-hidden rounded-xl" style={{ paddingBottom: "56.25%", position: "relative" }}>
        <iframe
          src={sign.video_ref}
          title={sign.label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full rounded-xl border-0"
        />
      </div>
    </Card>
  );
}

function LessonView({ sign, isDark, onClose, moduleId, onNextSign }) {
  const { user } = useAuth();
  const [viewRecorded, setViewRecorded] = useState(false);
  const [handDetected, setHandDetected] = useState(false);
  const [gestureState, setGestureState] = useState("waiting");
  const [matchScore, setMatchScore] = useState(0);
  const [practiceSuccess, setPracticeSuccess] = useState(false);
  const holdStartRef = useRef(null);
  const HOLD_MS = 600;

  // Extract YouTube video ID from URL
  const getYouTubeVideoId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url?.match(regex);
    return match ? match[1] : null;
  };

  const videoId = getYouTubeVideoId(sign?.video_ref || sign?.video_ref);

  // Record video view once on open
  useEffect(() => {
    if (!viewRecorded && user && sign) {
      recordVideoView(user.id, sign.label || sign.name, moduleId, sign.lessonId || moduleId);
      setViewRecorded(true);
    }
  }, [user, sign, moduleId, viewRecorded]);

  // Simplified practice handler for lesson view
  const handlePracticeResults = useCallback(({ handRes }) => {
    const lms = handRes?.landmarks?.[0] ?? null;
    setHandDetected(!!lms);

    if (!lms || practiceSuccess) {
      holdStartRef.current = null;
      if (!practiceSuccess) setGestureState("waiting");
      setMatchScore(0);
      return;
    }

    const states = fingerStates(lms);
    const sc = sign.template
      ? scoreTarget(states, sign.label || sign.name, sign.template)
      : 0;

    setMatchScore(sc);

    if (sc >= MATCH_THR) {
      if (!holdStartRef.current) holdStartRef.current = performance.now();
      const held = performance.now() - holdStartRef.current;
      const pct = Math.min(1, held / HOLD_MS);
      setGestureState(pct >= 1 ? "match" : "partial");

      if (held >= HOLD_MS) {
        setPracticeSuccess(true);
        setGestureState("confirmed");
        
        // Save progress
        if (user) {
          updateSignProgress(user.id, sign.label || sign.name, moduleId, sc, 0);
          updateStreak(user.id);
        }
        
        setTimeout(() => {
          setPracticeSuccess(false);
          holdStartRef.current = null;
          setGestureState("waiting");
          setMatchScore(0);
          // Auto-advance to next sign
          if (onNextSign) onNextSign();
        }, 800);
      }
    } else {
      holdStartRef.current = null;
      setGestureState(sc > 0.45 ? "partial" : "waiting");
    }
  }, [sign, user, moduleId, practiceSuccess]);

  const { videoRef, canvasRef, camReady, camError } = useSimpleCamera({ 
    onResults: handlePracticeResults 
  });

  if (!sign || !videoId) return null;

  // Use autoplay with mute to prevent freezing, loop enabled for continuous playback
  // Added showinfo=0 and iv_load_policy=3 to minimize YouTube title/annotations
  const iframeSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className={cx("btn-press flex items-center gap-2 text-sm font-medium", isDark ? "text-brand-soft hover:text-white" : "text-brand-muted hover:text-brand-ink")}
        >
          <Icon name="arrow" className="h-4 w-4 rotate-180" />
          Volver a lecciones
        </button>
        <div className="text-center">
          <h2 className={cx("font-display text-xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>
            {sign.label || sign.name}
          </h2>
          <p className={cx("text-sm", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>
            {sign.hint || sign.desc}
          </p>
        </div>
        <div className="w-24" />
      </div>

      {/* Split view: Video on left (larger), Camera on right (smaller) */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl p-4 sm:grid-cols-3">
        {/* YouTube Video - 2 columns wide */}
        <div className="relative overflow-hidden rounded-2xl bg-black sm:col-span-2" style={{ paddingBottom: "56.25%" }}>
          <iframe
            key={videoId}
            src={iframeSrc}
            title={sign.label || sign.name}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
          {/* Success animation overlay */}
          {practiceSuccess && (
            <div className="absolute inset-0 flex items-center justify-center bg-brand-teal/90 animate-fade-in">
              <div className="text-center animate-success-bounce">
                <div className="text-7xl mb-4">✓</div>
                <div className="text-3xl font-bold text-white">¡Excelente!</div>
                <div className="text-base text-white/90 mt-2">Seña aprendida</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Camera with hand detection - 1 column wide */}
        <div className="relative overflow-hidden rounded-2xl bg-black" style={{ paddingBottom: "56.25%", position: "relative" }}>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            style={{ transform: "scaleX(-1)" }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          {!camReady && !camError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-sm font-semibold text-white">
                Iniciando cámara...
              </div>
            </div>
          )}
          {camError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center">
                <div className="text-sm font-semibold text-red-400">{camError}</div>
              </div>
            </div>
          )}
          {camReady && (
            <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
              <div className={cx("rounded-lg px-3 py-2 text-sm font-bold transition-all duration-300 transform",
                gestureState === "confirmed" ? "bg-brand-teal text-white scale-110 shadow-lg shadow-brand-teal/30" :
                gestureState === "match" ? "bg-brand-teal/80 text-white scale-105" :
                gestureState === "partial" ? "bg-brand-orange/60 text-white scale-105" :
                "bg-brand-deep/80 text-brand-soft"
              )}>
                {gestureState === "confirmed" ? "✓ Correcto" :
                 gestureState === "match" ? "Mantén la pose..." :
                 gestureState === "partial" ? "Casi..." :
                 handDetected ? "Detectando..." : "Muestra tu mano"}
              </div>
              {sign.template && (
                <div className={cx("rounded-lg px-3 py-2 text-sm font-bold transition-all duration-300", isDark ? "bg-brand-deep/80 text-brand-cyan" : "bg-white/80 text-brand-teal")}>
                  Precisión: {Math.round(matchScore * 100)}%
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignVideoModal({ sign, isDark, onClose, moduleId, onNextSign }) {
  const { user } = useAuth();
  const [viewRecorded, setViewRecorded] = useState(false);
  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [handDetected, setHandDetected] = useState(false);
  const [gestureState, setGestureState] = useState("waiting");
  const [matchScore, setMatchScore] = useState(0);
  const [practiceSuccess, setPracticeSuccess] = useState(false);
  const holdStartRef = useRef(null);
  const HOLD_MS = 600;

  // Extract YouTube video ID from URL
  const getYouTubeVideoId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url?.match(regex);
    return match ? match[1] : null;
  };

  const videoId = getYouTubeVideoId(sign?.video_ref || sign?.video_ref);

  // Record video view once on open
  useEffect(() => {
    if (!viewRecorded && user && sign) {
      recordVideoView(user.id, sign.label || sign.name, moduleId, sign.lessonId || moduleId);
      setViewRecorded(true);
    }
  }, [user, sign, moduleId, viewRecorded]);

  // Block body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Focus management: capture previous active element and focus close button
  useEffect(() => {
    previousActiveElementRef.current = document.activeElement;
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
    return () => {
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, []);

  // Focus trap within modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Simplified practice handler for modal
  const handlePracticeResults = useCallback(({ handRes }) => {
    const lms = handRes?.landmarks?.[0] ?? null;
    setHandDetected(!!lms);

    if (!lms || practiceSuccess) {
      holdStartRef.current = null;
      if (!practiceSuccess) setGestureState("waiting");
      setMatchScore(0);
      return;
    }

    const states = fingerStates(lms);
    const sc = sign.template
      ? scoreTarget(states, sign.label || sign.name, sign.template)
      : 0;

    setMatchScore(sc);

    if (sc >= MATCH_THR) {
      if (!holdStartRef.current) holdStartRef.current = performance.now();
      const held = performance.now() - holdStartRef.current;
      const pct = Math.min(1, held / HOLD_MS);
      setGestureState(pct >= 1 ? "match" : "partial");

      if (held >= HOLD_MS) {
        setPracticeSuccess(true);
        setGestureState("confirmed");
        
        // Save progress
        if (user) {
          updateSignProgress(user.id, sign.label || sign.name, moduleId, sc, 0);
          updateStreak(user.id);
        }
        
        setTimeout(() => {
          setPracticeSuccess(false);
          holdStartRef.current = null;
          setGestureState("waiting");
          setMatchScore(0);
          // Auto-advance to next sign
          if (onNextSign) onNextSign();
        }, 800);
      }
    } else {
      holdStartRef.current = null;
      setGestureState(sc > 0.45 ? "partial" : "waiting");
    }
  }, [sign, user, moduleId, practiceSuccess]);

  const { videoRef, canvasRef, camReady, camError } = useSimpleCamera({ 
    onResults: handlePracticeResults 
  });

  if (!sign || !videoId) return null;

  // Use autoplay with mute to prevent freezing, loop enabled for continuous playback
  // Added showinfo=0 and iv_load_policy=3 to minimize YouTube title/annotations
  const iframeSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3`;

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Video de seña: ${sign.label || sign.name}`}
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50",
        prefersReducedMotion ? "" : "animate-fade"
      )}
      onClick={handleOverlayClick}
    >
      <div
        className={cx(
          "relative w-full max-w-7xl rounded-2xl shadow-2xl",
          isDark ? "bg-brand-card border border-brand-line" : "bg-white border border-gray-200"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between p-4 sm:p-6">
          <div>
            <h3 className={cx("font-display text-xl font-extrabold sm:text-2xl", isDark ? "text-white" : "text-brand-ink")}>
              {sign.label || sign.name}
            </h3>
            <p className={cx("text-xs sm:text-sm", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>
              {sign.hint || sign.desc}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className={cx(
              "btn-press rounded-lg p-2 transition",
              isDark ? "bg-brand-deep text-brand-soft hover:text-white" : "bg-brand-cream text-brand-muted hover:text-brand-ink"
            )}
            aria-label="Cerrar video"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        
        {/* Split view: Video on left (larger), Camera on right */}
        <div className="grid grid-cols-1 gap-4 rounded-b-2xl p-4 sm:grid-cols-3">
          {/* YouTube Video - 2 columns wide */}
          <div className="relative overflow-hidden rounded-2xl bg-black sm:col-span-2" style={{ paddingBottom: "56.25%" }}>
            <iframe
              key={videoId}
              src={iframeSrc}
              title={sign.label || sign.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full border-0"
            />
            {/* Success animation overlay */}
            {practiceSuccess && (
              <div className="absolute inset-0 flex items-center justify-center bg-brand-teal/90 animate-fade-in">
                <div className="text-center animate-success-bounce">
                  <div className="text-7xl mb-4">✓</div>
                  <div className="text-3xl font-bold text-white">¡Excelente!</div>
                  <div className="text-base text-white/90 mt-2">Seña aprendida</div>
                </div>
              </div>
            )}
          </div>
          
          {/* Camera with hand detection - 1 column */}
          <div className="relative overflow-hidden rounded-2xl bg-black" style={{ paddingBottom: "56.25%", position: "relative" }}>
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            {!camReady && !camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-sm font-semibold text-white">
                  Iniciando cámara...
                </div>
              </div>
            )}
            {camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <div className="text-sm font-semibold text-red-400">{camError}</div>
                </div>
              </div>
            )}
            {camReady && (
              <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
                <div className={cx("rounded-lg px-3 py-2 text-sm font-bold transition-all duration-300 transform",
                  gestureState === "confirmed" ? "bg-brand-teal text-white scale-110 shadow-lg shadow-brand-teal/30" :
                  gestureState === "match" ? "bg-brand-teal/80 text-white scale-105" :
                  gestureState === "partial" ? "bg-brand-orange/60 text-white scale-105" :
                  "bg-brand-deep/80 text-brand-soft"
                )}>
                  {gestureState === "confirmed" ? "✓ Correcto" :
                   gestureState === "match" ? "Mantén la pose..." :
                   gestureState === "partial" ? "Casi..." :
                   handDetected ? "Detectando..." : "Muestra tu mano"}
                </div>
                {sign.template && (
                  <div className={cx("rounded-lg px-3 py-2 text-sm font-bold transition-all duration-300", isDark ? "bg-brand-deep/80 text-brand-cyan" : "bg-white/80 text-brand-teal")}>
                    Precisión: {Math.round(matchScore * 100)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Puntos faciales clave para expresión LSM (cejas, boca, ojos)
const FACE_KEY_IDXS = [
  70, 63, 105, 66, 107,          // ceja izq
  336, 296, 334, 293, 300,       // ceja der
  13, 14, 78, 308, 61, 291,      // boca
  159, 145, 386, 374,            // ojos
];

function mirror(lm) { return { ...lm, x: 1 - lm.x }; }

// Simplified camera hook for modal - only hands, faster startup, better FPS
function useSimpleCamera({ onResults }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const hlRef        = useRef(null);
  const rafRef       = useRef(null);
  const streamRef    = useRef(null);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Start camera first for faster feedback
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" }, // Lower resolution for better performance
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCamReady(true);

        // Load hand model after camera is ready
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2, // Detect both hands
          minHandDetectionConfidence: 0.5, // Lower confidence for better detection
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) { hl.close(); stream.getTracks().forEach((t) => t.stop()); return; }
        hlRef.current = hl;

        function detect() {
          if (cancelled) return;
          const canvas = canvasRef.current;
          const vid = videoRef.current;
          if (!canvas || !vid || vid.readyState < 2) {
            rafRef.current = requestAnimationFrame(detect);
            return;
          }

          const w = vid.videoWidth || 320;
          const h = vid.videoHeight || 240;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          const now = performance.now();

          // Video espejado
          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-w, 0);
          ctx.drawImage(vid, 0, 0, w, h);
          ctx.restore();

          const draw = new DrawingUtils(ctx);

          // Only detect hands
          const handRes = hlRef.current.detectForVideo(vid, now);
          for (const lms of (handRes.landmarks || [])) {
            const m = lms.map(mirror);
            draw.drawConnectors(m, HandLandmarker.HAND_CONNECTIONS, { color: "#2AABB8", lineWidth: 2 });
            draw.drawLandmarks(m, { color: "#EC9960", lineWidth: 1, radius: 3 });
          }

          if (onResults) onResults({ handRes });
          rafRef.current = requestAnimationFrame(detect);
        }
        rafRef.current = requestAnimationFrame(detect);

      } catch (err) {
        if (!cancelled) setCamError("Error de cámara: " + err.message);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      hlRef.current?.close();
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [onResults]);

  return { videoRef, canvasRef, camReady, camError };
}

// Full camera hook for PracticePage - hands, pose, face
function useCameraMediaPipe({ onResults, enabled = true }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const hlRef        = useRef(null);
  const plRef        = useRef(null);
  const flRef        = useRef(null);
  const rafRef       = useRef(null);
  const slowFrameRef = useRef(-1);
  const lastPoseRef  = useRef({ landmarks: [] });
  const lastFaceRef  = useRef({ landmarks: [] });
  const streamRef    = useRef(null); // Store stream reference for cleanup
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;

        // Crear los 3 landmarkers en paralelo
        const [hl, pl, fl] = await Promise.all([
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
        ]);
        if (cancelled) { hl.close(); pl.close(); fl.close(); return; }
        hlRef.current = hl;
        plRef.current = pl;
        flRef.current = fl;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        
        streamRef.current = stream; // Store stream reference

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCamReady(true);

        function detect() {
          if (cancelled) return;
          const canvas = canvasRef.current;
          const vid = videoRef.current;
          if (!canvas || !vid || vid.readyState < 2) {
            rafRef.current = requestAnimationFrame(detect);
            return;
          }

          const w = vid.videoWidth || 640;
          const h = vid.videoHeight || 480;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          const now = performance.now();

          // Video espejado
          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-w, 0);
          ctx.drawImage(vid, 0, 0, w, h);
          ctx.restore();

          const draw = new DrawingUtils(ctx);

          // --- Manos cada frame (alta prioridad) ---
          const handRes = hlRef.current.detectForVideo(vid, now);
          for (const lms of (handRes.landmarks || [])) {
            const m = lms.map(mirror);
            draw.drawConnectors(m, HandLandmarker.HAND_CONNECTIONS, { color: "#2AABB8", lineWidth: 2 });
            draw.drawLandmarks(m, { color: "#EC9960", lineWidth: 1, radius: 3 });
          }

          // --- Pose y cara a 8 fps (throttle) para no bloquear el hilo ---
          const slowFrame = Math.floor(now / 125); // cambia cada 125ms = 8fps
          if (slowFrame !== slowFrameRef.current) {
            slowFrameRef.current = slowFrame;

            const poseRes = plRef.current.detectForVideo(vid, now);
            lastPoseRef.current = poseRes;
            for (const lms of (poseRes.landmarks || [])) {
              const m = lms.map(mirror);
              const armConns = PoseLandmarker.POSE_CONNECTIONS.filter(
                ({ start, end }) => [11,12,13,14,15,16].includes(start) && [11,12,13,14,15,16].includes(end)
              );
              draw.drawConnectors(m, armConns, { color: "#A855F7", lineWidth: 3 });
              [11,12,13,14,15,16].forEach((i) => {
                if (m[i]) draw.drawLandmarks([m[i]], { color: "#D946EF", lineWidth: 1, radius: 5 });
              });
            }

            const faceRes = flRef.current.detectForVideo(vid, now);
            lastFaceRef.current = faceRes;
            for (const lms of (faceRes.landmarks || [])) {
              const m = lms.map(mirror);
              const keyPts = FACE_KEY_IDXS.filter((i) => m[i]).map((i) => m[i]);
              draw.drawLandmarks(keyPts, { color: "#22D3EE", lineWidth: 1, radius: 2 });
            }
          }

          if (onResults) onResults({ handRes, poseRes: lastPoseRef.current, faceRes: lastFaceRef.current });
          rafRef.current = requestAnimationFrame(detect);
        }
        rafRef.current = requestAnimationFrame(detect);

      } catch (err) {
        if (!cancelled) setCamError("Error de cámara: " + err.message);
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      hlRef.current?.close();
      plRef.current?.close();
      flRef.current?.close();
      
      // Ensure camera is completely stopped
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return { videoRef, canvasRef, camReady, camError };
}

function PracticePage({ isDark, setIsDark, navigate }) {
  const { user, userProgress } = useAuth();
  const [signIdx, setSignIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  const [handDetected, setHandDetected] = useState(false);
  const [toasts, setToasts] = useState([{ id: 1, type: "info", message: 'Muestra la seña correcta con tu mano' }]);
  const idRef = useRef(2);
  const [gestureState, setGestureState] = useState("waiting"); // waiting | partial | match | confirmed
  const [matchScore, setMatchScore]     = useState(0);
  const [confirmedSignName, setConfirmedSignName] = useState(null);
  const confirmedRef = useRef(false);
  const holdStartRef = useRef(null);   // momentáneo que lleva la mano en MATCH
  const HOLD_MS = 600;                 // ms que debe mantener la pose correcta
  const practiceStartTime = useRef(Date.now());
  const streamRef = useRef(null); // Store the media stream for cleanup

  const addToast = (type, message) => setToasts((prev) => [{ id: idRef.current++, type, message }]); // Solo mantener el toast más reciente

  // Cleanup camera when component unmounts or route changes
  useEffect(() => {
    return () => {
      // Stop all media streams
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      // Also stop any video elements
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach(video => {
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => track.stop());
          video.srcObject = null;
        }
      });
    };
  }, []);

  const handleResults = useCallback(({ handRes }) => {
    const lms = handRes?.landmarks?.[0] ?? null;
    setHandDetected(!!lms);

    if (!lms) {
      holdStartRef.current = null;
      if (!confirmedRef.current) setGestureState("waiting");
      setMatchScore(0);
      return;
    }

    if (confirmedRef.current) return;

    setSignIdx((prevIdx) => {
      const sign = signsQueue[prevIdx];
      const states = fingerStates(lms);
      const sc = sign.template
        ? scoreTarget(states, sign.name, sign.template)
        : 0;  // señas sin template (palabras) siempre pasan con botón

      setMatchScore(sc);

      if (sc >= MATCH_THR) {
        if (!holdStartRef.current) holdStartRef.current = performance.now();
        const held = performance.now() - holdStartRef.current;
        const pct  = Math.min(1, held / HOLD_MS);
        setGestureState(pct >= 1 ? "match" : "partial");

        if (held >= HOLD_MS) {
          confirmedRef.current = true;
          setGestureState("confirmed");
          setConfirmedSignName(sign.name); // Guardar el nombre de la seña detectada
          setCorrect((v) => v + 1);
          setTotal((v) => v + 1);
          const next = Math.min(prevIdx + 1, signsQueue.length - 1);
          addToast("success", `✓ ${sign.name}  →  ${signsQueue[next].name}`);
          
          // Save progress to database
          if (user) {
            const timeSpent = Math.floor((Date.now() - practiceStartTime.current) / 1000);
            updateSignProgress(user.id, sign.name, sign.module || 'practice', sc, timeSpent);
            updateStreak(user.id);
            practiceStartTime.current = Date.now();
          }
          
          setTimeout(() => {
            confirmedRef.current = false;
            holdStartRef.current = null;
            setGestureState("waiting");
            setMatchScore(0);
            setConfirmedSignName(null); // Limpiar el nombre confirmado
          }, 800);
          return next;
        }
      } else {
        holdStartRef.current = null;
        setGestureState(sc > 0.45 ? "partial" : "waiting");
      }
      return prevIdx;
    });
  }, []);

  const { videoRef, canvasRef, camReady, camError } = useCameraMediaPipe({ onResults: handleResults });

  const skipSign = () => {
    confirmedRef.current = false;
    holdStartRef.current = null;
    setGestureState("waiting");
    setMatchScore(0);
    setTotal((v) => v + 1);
    setSignIdx((v) => Math.min(v + 1, signsQueue.length - 1));
    addToast("info", `Saltada → ${signsQueue[Math.min(signIdx + 1, signsQueue.length - 1)].name}`);
  };

  const stopCamera = () => {
    // Stop all media streams
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach(video => {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
      }
    });
    addToast("info", "Cámara detenida");
  };

  return (
    <div className={cx("flex h-screen flex-col transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <div className="flex min-h-0 flex-1">
        <main className="relative flex-1 p-2 sm:p-4">
          <div className="relative h-full overflow-hidden rounded-xl bg-black">
            {/* Controles flotantes - score y detener cámara (header unificado arriba) */}
            <div className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 backdrop-blur-md transition-opacity duration-300 sm:top-4 sm:gap-3 sm:px-4">
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white sm:text-xs">
                {correct}/{total}
              </span>
              <button
                onClick={stopCamera}
                className="btn-press rounded-full bg-[#D96B6B]/90 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#D96B6B] sm:text-xs"
              >
                <span className="hidden sm:inline">Detener Cámara</span>
                <span className="sm:hidden">Detener</span>
              </button>
            </div>

            {/* Video oculto — solo usado como fuente para MediaPipe */}
            <video ref={videoRef} className="absolute opacity-0 pointer-events-none" playsInline muted />
            {/* Canvas con video espejado + landmarks */}
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

            {!camReady && !camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
                <p className={cx("text-sm font-semibold text-center", isDark ? "text-brand-soft" : "text-white")}>Iniciando cámara…</p>
              </div>
            )}
            {camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 sm:p-8 text-center">
                <Icon name="camera" className="h-10 w-10 sm:h-12 sm:w-12 text-[#D96B6B]" />
                <p className="text-sm font-semibold text-white">{camError}</p>
                <p className="text-xs text-[#8AA8B0]">Permite el acceso a la cámara en tu navegador y recarga la página.</p>
              </div>
            )}

            {/* Indicador de detección geométrica - ocultar cuando se confirma la seña */}
            {camReady && gestureState !== "confirmed" && (
              <div className="absolute left-2 top-2 sm:left-4 sm:top-4 flex flex-col gap-1.5 transition-opacity duration-300">
                <div className={cx(
                  "flex items-center gap-2 rounded-full px-2 py-1.5 text-[10px] font-bold backdrop-blur-sm transition-all sm:px-3 sm:text-[11px]",
                  gestureState === "confirmed" ? "bg-[#1A6B4A]/90 text-[#D4F5E4]" :
                  gestureState === "match"     ? "bg-green-600/90 text-white" :
                  gestureState === "partial"   ? "bg-brand-orange/90 text-white" :
                  handDetected                 ? "bg-black/60 text-[#2AABB8]" :
                                                "bg-black/50 text-[#8AA8B0]"
                )}>
                  <span className={cx("h-2 w-2 rounded-full",
                    gestureState === "confirmed" ? "bg-green-400 animate-pulse" :
                    gestureState === "match"     ? "bg-green-300 animate-pulse" :
                    gestureState === "partial"   ? "bg-yellow-300 animate-pulse" :
                    handDetected                 ? "bg-[#2AABB8]" : "bg-gray-500"
                  )} />
                  {gestureState === "confirmed" ? "✓ ¡Correcto!" :
                   gestureState === "match"     ? "✓ Mantén la pose…" :
                   gestureState === "partial"   ? `Cerca: ${Math.round(matchScore*100)}%` :
                   handDetected                 ? "Mano detectada" : "Sin mano"}
                </div>
                {/* Barra de progreso del score */}
                {handDetected && gestureState !== "confirmed" && (
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/40 sm:w-32">
                    <div
                      className={cx("h-full rounded-full transition-all duration-150",
                        matchScore >= MATCH_THR ? "bg-green-400" :
                        matchScore > 0.45 ? "bg-brand-orange" : "bg-[#2AABB8]/60"
                      )}
                      style={{ width: `${Math.round(matchScore*100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Esquinas decorativas */}
            <div className="absolute inset-8 pointer-events-none">
              {["top-0 left-0 border-l-2 border-t-2", "top-0 right-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((pos) => (
                <div key={pos} className={cx("absolute h-8 w-8 rounded-lg", pos, handDetected ? "border-green-400/60" : "border-brand-cyan/40")} />
              ))}
            </div>

            {/* Indicador de éxito cuando se confirma la seña */}
            {gestureState === "confirmed" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm transition-opacity duration-300">
                <div className="flex flex-col items-center gap-4 animate-fade">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-500/20 shadow-2xl sm:h-32 sm:w-32">
                    <Icon name="check" className="h-12 w-12 text-green-400 sm:h-16 sm:w-16" />
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-extrabold text-white sm:text-3xl">¡Excelente!</div>
                    <div className="mt-2 text-sm text-green-300">{confirmedSignName || signsQueue[signIdx].name} detectada</div>
                  </div>
                </div>
              </div>
            )}

            {/* Seña actual - ocultar cuando se confirma la seña */}
            {gestureState !== "confirmed" && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/20 bg-black/60 px-4 py-2.5 text-center shadow-lg backdrop-blur-md max-w-xs w-full sm:bottom-6 sm:px-5 sm:py-3 transition-opacity duration-300">
                <div className="text-[9px] font-bold uppercase tracking-widest text-[#8AA8B0] sm:text-[10px]">{signsQueue[signIdx].module} · {signsQueue[signIdx].difficulty}{signsQueue[signIdx].mov ? " · 🤸 con movimiento" : ""}</div>
                <div className="text-xl font-extrabold text-white sm:text-2xl">{signsQueue[signIdx].name}</div>
                {signsQueue[signIdx].hint && (
                  <div className="mt-1 text-[10px] text-[#8AA8B0] leading-tight sm:text-[11px]">{signsQueue[signIdx].hint}</div>
                )}
              </div>
            )}

            {/* Toasts - reposicionados a la esquina superior derecha, más pequeños y sin stackeo */}
            {gestureState !== "confirmed" && (
              <div className="absolute right-2 top-2 flex w-full max-w-[180px] flex-col gap-1 px-2 sm:right-4 sm:top-4 sm:max-w-[220px] sm:px-0 transition-opacity duration-300">
                {toasts.map((toast) => <Toast key={toast.id} toast={toast} isDark={isDark} />)}
              </div>
            )}
          </div>
        </main>

        <aside className={cx("hidden w-64 flex-col border-l md:flex", isDark ? "border-brand-line bg-brand-deep" : "border-brand-mist bg-brand-cream")}>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <SignQueue current={signIdx} isDark={isDark} />
            <Card isDark={isDark} className="p-4">
              <SectionLabel isDark={isDark}>Esta sesión</SectionLabel>
              <div className="mt-3 grid grid-cols-2 gap-3 text-center">
                <Stat value={correct} label="Detectadas" isDark={isDark} />
                <Stat value={total - correct} label="Saltadas" isDark={isDark} />
              </div>
            </Card>
          </div>
          <div className={cx("flex items-center justify-center gap-4 border-t px-6 py-4", isDark ? "border-brand-line bg-brand-deep/90" : "border-brand-mist bg-brand-cream/90")}>
            <button onClick={() => navigate("/dashboard")} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-white text-brand-muted shadow-sm")}>
              <Icon name="x" className="h-4 w-4" />Terminar
            </button>
            <button onClick={skipSign} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>
              Saltar<Icon name="arrow" className="h-4 w-4" />
            </button>
          </div>
        </aside>
      </div>

      {/* Controles móvil */}
      <div className={cx("md:hidden flex items-center justify-between gap-2 border-t px-4 py-3 sm:gap-3 sm:px-6", isDark ? "border-brand-line bg-brand-deep/90" : "border-brand-mist bg-brand-cream/90")}>
        <button onClick={() => navigate("/dashboard")} className={cx("btn-press flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold sm:px-4", isDark ? "bg-brand-card text-brand-soft" : "bg-white text-brand-muted shadow-sm")}>
          <Icon name="x" className="h-4 w-4" /><span className="hidden sm:inline">Terminar</span><span className="sm:hidden">Salir</span>
        </button>
        <div className="text-center flex-1">
          <div className={cx("text-xs font-bold truncate", isDark ? "text-white" : "text-brand-ink")}>{signsQueue[signIdx].name}</div>
          <div className={cx("text-[10px]", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{correct}/{total} detectadas</div>
        </div>
        <button onClick={skipSign} className={cx("btn-press flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold sm:px-4", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>
          Saltar<Icon name="arrow" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function HandGuide({ isDark }) {
  return <svg width="180" height="200" viewBox="0 0 180 200" fill="none" className="animate-hand-pulse opacity-20"><path d="M90 20C60 20 40 50 40 80V140C40 160 55 180 90 180C125 180 140 160 140 140V80C140 50 120 20 90 20Z" stroke={isDark ? "#2AABB8" : "#0D5C6F"} strokeWidth="2" strokeDasharray="8 4" /><path d="M70 80C70 70 75 60 80 55M90 75V48M110 80C110 70 105 60 100 55M125 90C128 82 130 75 128 70" stroke={isDark ? "#2AABB8" : "#0D5C6F"} strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function Toast({ toast, isDark }) {
  const styles = {
    info: isDark ? "bg-brand-line text-[#D4EEF4]" : "bg-[#A8CDD6] text-[#1A3A42]",
    success: isDark ? "bg-[#1A6B4A] text-[#D4F5E4]" : "bg-brand-mint text-[#1A4A32]",
    warning: isDark ? "bg-[#8B5A2B] text-[#FDE8D4]" : "bg-brand-orange text-[#5A3A1A]"
  };
  return <div className={cx("animate-toast-in rounded-lg px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-sm", styles[toast.type])}>{toast.message}</div>;
}

const DIFF_COLORS = {
  "Fácil":   { bg: "bg-green-500/20",  text: "text-green-400" },
  "Media":   { bg: "bg-brand-orange/20", text: "text-brand-orange" },
  "Difícil": { bg: "bg-[#D96B6B]/20",  text: "text-[#D96B6B]" },
};

function SignQueue({ current, isDark }) {
  const windowStart = Math.max(0, current - 1);
  const windowEnd   = Math.min(signsQueue.length, current + 6);
  const visible     = signsQueue.slice(windowStart, windowEnd);

  return (
    <Card isDark={isDark} className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel isDark={isDark}>Cola de práctica</SectionLabel>
        <span className={cx("text-[10px] font-bold", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>
          {current + 1}/{signsQueue.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.map((sign, vi) => {
          const i = windowStart + vi;
          const isCurrent = i === current;
          const isDone    = i < current;
          const diff      = DIFF_COLORS[sign.difficulty] || DIFF_COLORS["Media"];
          return (
            <div
              key={`${sign.name}-${i}`}
              className={cx(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 transition-all",
                isCurrent
                  ? isDark ? "border border-brand-cyan/40 bg-brand-teal/25" : "border border-brand-teal/30 bg-brand-teal/10"
                  : isDone
                  ? isDark ? "opacity-40 bg-brand-deep/20" : "opacity-40 bg-brand-cream/40"
                  : isDark ? "bg-brand-deep/30" : "bg-brand-cream/60"
              )}
            >
              <span className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold",
                isDone    ? "bg-brand-teal text-white" :
                isCurrent ? "bg-brand-orange text-white" :
                isDark    ? "bg-brand-deep text-[#5A8A94]" : "bg-[#E8EEEF] text-[#8AA8B0]"
              )}>
                {isDone ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx("block text-xs font-bold truncate", isDark ? "text-white" : "text-brand-ink")}>{sign.name}</span>
                <span className={cx("block text-[10px]", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{sign.module}</span>
              </span>
              <span className={cx("rounded-full px-1.5 py-0.5 text-[9px] font-bold shrink-0", diff.bg, diff.text)}>
                {sign.difficulty}
              </span>
            </div>
          );
        })}
      </div>
      {windowEnd < signsQueue.length && (
        <p className={cx("mt-2 text-center text-[10px]", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>
          +{signsQueue.length - windowEnd} señas más…
        </p>
      )}
    </Card>
  );
}

function SessionControls({ isDark, recording, onToggle, onEnd }) {
  return <div className={cx("flex items-center justify-center gap-4 border-t px-6 py-4 backdrop-blur-xl", isDark ? "border-brand-line bg-brand-deep/90" : "border-brand-mist bg-brand-cream/90")}><button type="button" onClick={onEnd} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-white text-brand-muted shadow-sm")}><Icon name="x" className="h-4 w-4" />Terminar</button><button type="button" onClick={onToggle} className={cx("btn-press relative flex h-16 w-16 items-center justify-center rounded-full", recording ? "bg-[#D96B6B]" : isDark ? "bg-brand-cyan" : "bg-brand-teal")}><span className="h-5 w-5 rounded-sm bg-white" /></button><button type="button" onClick={onToggle} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>Siguiente<Icon name="arrow" className="h-4 w-4" /></button></div>;
}

function Stat({ value, label, isDark }) {
  return <div><div className={cx("text-xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{value}</div><div className={cx("text-[10px] font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{label}</div></div>;
}

function ConfigErrorPage({ isDark }) {
  return (
    <div className={cx("flex min-h-screen items-center justify-center px-6", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <div className={cx("w-full max-w-lg rounded-2xl border p-6 text-center", isDark ? "border-brand-line bg-brand-card text-white" : "border-brand-mist bg-white text-brand-ink")}>
        <Logo isDark={isDark} compact />
        <h1 className="mt-6 text-2xl font-extrabold">Configuracion pendiente</h1>
        <p className={cx("mt-3 text-sm leading-6", isDark ? "text-brand-soft" : "text-brand-muted")}>
          Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en las variables de entorno del deploy y vuelve a desplegar.
        </p>
      </div>
    </div>
  );
}


// ΓöÇΓöÇ useVideoFileMediaPipe: procesa un archivo de video con HandLandmarker ΓöÇΓöÇ

function useVideoFileMediaPipe({ onResults, videoFile, videoUrl, onEnded }) {

  const videoRef  = useRef(null);

  const canvasRef = useRef(null);

  const hlRef     = useRef(null);

  const rafRef    = useRef(null);

  const offRef    = useRef(null);

  const dbgFrameRef = useRef(-1);

  const [ready, setReady]   = useState(false);

  const [error, setError]   = useState(null);

  const [frameReady, setFrameReady] = useState(0);

  const [playing, setPlaying] = useState(false);

  const [handCount, setHandCount] = useState(0);



  // Inicializar HandLandmarker una vez

  useEffect(() => {

    let cancelled = false;

    async function init() {

      try {

        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

        if (cancelled) return;

        // Primero intentar GPU; si falla, usar CPU
        let hl = null;
        for (const delegate of ["GPU", "CPU"]) {
          try {
            hl = await HandLandmarker.createFromOptions(vision, {

              baseOptions: { modelAssetPath: HAND_MODEL, delegate },

              runningMode: "VIDEO",

              numHands: 2,

              minHandDetectionConfidence: 0.15,

              minHandPresenceConfidence: 0.15,

              minTrackingConfidence: 0.15,

            });
            console.log(`[MP] HandLandmarker usando delegate: ${delegate}`);
            break;
          } catch (err) {
            console.warn(`[MP] delegate ${delegate} fall├│:`, err.message);
          }
        }

        if (!hl) throw new Error("No se pudo inicializar HandLandmarker");

        if (cancelled) { hl.close(); return; }

        hlRef.current = hl;

        setReady(true);

      } catch (e) { if (!cancelled) setError(e.message); }

    }

    init();

    return () => {

      cancelled = true;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      hlRef.current?.close();

    };

  }, []);



  // Cargar archivo de video o URL cuando cambia

  useEffect(() => {

    const vid = videoRef.current;

    if (!vid) return;

    let objectUrl = null;

    const onLoadedData = () => {
      setFrameReady((v) => v + 1);
      console.log(`[VIDEO] frame listo: ${vid.videoWidth}x${vid.videoHeight}`);
    };
    vid.addEventListener('loadeddata', onLoadedData);

    if (videoUrl) {

      vid.src = videoUrl;

      vid.load();

      setPlaying(false);

    } else if (videoFile) {

      objectUrl = URL.createObjectURL(videoFile);

      vid.src = objectUrl;

      vid.load();

      setPlaying(false);

    } else {

      vid.src = '';

    }

    return () => {
      vid.removeEventListener('loadeddata', onLoadedData);
      vid.src = '';
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

  }, [videoFile, videoUrl]);



  // Loop de detecci├│n: corre siempre, solo procesa cuando video est├í activo

  useEffect(() => {

    const vid = videoRef.current;

    const canvas = canvasRef.current;

    if (!ready || !vid || !canvas) return;



    let stopped = false;

    function detect() {

      if (stopped) return;

      // Procesar mientras el video tenga un frame disponible (aunque est├⌐ pausado)

      if (vid.readyState >= 2 && vid.videoWidth > 0) {

        const w = vid.videoWidth;

        const h = vid.videoHeight;

        // El canvas visible usa las dimensiones intr├¡nsecas del video para alinear landmarks
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');

        // Limpiar canvas transparente (el video se ve por debajo)

        ctx.clearRect(0, 0, w, h);

        // Superponer landmarks

        if (hlRef.current) {

          const now = performance.now();

          const draw = new DrawingUtils(ctx);

          // Recorte cuadrado central ampliado: agranda las manos para que MediaPipe las detecte
          // en videos de cuerpo completo. Los landmarks se remapean al cuadro completo.
          const cropSize = Math.min(w, h);
          const cropX = (w - cropSize) / 2;
          const cropY = (h - cropSize) / 2;
          const S = 640; // resoluci├│n cuadrada de proceso
          if (!offRef.current) offRef.current = document.createElement('canvas');
          const off = offRef.current;
          off.width = S; off.height = S;
          const octx = off.getContext('2d');
          octx.drawImage(vid, cropX, cropY, cropSize, cropSize, 0, 0, S, S);

          const handRes = hlRef.current.detectForVideo(off, now);

          const lmsList = handRes.landmarks || [];

          setHandCount(lmsList.length);

          // Diagn├│stico throttled (cada ~1s)
          if (Math.floor(now / 1000) !== dbgFrameRef.current) {
            dbgFrameRef.current = Math.floor(now / 1000);
            console.log(`[VIDEO] rs=${vid.readyState} ${vid.videoWidth}x${vid.videoHeight} crop=${Math.round(cropSize)} manos=${lmsList.length} t=${vid.currentTime.toFixed(1)}`);
          }

          // Remapear landmarks del recorte al cuadro completo (normalizado 0..1)
          const remap = (lm) => ({
            ...lm,
            x: (cropX + lm.x * cropSize) / w,
            y: (cropY + lm.y * cropSize) / h,
          });
          const remapped = lmsList.map((lms) => lms.map(remap));

          for (const lms of remapped) {

            draw.drawConnectors(lms, HandLandmarker.HAND_CONNECTIONS, { color: '#00FFFF', lineWidth: 5 });

            draw.drawLandmarks(lms, { color: '#FF6600', lineWidth: 2, radius: 7 });

          }

          if (onResults) onResults({ handRes: { ...handRes, landmarks: remapped } });

        }

      }

      rafRef.current = requestAnimationFrame(detect);

    }



    const onPlay  = () => { setPlaying(true);  };

    const onPause = () => { setPlaying(false); };

    const onEnd   = () => { setPlaying(false); onEnded?.(); };

    vid.addEventListener('play',  onPlay);

    vid.addEventListener('pause', onPause);

    vid.addEventListener('ended', onEnd);

    rafRef.current = requestAnimationFrame(detect);

    return () => {

      stopped = true;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      vid.removeEventListener('play',  onPlay);

      vid.removeEventListener('pause', onPause);

      vid.removeEventListener('ended', onEnd);

    };

  }, [ready, frameReady, onResults, onEnded, videoFile, videoUrl]);



  return { videoRef, canvasRef, ready, error, playing, handCount };

}



// ΓöÇΓöÇ Helpers para auto-entrenamiento desde video ΓöÇΓöÇ

function segmentFrames(frames, { motionStart = 0.18, stillFrames = 10, minSegLen = 8 } = {}) {
  const feats = frames.map(f => featureFromFingerStates(f.fingerStates));
  const dist = (a, b) => {
    let s = 0; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  };
  const segments = [];
  let active = false, seg = [], stillCnt = 0, prev = null;
  for (let i = 0; i < frames.length; i++) {
    const feat = feats[i];
    if (!feat) { prev = null; continue; }
    const motion = prev ? dist(feat, prev) : 0;
    prev = feat;
    if (motion > motionStart) {
      if (!active) { active = true; seg = []; stillCnt = 0; }
      stillCnt = 0; seg.push(frames[i]);
    } else if (active) {
      seg.push(frames[i]); stillCnt++;
      if (stillCnt >= stillFrames) {
        const clean = seg.slice(0, seg.length - stillFrames);
        if (clean.length >= minSegLen) segments.push(clean);
        active = false; seg = []; stillCnt = 0;
      }
    }
  }
  if (active && seg.length >= minSegLen) segments.push(seg);
  if (segments.length === 0 && frames.length >= minSegLen) segments.push(frames);
  return segments;
}

function signInfoFromFilename(filename) {
  const base = (filename || '').replace(/\.[^.]+$/, '').trim();
  const clean = base.replace(/[\s_-]*\(?\d+\)?$/, '').trim() || base;
  const sign = clean.toUpperCase();
  const category = /^\d+$/.test(sign) ? 'numeros' : 'palabras';
  return { sign, category };
}

// Convierte ruta absoluta del proyecto a URL p├║blica si est├í en public/
function pathToPublicUrl(absPath) {
  if (!absPath) return null;
  const lower = absPath.toLowerCase().replace(/\\/g, '/');
  const idx = lower.indexOf('/senas-a-voces/public/');
  if (idx >= 0) return absPath.slice(idx + '/senas-a-voces/public'.length).replace(/\\/g, '/');
  return null;
}

async function reloadDynamicPatterns() {
  dynamicDetector.clearPatterns();
  const bust = `?t=${Date.now()}`;
  try {
    const manifestRes = await fetch('/api/training-data/manifest' + bust);
    if (!manifestRes.ok) throw new Error(`No se pudo cargar manifest (${manifestRes.status})`);
    const man = await manifestRes.json();

    // Cargar todas las se├▒as en paralelo: cada se├▒a intenta _1.._20
    // simultaneamente. Formato principal: .npy (binario, m├ís eficiente).
    const tasks = [];
    for (const [cat, signs] of Object.entries(man)) {
      if (!Array.isArray(signs)) continue;
      for (const sign of signs) {
        for (let n = 1; n <= 20; n++) {
          tasks.push(
            fetch(`/api/training-data/${cat}/${sign}_${n}.npy${bust}`)
              .then(res => {
                if (res.ok) return res.arrayBuffer().then(buf => {
                  const parsed = parseNpy(buf);
                  const frames = npyToFrames(parsed);
                  return { sign, data: frames };
                });
                // Fallback: intentar .json si no hay .npy
                return fetch(`/api/training-data/${cat}/${sign}_${n}.json${bust}`)
                  .then(r2 => r2.ok ? r2.json().then(data => ({ sign, data })) : null)
                  .catch(() => null);
              })
              .catch(() => null)
          );
        }
      }
    }
    const results = await Promise.all(tasks);
    let loaded = 0;
    for (const r of results) {
      if (r) { dynamicDetector.loadPattern(r.sign, r.data); loaded++; }
    }
    console.log(`[DYNAMIC] ${loaded} secuencias cargadas`);
  } catch (e) { console.warn('[DYNAMIC] reload error:', e); }
  return dynamicDetector.getStatus().patternsLoaded;
}

// ΓöÇΓöÇ DebugPage: diagn├│stico visual de fingerStates + scores ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const ALL_SIGNS = [

  ...LSM_ALPHABET.map(([l, tpl]) => ({ name: l, template: tpl, group: 'Abecedario' })),

  ...['1','2','3','4','5','6','7','8','9'].map(n => ({ name: n, template: NUMBER_TEMPLATES[n] || '?????', group: 'N├║meros' })),

];



// Panel compartido: dedos + extras + scores

function DebugPanel({ states, scores, filterG, setFilterG, isDark, shown }) {

  const FINGERS   = ['thumb','index','middle','ring','pinky'];

  const FINGER_ES = { thumb:'Pulgar', index:'├ìndice', middle:'Medio', ring:'Anular', pinky:'Me├▒ique' };

  return (

    <>

      {/* Estado de dedos */}

      <div className='mt-4 grid grid-cols-5 gap-2'>

        {FINGERS.map(f => {

          const ext = states?.[f];

          return (

            <div key={f} className={cx('flex flex-col items-center gap-1 rounded-xl p-2',

              ext === true  ? 'bg-green-500/20 ring-1 ring-green-400' :

              ext === false ? 'bg-red-500/10 ring-1 ring-red-400/40' :

              isDark ? 'bg-brand-deep' : 'bg-brand-cream'

            )}>

              <span className='text-lg'>{ext === true ? '≡ƒƒó' : ext === false ? '≡ƒö┤' : 'ΓÜ¬'}</span>

              <span className={cx('text-[10px] font-bold text-center leading-tight', isDark ? 'text-[#8AA8B0]' : 'text-brand-muted')}>{FINGER_ES[f]}</span>

              <span className={cx('text-[10px] font-mono', ext === true ? 'text-green-400' : 'text-red-400/70')}>{ext === true ? 'E' : ext === false ? 'C' : '?'}</span>

            </div>

          );

        })}

      </div>



      {/* Extras booleanos */}

      {states && (

        <div className='mt-3 grid grid-cols-2 gap-1'>

          {[

            ['Pu├▒o', states.fistTight], ['Palma plana', states.palmFlat],

            ['Pulgar lateral', states.thumbOut], ['PulgarΓåö├¡ndice', states.thumbTouchIndex],

            ['PulgarΓåömedio', states.thumbTouchMiddle], ['Mano arriba', states.handUp],

            ['Mano abajo', states.handDown], ['Palma a c├ímara', states.palmFacingCamera],

            ['UV juntos', states.uvClose], ['UV separados', states.uvSpread],

            ['UV cruzados', states.uvTouching],

          ].map(([lbl, val]) => (

            <div key={lbl} className={cx('flex items-center justify-between rounded-lg px-2 py-1 text-[10px]',

              val ? (isDark ? 'bg-brand-teal/20' : 'bg-brand-teal/10') : (isDark ? 'bg-brand-deep' : 'bg-brand-cream')

            )}>

              <span className={isDark ? 'text-[#8AA8B0]' : 'text-brand-muted'}>{lbl}</span>

              <span className={cx('font-bold', val ? 'text-green-400' : isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]')}>{val ? 'S├ì' : 'no'}</span>

            </div>

          ))}

        </div>

      )}



      {/* Ranking de scores */}

      <div className='mt-4'>

        <div className='mb-2 flex gap-1'>

          {['Todos','Abecedario','N├║meros'].map(g => (

            <button key={g} onClick={() => setFilterG(g)}

              className={cx('rounded-lg px-2 py-0.5 text-[10px] font-bold transition',

                filterG === g ? 'bg-brand-teal text-white' : isDark ? 'bg-brand-deep text-[#5A8A94]' : 'bg-brand-cream text-brand-muted'

              )}>{g}</button>

          ))}

        </div>

        <div className='space-y-0.5 max-h-52 overflow-y-auto'>

          {shown.length === 0 && <p className={cx('py-4 text-center text-xs', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Sin mano detectadaΓÇª</p>}

          {shown.map(({ name, score, template }) => {

            const pct = Math.round(score * 100);

            const isMatch = score >= MATCH_THR;

            return (

              <div key={name} className={cx('flex items-center gap-2 rounded-lg px-2 py-1',

                isMatch ? (isDark ? 'bg-green-900/30 ring-1 ring-green-500/40' : 'bg-green-50 ring-1 ring-green-300') :

                isDark ? 'bg-brand-deep/40' : 'bg-brand-cream'

              )}>

                <span className={cx('w-6 text-center font-extrabold text-sm shrink-0', isDark ? 'text-white' : 'text-brand-ink')}>{name}</span>

                <span className={cx('font-mono text-[9px] w-12 shrink-0', isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]')}>{template}</span>

                <div className={cx('flex-1 h-1.5 rounded-full overflow-hidden', isDark ? 'bg-brand-deep' : 'bg-brand-mist')}>

                  <div className={cx('h-full rounded-full transition-all duration-100',

                    isMatch ? 'bg-green-400' : score > 0.45 ? 'bg-brand-orange' : 'bg-[#2AABB8]/50'

                  )} style={{ width: `${pct}%` }} />

                </div>

                <span className={cx('w-8 text-right text-[10px] font-bold shrink-0',

                  isMatch ? 'text-green-400' : score > 0.45 ? 'text-brand-orange' : isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]'

                )}>{pct}%</span>

              </div>

            );

          })}

        </div>

      </div>

    </>

  );

}



function DebugPage({ isDark, navigate, videoOnly = false }) {

  const [tab, setTab]         = useState(videoOnly ? 'video' : 'cam');    // 'cam' | 'video'

  const [states, setStates]   = useState(null);

  const [scores, setScores]   = useState([]);

  const [best, setBest]       = useState(null);

  const [filterG, setFilterG] = useState('Todos');

  const [videoFile, setVideoFile] = useState(null);

  const [videoUrl, setVideoUrl] = useState('');

  const [signTitle, setSignTitle] = useState('');

  const [speed, setSpeed]     = useState(0.5);      // velocidad de reproducci├│n

  const fileInputRef = useRef(null);

  // Auto-entrenamiento
  const [autoTrain, setAutoTrain] = useState(!videoOnly);
  const [trainStatus, setTrainStatus] = useState('idle');
  const [trainMsg, setTrainMsg] = useState('');
  const [patternsLoaded, setPatternsLoaded] = useState([]);
  const [dynamicSign, setDynamicSign] = useState(null);
  const [onnxSign, setOnnxSign] = useState(null);
  const [onnxTop5, setOnnxTop5] = useState([]);
  const [onnxReady, setOnnxReady] = useState(false);
  const dynamicCandidateRef = useRef(null);
  const autoFramesRef = useRef([]);
  const autoTrainRef = useRef(true);
  const onnxFramesRef = useRef([]); // buffer de frames crudos para ONNX
  const onnxFrameCountRef = useRef(0);
  autoTrainRef.current = autoTrain;

  useEffect(() => {
    reloadDynamicPatterns().then(setPatternsLoaded);
    initClassifier().then(setOnnxReady);
  }, []);

  const trainInfo = useMemo(() => {
    const source = signTitle.trim() || (videoFile ? videoFile.name : (videoUrl ? videoUrl.split('/').pop() : ''));
    return source ? signInfoFromFilename(source) : null;
  }, [videoFile, videoUrl, signTitle]);
  const trainInfoRef = useRef(null);
  trainInfoRef.current = trainInfo;

  const handleResults = useCallback(({ handRes }) => {

    const { right, left } = splitHands(handRes);
    const lms = right || left;

    if (!lms) { setStates(null); setScores([]); setBest(null); return; }

    const s = fingerStates(lms);

    setStates(s);

    const all = ALL_SIGNS.map(({ name, template }) => ({

      name, template,

      score: Math.min(1, scoreLetter(s, template, name)),

    })).sort((a, b) => b.score - a.score);

    setScores(all);

    setBest(all[0]?.score >= 0.50 ? all[0].name : null);

    // Captura de frames del video (auto-entrenamiento o clasificaci├│n al terminar)
    if ((autoTrainRef.current && trainInfoRef.current) || videoOnly) {
      autoFramesRef.current.push({
        fingerStates: s,
        landmarksRight: right ? right.map(p => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) })) : null,
        landmarksLeft: left ? left.map(p => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) })) : null,
      });
    }

    // Detecci├│n din├ímica en vivo (solo c├ímara / diagn├│stico).
    if (!videoOnly) {
      dynamicDetector.pushFrameInfo(frameInfo(right, left));
      const dyn = dynamicDetector.detect();
      if (dyn?.accepted) dynamicCandidateRef.current = { name: dyn.matched, score: dyn.score };
      setDynamicSign(dyn?.matched || null);

      // Clasificador ONNX (LSTM+Attention) ΓÇö paralelo al DTW
      if (onnxReady && (right || left)) {
        onnxFramesRef.current.push({
          landmarksRight: right ? right.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
          landmarksLeft: left ? left.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
        });
        if (onnxFramesRef.current.length > 60) onnxFramesRef.current.shift();
        onnxFrameCountRef.current++;
        // Ejecutar cada 10 frames (~3 veces/seg) con los ├║ltimos 24-60 frames
        if (onnxFrameCountRef.current % 10 === 0 && onnxFramesRef.current.length >= 8) {
          const frames = onnxFramesRef.current.slice(-60);
          classifySequence(frames).then(result => {
            if (result) {
              setOnnxSign(result.top1);
              setOnnxTop5(result.top5);
              // Si confianza > 0.7, limpiar buffer para siguiente deteccion
              if (result.confidence > 0.7) {
                onnxFramesRef.current = [];
              }
            }
          });
        }
      }
    }

  }, [videoOnly, onnxReady]);



  // Auto-entrenamiento: enviar frames al terminar el video
  const finishAutoTrain = useCallback(async () => {
    const info = trainInfoRef.current;
    const frames = autoFramesRef.current;
    if (!info || frames.length === 0) {
      setTrainStatus('error');
      setTrainMsg('No se capturaron frames con mano. Verifica que se vean las manos en el video.');
      return;
    }
    setTrainStatus('training');
    setTrainMsg(`Segmentando ${frames.length} framesΓÇª`);
    const examples = segmentFrames(frames);
    if (examples.length === 0) {
      setTrainStatus('error');
      setTrainMsg('No se detect├│ movimiento suficiente para segmentar la se├▒a.');
      return;
    }
    try {
      const res = await fetch('/api/train-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signName: info.sign, category: info.category, examples }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'error desconocido');
      const loaded = await reloadDynamicPatterns();
      setPatternsLoaded(loaded);
      setTrainStatus('done');
      setTrainMsg(`Γ£à "${info.sign}" entrenada ┬╖ ${data.saved} ejemplo(s) ┬╖ categor├¡a ${info.category}`);
    } catch (e) {
      setTrainStatus('error');
      setTrainMsg('Error al guardar: ' + e.message);
    }
  }, []);

  const finishVideoRecognition = useCallback(() => {
    const frames = autoFramesRef.current;
    if (!frames || frames.length === 0) { setDynamicSign(null); return; }
    const segments = segmentFrames(frames);
    const sequences = segments
      .map(seg => buildSequence(seg.map(f => frameInfo(f.landmarksRight, f.landmarksLeft)).filter(Boolean)))
      .filter(seq => seq.length > 0);
    const result = dynamicDetector.classifySequences(sequences);
    setDynamicSign(result?.accepted ? result.matched : 'No estoy seguro: entrena m├ís ejemplos');
  }, []);

  // Modo c├ímara (solo activo en pesta├▒a c├ímara para no competir con el video por la GPU)

  const cam = useCameraMediaPipe({ onResults: tab === 'cam' ? handleResults : undefined, enabled: tab === 'cam' });

  // Modo video

  const vid = useVideoFileMediaPipe({
    onResults: tab === 'video' ? handleResults : undefined,
    videoFile,
    videoUrl: videoUrl || undefined,
    onEnded: autoTrain ? finishAutoTrain : videoOnly ? finishVideoRecognition : undefined,
  });

  // Al cambiar de video: reiniciar captura y reproducir en auto-entrenamiento
  useEffect(() => {
    if (!videoFile && !videoUrl) { setTrainStatus('idle'); setTrainMsg(''); return; }
    autoFramesRef.current = [];
    dynamicDetector.clearBuffer();
    dynamicCandidateRef.current = null;
    setDynamicSign(null);
    setTrainStatus(autoTrain ? 'recording' : 'idle');
    setTrainMsg(autoTrain ? 'Capturando la se├▒a mientras se reproduceΓÇª' : '');
  }, [videoFile, videoUrl, autoTrain]);

  useEffect(() => {
    if (tab === 'video' && (videoFile || videoUrl) && autoTrain && vid.ready && vid.videoRef.current) {
      autoFramesRef.current = [];
      vid.videoRef.current.currentTime = 0;
      vid.videoRef.current.play().catch(() => {});
    }
  }, [videoFile, videoUrl, autoTrain, tab, vid.ready]);



  const shown = filterG === 'Todos' ? scores : scores.filter(s => {

    const sg = ALL_SIGNS.find(x => x.name === s.name)?.group;

    return sg === filterG;

  });



  // Ajustar velocidad del video

  useEffect(() => {

    if (vid.videoRef.current) vid.videoRef.current.playbackRate = speed;

  }, [speed, vid.videoRef]);



  return (

    <div className={cx('min-h-screen transition-colors', isDark ? 'bg-brand-deep' : 'bg-brand-cream')}>

      {/* Sub-toolbar */}

      <div className={cx('flex items-center justify-between border-b px-6 py-3 gap-4 flex-wrap', isDark ? 'border-brand-line bg-brand-card' : 'border-brand-mist bg-white')}>

        <span className={cx('text-lg font-extrabold shrink-0', isDark ? 'text-white' : 'text-brand-ink')}>🔬 Diagnóstico LSM</span>

        <div className='flex gap-2 flex-wrap items-center'>

          {!videoOnly && (
            <div className={cx('flex rounded-lg overflow-hidden border', isDark ? 'border-brand-line' : 'border-brand-mist')}>

              {[['cam','📷 Cámara'],['video','🎬 Video']].map(([t, lbl]) => (

                <button key={t} onClick={() => { setTab(t); setStates(null); setScores([]); setBest(null); }}

                  className={cx('px-3 py-1 text-xs font-bold transition',

                    tab === t ? 'bg-brand-teal text-white' : isDark ? 'bg-brand-deep text-brand-soft' : 'bg-white text-brand-muted'

                  )}>{lbl}</button>

              ))}

            </div>
          )}

        </div>

      </div>



      <div className='mx-auto max-w-7xl px-4 py-6 grid gap-4 lg:grid-cols-12'>



        {/* Panel izquierdo: visor */}

        <div className='lg:col-span-6'>

          <Card isDark={isDark}>



            {/* ΓöÇΓöÇ TAB C├üMARA ΓöÇΓöÇ */}

            {tab === 'cam' && (

              <>

                <SectionLabel isDark={isDark}>C├ímara en vivo</SectionLabel>

                <div className='relative mt-3 overflow-hidden rounded-xl bg-black' style={{ aspectRatio: '4/3' }}>

                  <video ref={cam.videoRef} className='absolute inset-0 h-full w-full object-cover opacity-0' playsInline muted />

                  <canvas ref={cam.canvasRef} className='absolute inset-0 h-full w-full object-cover' />

                  {best && (

                    <div className='absolute bottom-4 left-1/2 -translate-x-1/2 rounded-2xl bg-green-600/90 px-6 py-2 text-center backdrop-blur'>

                      <div className='text-[10px] font-bold uppercase tracking-widest text-green-200'>Detectando</div>

                      <div className='text-4xl font-extrabold text-white'>{best}</div>

                    </div>

                  )}

                  {!cam.camReady && !cam.camError && (

                    <div className='absolute inset-0 flex items-center justify-center'>

                      <span className={cx('text-xs animate-pulse', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Iniciando c├ímaraΓÇª</span>

                    </div>

                  )}

                </div>

              </>

            )}



            {/* ΓöÇΓöÇ TAB VIDEO ΓöÇΓöÇ */}

            {tab === 'video' && (

              <>

                <div className='flex items-center justify-between'>

                  <SectionLabel isDark={isDark}>Video de entrenamiento</SectionLabel>

                  <button onClick={() => fileInputRef.current?.click()}

                    className='rounded-lg bg-brand-teal px-3 py-1 text-xs font-bold text-white hover:bg-brand-cyan transition'>

                    ≡ƒôé Cargar video

                  </button>

                  <input ref={fileInputRef} type='file' accept='video/*' className='hidden'

                    onChange={e => { if (e.target.files[0]) { setVideoFile(e.target.files[0]); setVideoUrl(''); } }} />

                </div>



                {/* ΓöÇΓöÇ Cargar por ruta / URL ΓöÇΓöÇ */}
                <div className='mt-3 flex gap-2'>
                  <input
                    type='text'
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder='URL relativa, ej. /videos/QUE_MILAGRO.mp4'
                    className={cx('flex-1 rounded-lg border px-3 py-2 text-xs', isDark ? 'border-brand-line bg-brand-deep text-white placeholder:text-[#5A8A94]' : 'border-brand-mist bg-white text-brand-ink placeholder:text-[#8AA8B0]')}
                  />
                  <button
                    onClick={() => { setVideoFile(null); }}
                    disabled={!videoUrl}
                    className={cx('rounded-lg px-3 py-2 text-xs font-bold', videoUrl ? 'bg-brand-teal text-white' : 'bg-gray-200 text-gray-400')}
                  >Cargar URL</button>
                </div>

                {videoOnly && (
                  <div className={cx('mt-3 rounded-xl border p-3', isDark ? 'border-brand-line bg-brand-deep/50' : 'border-brand-mist bg-white')}>
                    <label className={cx('block text-xs font-bold', isDark ? 'text-white' : 'text-brand-ink')}>Nombre de la se├▒a para entrenar</label>
                    <div className='mt-2 flex gap-2'>
                      <input
                        type='text'
                        value={signTitle}
                        onChange={(e) => setSignTitle(e.target.value)}
                        placeholder='Ejemplo: SORPRESA'
                        className={cx('flex-1 rounded-lg border px-3 py-2 text-xs uppercase', isDark ? 'border-brand-line bg-brand-deep text-white placeholder:text-[#5A8A94]' : 'border-brand-mist bg-white text-brand-ink')}
                      />
                      <button
                        onClick={() => setAutoTrain((enabled) => !enabled)}
                        disabled={!trainInfo}
                        className={cx('rounded-lg px-3 py-2 text-xs font-bold', autoTrain ? 'bg-brand-orange text-white' : 'bg-brand-teal text-white', !trainInfo && 'opacity-40')}
                      >
                        {autoTrain ? 'Entrenar al terminar: S├¡' : 'Entrenar al terminar'}
                      </button>
                    </div>
                    <p className={cx('mt-2 text-[10px]', isDark ? 'text-[#8AA8B0]' : 'text-brand-muted')}>
                      Escribe el nombre, activa el entrenamiento y reproduce el video completo una vez. Luego desact├¡valo y repite el video para probar el reconocimiento.
                    </p>
                    {trainStatus !== 'idle' && trainMsg && <div className={cx('mt-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold', trainStatus === 'done' ? 'bg-green-500/15 text-green-400' : trainStatus === 'error' ? 'bg-red-500/15 text-red-400' : isDark ? 'bg-brand-card text-[#8AA8B0]' : 'bg-brand-cream text-brand-muted')}>{trainMsg}</div>}
                  </div>
                )}

                {/* ΓöÇΓöÇ Panel auto-entrenamiento ΓöÇΓöÇ */}
                {!videoOnly && <div className={cx('mt-3 rounded-xl border p-3', isDark ? 'border-brand-line bg-brand-deep/50' : 'border-brand-mist bg-white')}> 
                  <div className='flex items-center justify-between gap-2'>
                    <span className={cx('text-xs font-bold', isDark ? 'text-white' : 'text-brand-ink')}>≡ƒÄô Auto-entrenamiento</span>
                    <label className='flex items-center gap-1.5 cursor-pointer'>
                      <input type='checkbox' checked={autoTrain} onChange={(e) => setAutoTrain(e.target.checked)} className='accent-brand-teal' />
                      <span className={cx('text-[10px] font-bold', isDark ? 'text-[#8AA8B0]' : 'text-brand-muted')}>Entrenar al terminar</span>
                    </label>
                  </div>
                  <p className={cx('mt-1 text-[10px] leading-snug', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>
                    El video debe estar en <b>public/videos/</b> para cargarse por URL, o usa el bot├│n ≡ƒôé. Se entrena con el nombre del archivo.
                  </p>
                  {trainInfo && (
                    <div className='mt-2 flex flex-wrap items-center gap-2'>
                      <span className={cx('rounded-lg px-2 py-1 text-xs font-extrabold', isDark ? 'bg-brand-teal/20 text-brand-cyan' : 'bg-brand-teal/10 text-brand-teal')}>
                        Se├▒a: {trainInfo.sign}
                      </span>
                      <span className={cx('rounded-lg px-2 py-0.5 text-[10px] font-bold', isDark ? 'bg-brand-card text-[#8AA8B0]' : 'bg-brand-cream text-brand-muted')}>
                        {trainInfo.category}
                      </span>
                      {!autoTrain && (
                        <button onClick={finishAutoTrain}
                          className='rounded-lg bg-brand-orange px-3 py-1 text-xs font-bold text-white hover:opacity-80 transition'>
                          ≡ƒÄô Entrenar ahora
                        </button>
                      )}
                    </div>
                  )}
                  {trainStatus !== 'idle' && trainMsg && (
                    <div className={cx('mt-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold',
                      trainStatus === 'done'  ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/40' :
                      trainStatus === 'error' ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/40' :
                      trainStatus === 'training' ? 'bg-brand-orange/15 text-brand-orange ring-1 ring-brand-orange/40' :
                      isDark ? 'bg-brand-card text-[#8AA8B0]' : 'bg-brand-cream text-brand-muted'
                    )}>
                      {trainStatus === 'training' && <span className='animate-pulse'>ΓÅ│ </span>}
                      {trainMsg}
                    </div>
                  )}
                </div>}



                {!videoFile && !videoUrl ? (

                  <div

                    onClick={() => fileInputRef.current?.click()}

                    className={cx('mt-3 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer py-12',

                      isDark ? 'border-brand-line text-[#5A8A94] hover:border-brand-cyan' : 'border-brand-mist text-brand-muted hover:border-brand-teal'

                    )}>

                    <span className='text-4xl'>≡ƒÄ¼</span>

                    <span className='text-sm font-semibold'>Haz clic para seleccionar un video</span>

                    <span className='text-xs opacity-60'>MP4, MOV, WebMΓÇª</span>

                  </div>

                ) : (

                  <>

                    {/* Video con canvas superpuesto dibujando landmarks */}

                    <div className='relative mt-3 overflow-hidden rounded-xl bg-black' style={{ aspectRatio: '16/9' }}>

                      {/* video visible de fondo; canvas transparente dibuja solo landmarks encima */}

                      <video ref={vid.videoRef} className='absolute inset-0 h-full w-full object-contain z-0' playsInline muted />

                      <canvas ref={vid.canvasRef} className='absolute inset-0 h-full w-full object-contain pointer-events-none z-10' />



                      {/* Se├▒a detectada */}

                      {best && (

                        <div className='absolute top-3 left-3 rounded-xl bg-green-600/90 px-4 py-1.5 text-center backdrop-blur'>

                          <div className='text-[9px] font-bold uppercase tracking-widest text-green-200'>Est├ítica</div>

                          <div className='text-3xl font-extrabold text-white leading-none'>{best}</div>

                        </div>

                      )}

                      <div className={cx('absolute top-3 right-3 rounded-xl px-4 py-1.5 text-center backdrop-blur', dynamicSign ? 'bg-green-600/90' : 'bg-black/60')}>

                        <div className={cx('text-[9px] font-bold uppercase tracking-widest', dynamicSign ? 'text-green-200' : 'text-[#A8CDD6]')}>Detector din├ímico</div>

                        <div className='text-lg font-extrabold text-white leading-none'>{dynamicSign || (videoOnly ? 'Analizando videoΓÇª' : 'Esperando gestoΓÇª')}</div>

                        <div className='mt-1 text-[9px] text-[#D4EEF4]'>{patternsLoaded.length} se├▒a(s) entrenada(s) cargada(s)</div>

                      </div>



                      {/* Clasificador ONNX (LSTM+Attention) */}
                      <div className={cx('absolute top-20 right-3 rounded-xl px-4 py-1.5 text-center backdrop-blur', onnxSign ? 'bg-purple-600/90' : 'bg-black/60')}>
                        <div className={cx('text-[9px] font-bold uppercase tracking-widest', onnxSign ? 'text-purple-200' : 'text-[#A8CDD6]')}>LSTM+Attention</div>
                        <div className='text-lg font-extrabold text-white leading-none'>
                          {onnxReady ? (onnxSign || 'Esperando gestoΓÇª') : 'Cargando modeloΓÇª'}
                        </div>
                        {onnxTop5.length > 0 && (
                          <div className='mt-1 space-y-0.5'>
                            {onnxTop5.map((r, i) => (
                              <div key={r.name} className={cx('text-[9px]', i === 0 ? 'text-white font-bold' : 'text-purple-200')}>
                                {i + 1}. {r.name} ({(r.prob * 100).toFixed(0)}%)
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className='absolute bottom-2 right-3 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur truncate max-w-[60%] text-right'>

                        <div>{videoFile?.name || videoUrl?.split('/')?.pop() || ''}</div>

                        <div className={vid.handCount > 0 ? 'text-green-300' : 'text-red-300'}>

                          {vid.ready ? (vid.handCount > 0 ? `Manos: ${vid.handCount}` : 'Sin manos detectadas') : 'MediaPipe cargandoΓÇª'}

                        </div>

                      </div>

                    </div>



                    {/* Controles */}

                    <div className='mt-3 flex items-center gap-3'>

                      <button

                        onClick={() => {

                          const v = vid.videoRef.current;

                          if (!v || !v.src) return;

                          if (v.paused) v.play().catch(() => {}); else v.pause();

                        }}

                        className='rounded-lg bg-brand-teal px-4 py-2 text-xs font-bold text-white hover:bg-brand-cyan transition min-w-[70px]'>

                        {vid.playing ? 'ΓÅ╕ Pausar' : 'Γû╢ Play'}

                      </button>

                      <button

                        onClick={() => { const v = vid.videoRef.current; if (v) { v.currentTime = 0; v.pause(); } }}

                        className={cx('rounded-lg px-3 py-2 text-xs font-bold transition', isDark ? 'bg-brand-deep text-[#5A8A94] hover:text-white' : 'bg-brand-cream text-brand-muted')}>

                        ΓÅ« Reiniciar

                      </button>

                      <div className='flex items-center gap-2 ml-auto'>

                        <span className={cx('text-[10px] shrink-0', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Velocidad</span>

                        {[0.25, 0.5, 1].map(s => (

                          <button key={s} onClick={() => setSpeed(s)}

                            className={cx('rounded px-2 py-0.5 text-[10px] font-bold transition',

                              speed === s ? 'bg-brand-orange text-white' : isDark ? 'bg-brand-deep text-[#5A8A94]' : 'bg-brand-cream text-brand-muted'

                            )}>{s}├ù</button>

                        ))}

                      </div>

                    </div>

                    <button onClick={() => { setVideoFile(null); setStates(null); setScores([]); setBest(null); }}

                      className={cx('mt-2 w-full rounded-lg py-1 text-[10px] font-bold', isDark ? 'text-[#5A8A94] hover:text-white' : 'text-brand-muted hover:text-brand-ink')}>

                      ≡ƒùæ Cambiar video

                    </button>

                  </>

                )}

              </>

            )}



            {/* Panel de diagn├│stico est├ítico, no se muestra en la p├ígina exclusiva de videos */}

            {!videoOnly && <DebugPanel states={states} scores={scores} filterG={filterG} setFilterG={setFilterG} isDark={isDark} shown={shown} />}

          </Card>

        </div>



        {/* Panel derecho: scores completos */}

        {!videoOnly && <div className='lg:col-span-6'>

          <Card isDark={isDark}>

            <div className='flex items-center justify-between mb-3'>

              <SectionLabel isDark={isDark}>Ranking completo</SectionLabel>

              {best && <span className='rounded-full bg-green-500/20 px-3 py-1 text-xs font-extrabold text-green-400 ring-1 ring-green-500/40'>Γ£ô {best}</span>}

            </div>

            <div className='space-y-0.5 max-h-[75vh] overflow-y-auto'>

              {scores.length === 0 && (

                <p className={cx('py-12 text-center text-sm', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>

                  {tab === 'cam' ? 'Pon una mano frente a la c├ímaraΓÇª' : 'Carga un video y dale PlayΓÇª'}

                </p>

              )}

              {scores.map(({ name, score, template }) => {

                const pct = Math.round(score * 100);

                const isMatch = score >= MATCH_THR;

                const grp = ALL_SIGNS.find(x => x.name === name)?.group;

                return (

                  <div key={name} className={cx('flex items-center gap-3 rounded-lg px-3 py-1.5',

                    isMatch ? (isDark ? 'bg-green-900/30 ring-1 ring-green-500/40' : 'bg-green-50 ring-1 ring-green-300') :

                    isDark ? 'bg-brand-deep/40' : 'bg-brand-cream'

                  )}>

                    <span className={cx('w-7 text-center font-extrabold shrink-0', isDark ? 'text-white' : 'text-brand-ink')}>{name}</span>

                    <span className={cx('text-[9px] shrink-0 w-16', isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]')}>{grp}</span>

                    <span className={cx('font-mono text-[9px] shrink-0 w-12', isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]')}>{template}</span>

                    <div className={cx('flex-1 h-2 rounded-full overflow-hidden', isDark ? 'bg-brand-deep' : 'bg-brand-mist')}>

                      <div className={cx('h-full rounded-full transition-all duration-100',

                        isMatch ? 'bg-green-400' : score > 0.45 ? 'bg-brand-orange' : 'bg-[#2AABB8]/40'

                      )} style={{ width: `${pct}%` }} />

                    </div>

                    <span className={cx('w-9 text-right text-xs font-bold shrink-0',

                      isMatch ? 'text-green-400' : score > 0.45 ? 'text-brand-orange' : isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]'

                    )}>{pct}%</span>

                  </div>

                );

              })}

            </div>

          </Card>

        </div>}

      </div>

    </div>

  );

}

function App() {
  const [isDark, setIsDark] = useState(false);
  const [fontScale, setFontScale] = useState(() => {
    try { return localStorage.getItem('fontScale') || 'md'; } catch { return 'md'; }
  });
  const [path, navigate, state] = useRoute();
  const { user, loading, authConfigError } = useAuth();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    const sizes = { sm: '15px', md: '17px', lg: '19px' };
    document.documentElement.style.fontSize = sizes[fontScale] || sizes.md;
    try { localStorage.setItem('fontScale', fontScale); } catch {}
  }, [fontScale]);

  // Handle OAuth callback redirect
  useEffect(() => {
    const handleOAuthCallback = async () => {
      const hash = window.location.hash;
      if (hash.includes('access_token') || hash.includes('error')) {
        // Let Supabase handle the session restoration
        await supabase.auth.getSession();
        // The auth state change will trigger navigation
      }
    };
    
    handleOAuthCallback();
  }, []);

  // Ensure camera is stopped when navigating away from practice page
  useEffect(() => {
    const stopCamera = () => {
      // Stop all active media streams
      const videoElements = document.querySelectorAll('video');
      videoElements.forEach(video => {
        if (video.srcObject) {
          video.srcObject.getTracks().forEach(track => {
            track.stop();
          });
          video.srcObject = null;
        }
      });
    };

    if (path !== "/practice") {
      stopCamera();
    }

    return () => {
      // Also stop camera on unmount
      stopCamera();
    };
  }, [path]);

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className={`flex min-h-screen items-center justify-center ${isDark ? "bg-brand-deep" : "bg-brand-cream"}`}>
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-teal border-t-transparent"></div>
          <p className={cx(isDark ? "text-brand-soft" : "text-brand-muted")}>Cargando...</p>
        </div>
      </div>
    );
  }

  if (authConfigError) return <ConfigErrorPage isDark={isDark} />;

  // Auth pages
  if (path === "/" || path === "/login") return <AuthPage mode="login" isDark={isDark} setIsDark={setIsDark} navigate={navigate} />;
  if (path === "/signup") return <AuthPage mode="signup" isDark={isDark} setIsDark={setIsDark} navigate={navigate} />;
  if (path === "/confirm-email") return <EmailConfirmationPage isDark={isDark} setIsDark={setIsDark} navigate={navigate} email={state?.email || ""} />;

  // Developer/training pages - accessible without auth, con AppHeader uniforme
  if (path === "/debug") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <DebugPage isDark={isDark} navigate={navigate} />
    </div>
  );
  if (path === "/video-test") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <DebugPage isDark={isDark} navigate={navigate} videoOnly />
    </div>
  );
  if (path === "/model-test") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <ModelTestPage isDark={isDark} navigate={navigate} useCameraMediaPipe={useCameraMediaPipe} reloadDynamicPatterns={reloadDynamicPatterns} />
    </div>
  );
  if (path === "/train") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <TrainPage isDark={isDark} navigate={navigate} useCameraMediaPipe={useCameraMediaPipe} reloadDynamicPatterns={reloadDynamicPatterns} />
    </div>
  );
  if (path === "/training-viewer") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <TrainingViewerPage isDark={isDark} navigate={navigate} />
    </div>
  );
  if (path === "/retrain") return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <RetrainPage isDark={isDark} navigate={navigate} />
    </div>
  );

  // Protected routes - redirect to login if not authenticated
  if (!user) {
    navigate("/");
    return null;
  }

  // Protected pages - todas con header
  if (path === "/practice") {
    return (
      <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-[#F8F5EE]")}>
        <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
        <PracticePage isDark={isDark} setIsDark={setIsDark} navigate={navigate} />
      </div>
    );
  }
  
  if (path === "/dashboard") {
    return (
      <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-[#F8F5EE]")}>
        <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
        <DashboardPage isDark={isDark} navigate={navigate} />
      </div>
    );
  }
  
  if (path === "/learn") {
    return (
      <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-[#F8F5EE]")}>
        <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
        <LearnPage isDark={isDark} navigate={navigate} />
      </div>
    );
  }
  
  if (path === "/lesson") {
    return <LessonPage isDark={isDark} navigate={navigate} />;
  }

  return (
    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>
      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} fontScale={fontScale} setFontScale={setFontScale} />
      <DashboardPage isDark={isDark} navigate={navigate} />
    </div>
  );
}

export default App;

createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <App />
    <Analytics />
  </AuthProvider>
);
