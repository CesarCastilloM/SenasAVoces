import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

import { HandLandmarker, PoseLandmarker, FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

import { createRoot } from "react-dom/client";

import "./styles.css";

import { GLOSARIO_LESSONS, ALPHABET_LESSON } from "./lessons_glosario.js";

import { fingerStates, scoreTarget, detectBestLetter, MATCH_THR, scoreLetter, LSM_ALPHABET, NUMBER_TEMPLATES } from "./lsm_detector.js";
import { dynamicDetector, featureFromFingerStates, frameInfo, buildSequence, splitHands } from "./dynamic_sign_detector.js";
import { parseNpy, npyToFrames } from "./npy_parser.js";
import { initClassifier, classifySequence, isClassifierReady } from "./onnx_classifier.js";
import ModelTestPage from "./model_test_page.jsx";
import TrainPage from "./train_page.jsx";
import TrainingViewerPage from "./training_viewer_page.jsx";
import RetrainPage from "./retrain_page.jsx";



const navItems = [

  { path: "/", label: "Acceso" },

  { path: "/dashboard", label: "Dashboard" },

  { path: "/learn", label: "Aprender" },

  { path: "/practice", label: "Práctica" },

  { path: "/video-test", label: "Videos" },

  { path: "/model-test", label: "Probar modelo" },

  { path: "/train", label: "Entrenar" },
  { path: "/retrain", label: "Re-entrenar" },

  { path: "/training-viewer", label: "Ver entrenamiento" }

];



const modules = [ALPHABET_LESSON, ...GLOSARIO_LESSONS].map((lesson, i) => ({

  id: lesson.id,

  title: lesson.title,

  desc: `${lesson.items.length} señas · Nivel ${lesson.level}`,

  signs: lesson.items.length,

  status: i === 0 ? "current" : i < 3 ? "completed" : "locked",

  items: lesson.items,

  level: lesson.level,

}));



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

  { label: "Memoria visual", value: "Alta", detail: "Reconoces patrones de mano con buena precision." },

  { label: "Ritmo", value: "12 dias", detail: "Tu constancia desbloquea practica avanzada." },

  { label: "Siguiente foco", value: "Familia", detail: "Practica parentescos antes de pasar a comida." }

];



const dailyQuest = [

  { task: "Completa 3 senas de Familia", done: true },

  { task: "Repite una sena dificil", done: true },

  { task: "Graba una practica corta", done: false }

];



const accountActions = [

  { label: "Mi perfil", helper: "Datos y preferencias", icon: "user", path: "/dashboard" },

  { label: "Progreso", helper: "Racha y modulos", icon: "trophy", path: "/learn" },

  { label: "Practica", helper: "Abrir camara", icon: "camera", path: "/practice" },

  { label: "Cerrar sesion", helper: "Volver al acceso", icon: "lock", path: "/" }

];



const LOGO_SRC = "/logo-senas-a-voces-crop.png";



function cx(...classes) {

  return classes.filter(Boolean).join(" ");

}



function useRoute() {

  const [path, setPath] = useState(() => window.location.pathname);



  useEffect(() => {

    const onPop = () => setPath(window.location.pathname);

    window.addEventListener("popstate", onPop);

    return () => window.removeEventListener("popstate", onPop);

  }, []);



  const navigate = useCallback((to) => {

    window.history.pushState({}, "", to);

    setPath(to);

  }, []);



  return [path, navigate];

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

    x: <svg {...filled}><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" /></svg>

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



function AppHeader({ isDark, setIsDark, navigate, path }) {

  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef(null);



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



  const selectAccountAction = (to) => {

    navigate(to);

    setMenuOpen(false);

  };



  return (

    <header className={cx("app-header sticky top-0 z-40 border-b backdrop-blur-xl transition-colors", isDark ? "border-brand-line bg-brand-deep/85" : "border-brand-mist bg-brand-cream/85")}>

      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">

        <button onClick={() => navigate("/dashboard")} className="btn-press"><Logo isDark={isDark} compact /></button>

        <nav className="hidden items-center gap-1 md:flex">

          {navItems.slice(1).map((item) => (

            <button key={item.path} onClick={() => navigate(item.path)} className={cx("rounded-2xl px-3 py-2 text-xs font-bold transition", path === item.path ? (isDark ? "bg-brand-card text-white" : "bg-white text-brand-teal shadow-sm") : (isDark ? "text-brand-soft hover:bg-brand-card" : "text-brand-muted hover:bg-white"))}>

              {item.label}

            </button>

          ))}

        </nav>

        <div className="flex items-center gap-3">

          <ThemeToggle isDark={isDark} setIsDark={setIsDark} />

          <div ref={menuRef} className="relative">

            <button

              type="button"

              aria-haspopup="menu"

              aria-expanded={menuOpen}

              onClick={() => setMenuOpen((open) => !open)}

              className={cx("profile-trigger btn-press flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal text-white")}

            >

              MA

            </button>

            {menuOpen && (

              <div className={cx("account-menu", isDark ? "account-menu-dark" : "account-menu-light")} role="menu">

                <div className="account-menu-head">

                  <span className={cx("flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal text-white")}>MA</span>

                  <span>

                    <strong className={cx("block text-sm", isDark ? "text-white" : "text-brand-ink")}>Maria</strong>

                    <small className={cx("block text-xs", isDark ? "text-brand-soft" : "text-brand-muted")}>maria@senasavoces.mx</small>

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



function AuthPage({ mode, isDark, setIsDark, navigate }) {

  const isSignup = mode === "signup";

  const [showPassword, setShowPassword] = useState(false);

  const [agreed, setAgreed] = useState(false);

  const [loading, setLoading] = useState(false);



  const submit = (event) => {

    event.preventDefault();

    setLoading(true);

    setTimeout(() => navigate("/dashboard"), 700);

  };



  return (

    <div className={cx("relative min-h-screen overflow-hidden transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>

      <WaveBackground isDark={isDark} />

      <button onClick={() => setIsDark(!isDark)} className={cx("btn-press fixed right-6 top-6 z-50 rounded-xl p-2.5", isDark ? "bg-brand-card text-brand-orange" : "bg-white text-brand-teal shadow-sm")} aria-label="Cambiar tema">

        <Icon name={isDark ? "sun" : "moon"} />

      </button>

      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">

        <section className="hidden w-[55%] items-center justify-center p-12 lg:flex">

          <div className="relative max-w-lg">

            <Logo isDark={isDark} />

            <h1 className={cx("mt-8 text-4xl font-extrabold leading-tight", isDark ? "text-white" : "text-brand-ink")}>

              {isSignup ? "Únete a la" : "Aprende LSM"}<br />

              <span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>{isSignup ? "comunidad LSM" : "a tu ritmo"}</span>

            </h1>

            <p className={cx("mt-4 text-lg leading-relaxed", isDark ? "text-brand-soft" : "text-brand-muted")}>

              {isSignup ? "Crea tu cuenta gratuita y comienza con práctica inmersiva y retroalimentación inteligente." : "Únete a miles de personas que ya aprenden Lengua de Señas Mexicana con práctica inmersiva."}

            </p>

            <div className="mt-10 flex gap-8">

              {(isSignup ? [

                ["Gratis", "Para siempre"],

                ["5 min", "Por día"],

                ["IA", "Retroalimentación"]

              ] : [

                ["2,400+", "Señas enseñadas"],

                ["15K+", "Estudiantes activos"],

                ["98%", "Satisfacción"]

              ]).map(([num, label]) => (

                <div key={label}>

                  <div className={cx("text-2xl font-extrabold", isDark ? "text-brand-cyan" : "text-brand-teal")}>{num}</div>

                  <div className={cx("mt-1 text-xs font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{label}</div>

                </div>

              ))}

            </div>

          </div>

        </section>

        <section className="flex flex-1 items-center justify-center p-6 lg:p-12">

          <div className={cx("animate-float-in w-full max-w-md rounded-3xl p-8 lg:p-10", isDark ? "border border-brand-line bg-brand-card/80 backdrop-blur-xl" : "border border-gray-100 bg-white/90 shadow-2xl shadow-gray-200/50 backdrop-blur-xl")}>

            <div className="mb-8 flex justify-center lg:hidden"><Logo isDark={isDark} /></div>

            <h2 className={cx("text-2xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{isSignup ? "Crea tu cuenta" : "Bienvenido de nuevo"}</h2>

            <p className={cx("mb-8 mt-1 text-sm", isDark ? "text-brand-soft" : "text-brand-muted")}>{isSignup ? "Empieza a aprender LSM hoy mismo" : "Inicia sesión para continuar tu aprendizaje"}</p>

            <form onSubmit={submit} className="space-y-5">

              {isSignup && <Field icon="user" label="Nombre completo" placeholder="Tu nombre" isDark={isDark} />}

              <Field icon="mail" label="Correo electrónico" type="email" placeholder="tu@correo.com" isDark={isDark} />

              <Field icon="lock" label="Contraseña" type={showPassword ? "text" : "password"} placeholder={isSignup ? "Mínimo 8 caracteres" : "••••••••"} isDark={isDark} action={<button type="button" onClick={() => setShowPassword(!showPassword)} className={cx("rounded-lg p-1", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}><Icon name="eye" className="h-4 w-4" /></button>} />

              {isSignup && <Field icon="lock" label="Confirmar contraseña" type="password" placeholder="Repite tu contraseña" isDark={isDark} />}

              {isSignup ? (

                <label className="flex cursor-pointer items-start gap-2.5">

                  <input checked={agreed} onChange={(e) => setAgreed(e.target.checked)} type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-teal" />

                  <span className={cx("text-xs leading-relaxed", isDark ? "text-brand-soft" : "text-brand-muted")}>Acepto los términos de servicio y la política de privacidad.</span>

                </label>

              ) : (

                <div className="flex items-center justify-between">

                  <label className={cx("flex cursor-pointer items-center gap-2 text-xs font-medium", isDark ? "text-brand-soft" : "text-brand-muted")}><input type="checkbox" className="h-4 w-4 accent-brand-teal" />Recordarme</label>

                  <button type="button" className={cx("text-xs font-semibold", isDark ? "text-brand-cyan" : "text-brand-teal")}>¿Olvidaste tu contraseña?</button>

                </div>

              )}

              <button disabled={loading || (isSignup && !agreed)} className={cx("btn-press w-full rounded-lg py-3.5 text-sm font-bold transition", isSignup ? "bg-brand-orange text-white hover:bg-[#E08A50]" : "bg-brand-teal text-white hover:bg-[#0A4D5D]", (loading || (isSignup && !agreed)) && "cursor-not-allowed opacity-55")}>

                {loading ? "Procesando..." : isSignup ? "Crear cuenta gratis" : "Iniciar sesión"}

              </button>

            </form>

            <p className={cx("mt-8 text-center text-sm", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>

              {isSignup ? "¿Ya tienes cuenta? " : "¿No tienes cuenta? "}

              <button onClick={() => navigate(isSignup ? "/" : "/signup")} className={cx("font-bold", isDark ? "text-brand-cyan" : "text-brand-teal")}>{isSignup ? "Inicia sesión" : "Regístrate gratis"}</button>

            </p>

          </div>

        </section>

      </div>

    </div>

  );

}



function Field({ icon, label, action, isDark, ...props }) {

  return (

    <label className="block">

      <span className={cx("mb-2 block text-xs font-semibold uppercase tracking-wide", isDark ? "text-brand-soft" : "text-brand-muted")}>{label}</span>

      <span className="relative block">

        <span className={cx("absolute left-3.5 top-1/2 -translate-y-1/2", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}><Icon name={icon} className="h-4 w-4" /></span>

        <input {...props} className={cx("input-focus-ring w-full rounded-lg border py-3.5 pl-11 pr-12 text-sm font-medium transition", isDark ? "border-brand-line bg-brand-deep text-white placeholder:text-[#5A8A94]" : "border-brand-mist bg-brand-cream text-brand-ink placeholder:text-[#8AA8B0]")} />

        {action && <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{action}</span>}

      </span>

    </label>

  );

}



function Card({ isDark, className = "", children }) {

  return <div className={cx("surface-card rounded-2xl p-6", isDark ? "border border-brand-line bg-brand-card" : "border border-gray-100 bg-white shadow-sm", className)}>{children}</div>;

}



function LearningPulse({ isDark }) {

  return (

    <Card isDark={isDark} className="learning-pulse mb-6 p-8">

      <div className="flex items-start justify-between gap-6">

        <div>

          <SectionLabel isDark={isDark}>Brujula de aprendizaje</SectionLabel>

          <h2 className={cx("mt-4 text-2xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Hoy conviene practicar Familia</h2>

          <p className={cx("mt-3 max-w-2xl text-sm leading-7", isDark ? "text-brand-soft" : "text-brand-muted")}>Tu ruta detecta buena memoria visual. Manten sesiones cortas y repite las senas que mezclan parentesco y saludo.</p>

        </div>

        <span className={cx("hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl sm:flex", isDark ? "bg-brand-cyan/10 text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}><Icon name="sparkles" /></span>

      </div>

      <div className="mt-7 grid gap-3 md:grid-cols-3">

        {learningMoments.map((item) => (

          <div key={item.label} className={cx("rounded-xl border p-4", isDark ? "border-brand-line bg-brand-deep/20" : "border-brand-mist bg-white/35")}>

            <span className={cx("text-xs font-bold", isDark ? "text-brand-soft" : "text-brand-muted")}>{item.label}</span>

            <strong className={cx("mt-2 block text-xl", isDark ? "text-white" : "text-brand-ink")}>{item.value}</strong>

            <p className={cx("mt-2 text-xs", isDark ? "text-brand-soft" : "text-brand-muted")}>{item.detail}</p>

          </div>

        ))}

      </div>

    </Card>

  );

}



function QuestList({ isDark }) {

  return (

    <Card isDark={isDark}>

      <div className="mb-4 flex items-center justify-between"><SectionLabel isDark={isDark}>Reto de hoy</SectionLabel><span className={cx("rounded-full px-3 py-1 text-xs font-bold", isDark ? "bg-brand-orange/15 text-brand-orange" : "bg-brand-orange/20 text-brand-teal")}>2/3</span></div>

      <div className="space-y-4">

        {dailyQuest.map((quest) => (

          <div key={quest.task} className={cx("flex items-center gap-3 rounded-xl p-2", !quest.done && (isDark ? "bg-brand-deep/35" : "bg-brand-cream/55"))}>

            <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg", quest.done ? "bg-brand-teal text-white" : isDark ? "border border-brand-line text-brand-soft" : "border border-brand-mist text-brand-muted")}><Icon name={quest.done ? "check" : "sparkles"} className="h-4 w-4" /></span>

            <p className={cx("text-xs font-semibold", isDark ? "text-brand-soft" : "text-brand-muted")}>{quest.task}</p>

          </div>

        ))}

      </div>

    </Card>

  );

}



function Dashboard({ isDark, navigate }) {

  const activity = useMemo(() => Array.from({ length: 16 }, (_, week) => Array.from({ length: 7 }, (_, day) => (week * 3 + day * 5) % 5)), []);

  const levels = isDark ? ["#0C4A57", "#0E5F6E", "#14889A", "#1FAAB8", "#2AABB8"] : ["#E8EEEF", "#A8CDD6", "#5AADBE", "#1D7F94", "#0D5C6F"];

  return (

    <main className="mx-auto max-w-6xl px-6 py-8">

      <PageTitle isDark={isDark} title="Buenas tardes, María" accent="María" subtitle="Tu progreso de la semana va excelente" />

      <LearningPulse isDark={isDark} />

      <div className={cx("streak-banner animate-fade mb-6 flex items-center gap-4 rounded-xl border p-4", isDark ? "border-brand-line bg-brand-card/70" : "border-brand-mist bg-white/60")}>

        <div className="flex items-center gap-2 text-brand-orange"><Icon name="flame" className="streak-fire h-7 w-7" /><strong className="text-3xl">12</strong></div>

        <div><div className={cx("text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>¡Racha de 12 días!</div><div className={cx("text-xs", isDark ? "text-brand-soft" : "text-brand-muted")}>Sigue practicando para mantener tu racha activa</div></div>

      </div>

      <div className="grid gap-6 lg:grid-cols-5">

        <div className="space-y-6 lg:col-span-3">

          <Card isDark={isDark}>

            <div className="mb-4 flex items-center justify-between"><SectionLabel isDark={isDark}>Actividad reciente</SectionLabel><span className={cx("text-xs font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>Últimas 16 semanas</span></div>

            <div className="overflow-x-auto">

              <div className="flex w-max gap-1.5">

                {activity.map((week, wi) => <div key={wi} className="flex flex-col gap-[3px]">{week.map((level, di) => <div key={di} className="heatmap-cell h-[14px] w-[14px] rounded-[3px]" style={{ backgroundColor: levels[level] }} />)}</div>)}

              </div>

            </div>

          </Card>

          <ProgressCard isDark={isDark} />

        </div>

        <div className="space-y-6 lg:col-span-2">

          <QuestList isDark={isDark} />

          <Card isDark={isDark}>

            <SectionLabel isDark={isDark}>Tu semana</SectionLabel>

            <div className="mt-4 space-y-3">{[45, 30, 60, 25, 0, 0, 0].map((min, i) => <BarRow key={i} label={["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][i]} value={min} isDark={isDark} />)}</div>

          </Card>

          <div>

            <SectionLabel isDark={isDark}>Acciones rápidas</SectionLabel>

            <div className="mt-3 space-y-3">

              <QuickAction isDark={isDark} icon="play" title="Comenzar lección" desc="Lección 7: Saludos" onClick={() => navigate("/learn")} />

              <QuickAction isDark={isDark} icon="camera" title="Práctica inmersiva" desc="Feedback con IA" onClick={() => navigate("/practice")} accent />

              <QuickAction isDark={isDark} icon="refresh" title="Repaso diario" desc="12 señas pendientes" onClick={() => navigate("/learn")} />

            </div>

          </div>

        </div>

      </div>

    </main>

  );

}



function PageTitle({ isDark, title, accent, subtitle }) {

  const parts = title.split(accent);

  return (

    <div className="animate-fade mb-8">

      <h1 className={cx("text-2xl font-extrabold md:text-3xl", isDark ? "text-white" : "text-brand-ink")}>{parts[0]}<span className={isDark ? "text-brand-cyan" : "text-brand-teal"}>{accent}</span>{parts[1]}</h1>

      <p className={cx("mt-1 text-sm", isDark ? "text-brand-soft" : "text-brand-muted")}>{subtitle}</p>

    </div>

  );

}



function SectionLabel({ isDark, children }) {

  return <h3 className={cx("text-sm font-bold uppercase tracking-wider", isDark ? "text-brand-soft" : "text-brand-muted")}>{children}</h3>;

}



function ProgressCard({ isDark }) {

  return (

    <Card isDark={isDark}>

      <div className="mb-4 flex items-center justify-between"><SectionLabel isDark={isDark}>Progreso actual</SectionLabel><span className={cx("rounded-full px-3 py-1 text-xs font-semibold", isDark ? "bg-brand-cyan/15 text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>Nivel 3</span></div>

      <h3 className={cx("text-3xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>Lección 7:</h3>

      <p className={cx("text-sm font-medium", isDark ? "text-brand-soft" : "text-brand-muted")}>Saludos y presentaciones</p>

      <div className={cx("mt-5 h-2.5 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#E8EEEF]")}><div className="h-full w-[68%] rounded-full bg-gradient-to-r from-brand-teal to-brand-orange" /></div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-dashed pt-5" style={{ borderColor: isDark ? "#1A5C6A" : "#E8EEEF" }}>{[["12", "Señas hoy"], ["45 min", "Tiempo total"], ["89%", "Precisión"]].map(([v, l]) => <div key={l} className="text-center"><div className={cx("text-lg font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{v}</div><div className={cx("mt-0.5 text-[10px] font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{l}</div></div>)}</div>

    </Card>

  );

}



function BarRow({ label, value, isDark }) {

  return <div className="flex items-center gap-3"><span className={cx("w-8 text-xs font-semibold", isDark ? "text-brand-soft" : "text-brand-muted")}>{label}</span><div className={cx("h-2 flex-1 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#E8EEEF]")}><div className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-orange" style={{ width: `${Math.min(100, (value / 60) * 100)}%` }} /></div><span className={cx("w-10 text-right text-xs font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{value ? `${value}m` : "-"}</span></div>;

}



function QuickAction({ isDark, icon, title, desc, onClick, accent }) {

  return (

    <button onClick={onClick} className={cx("btn-press group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition", isDark ? "border-brand-line bg-brand-card hover:border-brand-cyan/30" : "border-gray-100 bg-white shadow-sm hover:shadow-md")}>

      <span className={cx("flex h-11 w-11 items-center justify-center rounded-lg", accent ? "bg-brand-orange/15 text-brand-orange" : isDark ? "bg-brand-teal/20 text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}><Icon name={icon} /></span>

      <span className="min-w-0 flex-1"><span className={cx("block text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>{title}</span><span className={cx("block text-xs", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{desc}</span></span>

      <Icon name="arrow" className={cx("h-4 w-4 transition group-hover:translate-x-1", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")} />

    </button>

  );

}



function LearnPage({ isDark }) {

  const [selected, setSelected] = useState(modules[0]);

  const [activeSign, setActiveSign] = useState(null);

  const [search, setSearch] = useState("");

  const completedSigns = modules.filter((m) => m.status === "completed").reduce((sum, m) => sum + m.signs, 0);

  const totalSigns = modules.reduce((sum, m) => sum + m.signs, 0);

  const progress = Math.round((completedSigns / totalSigns) * 100);

  const filteredItems = useMemo(() => {

    if (!selected) return [];

    if (!search.trim()) return selected.items;

    return selected.items.filter((item) =>

      item.label.toLowerCase().includes(search.toLowerCase())

    );

  }, [selected, search]);



  return (

    <main className="mx-auto max-w-6xl px-6 py-8">

      <PageTitle isDark={isDark} title="Tu ruta de aprendizaje" accent="aprendizaje" subtitle="Selecciona un módulo y toca cualquier seña para ver el video" />

      <div className="grid gap-6 lg:grid-cols-12">

        <section className="space-y-0 lg:col-span-4 overflow-y-auto max-h-[80vh] pr-1">

          {modules.map((module, index) => (

            <SkillNode

              key={module.id} module={module} index={index} isDark={isDark}

              selected={selected?.id === module.id}

              onClick={() => { setSelected(module); setActiveSign(null); setSearch(""); }}

            />

          ))}

        </section>

        <section className="space-y-4 lg:col-span-8">

          <div className="grid gap-4 sm:grid-cols-2">

            <Card isDark={isDark}>

              <SectionLabel isDark={isDark}>Tu racha</SectionLabel>

              <div className="mt-4 text-center">

                <div className="text-4xl font-extrabold text-brand-orange">12</div>

                <div className={cx("mt-1 text-xs font-medium", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>días consecutivos</div>

              </div>

            </Card>

            <Card isDark={isDark}>

              <SectionLabel isDark={isDark}>Progreso general</SectionLabel>

              <div className={cx("mt-3 text-3xl font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{progress}%</div>

              <div className={cx("mt-3 h-2 overflow-hidden rounded-full", isDark ? "bg-brand-deep" : "bg-[#E8EEEF]")}>

                <div className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-orange" style={{ width: `${progress}%` }} />

              </div>

              <p className={cx("mt-2 text-[10px]", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{completedSigns} de {totalSigns} señas</p>

            </Card>

          </div>

          {activeSign ? (

            <SignVideoPanel sign={activeSign} isDark={isDark} onClose={() => setActiveSign(null)} />

          ) : (

            <ModuleDetail

              module={selected} isDark={isDark}

              items={filteredItems} search={search}

              onSearch={setSearch} onSelect={setActiveSign}

            />

          )}

        </section>

      </div>

    </main>

  );

}



function SkillNode({ module, index, isDark, selected, onClick }) {

  const completed = module.status === "completed";

  const current = module.status === "current";

  const locked = module.status === "locked";

  return (

    <div>

      <button onClick={onClick} className={cx("animate-fade flex w-full items-center gap-4 text-left", locked && "cursor-default opacity-60")} style={{ animationDelay: `${index * 60}ms` }}>

        <span className={cx("flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition", completed ? "bg-brand-teal text-white" : current ? "node-glow bg-brand-orange text-white" : isDark ? "border border-brand-line bg-brand-card text-[#5A8A94]" : "border border-brand-mist bg-[#E8EEEF] text-[#8AA8B0]")}>{completed ? <Icon name="check" /> : current ? <Icon name="play" /> : <Icon name="lock" />}</span>

        <span className={cx("flex-1 rounded-xl p-4 transition", selected ? (isDark ? "border border-brand-cyan/30 bg-brand-card" : "border border-brand-teal/20 bg-white shadow-sm") : (isDark ? "hover:bg-brand-card/50" : "hover:bg-white/50"))}>

          <span className={cx("block text-sm font-bold", isDark ? "text-white" : "text-brand-ink")}>{module.title}</span>

          <span className={cx("block text-xs", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{module.desc}</span>

        </span>

      </button>

      {index < modules.length - 1 && <div className="flex justify-center py-1"><div className={cx("h-10 w-px rounded-full", isDark ? "bg-brand-line" : "bg-brand-mist")} /></div>}

    </div>

  );

}



function ModuleDetail({ module, isDark, items, search, onSearch, onSelect }) {

  if (!module) return null;

  return (

    <Card isDark={isDark}>

      <div className="mb-4 flex items-center gap-3">

        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange"><Icon name="book" /></span>

        <div className="flex-1 min-w-0">

          <h3 className={cx("text-base font-bold truncate", isDark ? "text-white" : "text-brand-ink")}>{module.title}</h3>

          <p className={cx("text-xs", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{module.signs} señas · Nivel {module.level}</p>

        </div>

        <span className={cx("rounded-full px-2 py-1 text-[10px] font-bold", isDark ? "bg-brand-teal/20 text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>{items.length}</span>

      </div>

      <input

        value={search} onChange={(e) => onSearch(e.target.value)}

        placeholder="Buscar seña..."

        className={cx("mb-4 w-full rounded-lg border px-3 py-2 text-sm", isDark ? "border-brand-line bg-brand-deep text-white placeholder:text-[#5A8A94]" : "border-brand-mist bg-brand-cream text-brand-ink placeholder:text-[#8AA8B0]")}

      />

      <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto sm:grid-cols-3">

        {items.map((item) => (

          <button

            key={item.label} onClick={() => onSelect(item)}

            className={cx("btn-press group flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition",

              isDark ? "border-brand-line bg-brand-deep/40 hover:border-brand-cyan/40 hover:bg-brand-card" : "border-brand-mist bg-brand-cream hover:border-brand-teal/30 hover:bg-white hover:shadow-sm"

            )}

          >

            <img src={item.thumbnail} alt={item.label} className="h-14 w-full rounded-lg object-cover" loading="lazy" />

            <span className={cx("text-[11px] font-semibold leading-tight", isDark ? "text-brand-soft" : "text-brand-muted")}>{item.label}</span>

          </button>

        ))}

      </div>

    </Card>

  );

}



function SignVideoPanel({ sign, isDark, onClose }) {

  return (

    <Card isDark={isDark}>

      <div className="mb-4 flex items-center justify-between">

        <div>

          <h3 className={cx("text-lg font-extrabold", isDark ? "text-white" : "text-brand-ink")}>{sign.label}</h3>

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

          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },

        });

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }



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

      videoRef.current?.srcObject?.getTracks().forEach((t) => t.stop());

      setCamReady(false);

    };

  }, [enabled]);



  return { videoRef, canvasRef, camReady, camError };

}



function PracticePage({ isDark, setIsDark, navigate }) {

  const [signIdx, setSignIdx] = useState(0);

  const [correct, setCorrect] = useState(0);

  const [total, setTotal] = useState(0);

  const [handDetected, setHandDetected] = useState(false);

  const [toasts, setToasts] = useState([{ id: 1, type: "info", message: 'Muestra la seña correcta con tu mano' }]);

  const idRef = useRef(2);

  const [gestureState, setGestureState] = useState("waiting"); // waiting | partial | match | confirmed

  const [matchScore, setMatchScore]     = useState(0);

  const confirmedRef = useRef(false);

  const holdStartRef = useRef(null);   // momentáneo que lleva la mano en MATCH

  const HOLD_MS = 600;                 // ms que debe mantener la pose correcta



  const addToast = (type, message) => setToasts((prev) => [...prev.slice(-2), { id: idRef.current++, type, message }]);



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

          setCorrect((v) => v + 1);

          setTotal((v) => v + 1);

          const next = Math.min(prevIdx + 1, signsQueue.length - 1);

          addToast("success", `✓ ${sign.name}  →  ${signsQueue[next].name}`);

          setTimeout(() => {

            confirmedRef.current = false;

            holdStartRef.current = null;

            setGestureState("waiting");

            setMatchScore(0);

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



  return (

    <div className={cx("flex h-screen flex-col transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>

      <header className={cx("flex items-center justify-between border-b px-6 py-3 backdrop-blur-xl", isDark ? "border-brand-line bg-brand-deep/90" : "border-brand-mist bg-brand-cream/90")}>

        <div className="flex items-center gap-3">

          <Logo isDark={isDark} compact />

          <div className={cx("h-5 w-px", isDark ? "bg-brand-line" : "bg-brand-mist")} />

          <span className={cx("text-xs font-semibold", isDark ? "text-brand-soft" : "text-brand-muted")}>Práctica Inmersiva · MediaPipe</span>

        </div>

        <div className="flex items-center gap-3">

          <span className={cx("rounded-xl px-3 py-1.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-white text-brand-teal shadow-sm")}>{correct}/{total}</span>

          <ThemeToggle isDark={isDark} setIsDark={setIsDark} />

        </div>

      </header>



      <div className="flex min-h-0 flex-1">

        <main className="relative flex-1 p-4">

          <div className="relative h-full overflow-hidden rounded-xl bg-black">

            {/* Video visible — fuente para MediaPipe */}

            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />

            {/* Canvas con video espejado + landmarks */}

            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />



            {!camReady && !camError && (

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">

                <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />

                <p className={cx("text-sm font-semibold", isDark ? "text-brand-soft" : "text-white")}>Iniciando cámara…</p>

              </div>

            )}

            {camError && (

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">

                <Icon name="camera" className="h-12 w-12 text-[#D96B6B]" />

                <p className="text-sm font-semibold text-white">{camError}</p>

                <p className="text-xs text-[#8AA8B0]">Permite el acceso a la cámara en tu navegador y recarga la página.</p>

              </div>

            )}



            {/* Indicador de detección geométrica */}

            {camReady && (

              <div className="absolute left-4 top-4 flex flex-col gap-1.5">

                <div className={cx(

                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-all",

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

                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-black/40">

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



            {/* Seña actual */}

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-white/20 bg-black/60 px-5 py-3 text-center shadow-lg backdrop-blur-md max-w-xs w-full">

              <div className="text-[10px] font-bold uppercase tracking-widest text-[#8AA8B0]">{signsQueue[signIdx].module} · {signsQueue[signIdx].difficulty}{signsQueue[signIdx].mov ? " · 🤸 con movimiento" : ""}</div>

              <div className="text-2xl font-extrabold text-white">{signsQueue[signIdx].name}</div>

              {signsQueue[signIdx].hint && (

                <div className="mt-1 text-[11px] text-[#8AA8B0] leading-tight">{signsQueue[signIdx].hint}</div>

              )}

            </div>



            {/* Toasts */}

            <div className="absolute left-1/2 top-6 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">

              {toasts.map((toast) => <Toast key={toast.id} toast={toast} isDark={isDark} />)}

            </div>

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

            <button onClick={() => navigate("/debug")} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-deep text-[#5A8A94] hover:text-white" : "bg-brand-cream text-brand-muted")} title="Diagnóstico visual">

              🔬

            </button>

            <button onClick={skipSign} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>

              Saltar<Icon name="arrow" className="h-4 w-4" />

            </button>

          </div>

        </aside>

      </div>



      {/* Controles móvil */}

      <div className={cx("md:hidden flex items-center justify-between gap-3 border-t px-6 py-3", isDark ? "border-brand-line bg-brand-deep/90" : "border-brand-mist bg-brand-cream/90")}>

        <button onClick={() => navigate("/dashboard")} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-soft" : "bg-white text-brand-muted shadow-sm")}>

          <Icon name="x" className="h-4 w-4" />Terminar

        </button>

        <div className="text-center">

          <div className={cx("text-xs font-bold", isDark ? "text-white" : "text-brand-ink")}>{signsQueue[signIdx].name}</div>

          <div className={cx("text-[10px]", isDark ? "text-[#5A8A94]" : "text-[#8AA8B0]")}>{correct}/{total} detectadas</div>

        </div>

        <button onClick={skipSign} className={cx("btn-press flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold", isDark ? "bg-brand-card text-brand-cyan" : "bg-brand-teal/10 text-brand-teal")}>

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

  return <div className={cx("animate-toast-in rounded-xl px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-sm", styles[toast.type])}>{toast.message}</div>;

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



// ── useVideoFileMediaPipe: procesa un archivo de video con HandLandmarker ──

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
            console.warn(`[MP] delegate ${delegate} falló:`, err.message);
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



  // Loop de detección: corre siempre, solo procesa cuando video está activo

  useEffect(() => {

    const vid = videoRef.current;

    const canvas = canvasRef.current;

    if (!ready || !vid || !canvas) return;



    let stopped = false;

    function detect() {

      if (stopped) return;

      // Procesar mientras el video tenga un frame disponible (aunque esté pausado)

      if (vid.readyState >= 2 && vid.videoWidth > 0) {

        const w = vid.videoWidth;

        const h = vid.videoHeight;

        // El canvas visible usa las dimensiones intrínsecas del video para alinear landmarks
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
          const S = 640; // resolución cuadrada de proceso
          if (!offRef.current) offRef.current = document.createElement('canvas');
          const off = offRef.current;
          off.width = S; off.height = S;
          const octx = off.getContext('2d');
          octx.drawImage(vid, cropX, cropY, cropSize, cropSize, 0, 0, S, S);

          const handRes = hlRef.current.detectForVideo(off, now);

          const lmsList = handRes.landmarks || [];

          setHandCount(lmsList.length);

          // Diagnóstico throttled (cada ~1s)
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



// ── Helpers para auto-entrenamiento desde video ──

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

// Convierte ruta absoluta del proyecto a URL pública si está en public/
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

    // Cargar todas las señas en paralelo: cada seña intenta _1.._20
    // simultaneamente. Formato principal: .npy (binario, más eficiente).
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

// ── DebugPage: diagnóstico visual de fingerStates + scores ──────────────

const ALL_SIGNS = [

  ...LSM_ALPHABET.map(([l, tpl]) => ({ name: l, template: tpl, group: 'Abecedario' })),

  ...['1','2','3','4','5','6','7','8','9'].map(n => ({ name: n, template: NUMBER_TEMPLATES[n] || '?????', group: 'Números' })),

];



// Panel compartido: dedos + extras + scores

function DebugPanel({ states, scores, filterG, setFilterG, isDark, shown }) {

  const FINGERS   = ['thumb','index','middle','ring','pinky'];

  const FINGER_ES = { thumb:'Pulgar', index:'Índice', middle:'Medio', ring:'Anular', pinky:'Meñique' };

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

              <span className='text-lg'>{ext === true ? '🟢' : ext === false ? '🔴' : '⚪'}</span>

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

            ['Puño', states.fistTight], ['Palma plana', states.palmFlat],

            ['Pulgar lateral', states.thumbOut], ['Pulgar↔índice', states.thumbTouchIndex],

            ['Pulgar↔medio', states.thumbTouchMiddle], ['Mano arriba', states.handUp],

            ['Mano abajo', states.handDown], ['Palma a cámara', states.palmFacingCamera],

            ['UV juntos', states.uvClose], ['UV separados', states.uvSpread],

            ['UV cruzados', states.uvTouching],

          ].map(([lbl, val]) => (

            <div key={lbl} className={cx('flex items-center justify-between rounded-lg px-2 py-1 text-[10px]',

              val ? (isDark ? 'bg-brand-teal/20' : 'bg-brand-teal/10') : (isDark ? 'bg-brand-deep' : 'bg-brand-cream')

            )}>

              <span className={isDark ? 'text-[#8AA8B0]' : 'text-brand-muted'}>{lbl}</span>

              <span className={cx('font-bold', val ? 'text-green-400' : isDark ? 'text-[#5A8A94]' : 'text-[#B0C4CC]')}>{val ? 'SÍ' : 'no'}</span>

            </div>

          ))}

        </div>

      )}



      {/* Ranking de scores */}

      <div className='mt-4'>

        <div className='mb-2 flex gap-1'>

          {['Todos','Abecedario','Números'].map(g => (

            <button key={g} onClick={() => setFilterG(g)}

              className={cx('rounded-lg px-2 py-0.5 text-[10px] font-bold transition',

                filterG === g ? 'bg-brand-teal text-white' : isDark ? 'bg-brand-deep text-[#5A8A94]' : 'bg-brand-cream text-brand-muted'

              )}>{g}</button>

          ))}

        </div>

        <div className='space-y-0.5 max-h-52 overflow-y-auto'>

          {shown.length === 0 && <p className={cx('py-4 text-center text-xs', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Sin mano detectada…</p>}

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

  const [speed, setSpeed]     = useState(0.5);      // velocidad de reproducción

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

    // Captura de frames del video (auto-entrenamiento o clasificación al terminar)
    if ((autoTrainRef.current && trainInfoRef.current) || videoOnly) {
      autoFramesRef.current.push({
        fingerStates: s,
        landmarksRight: right ? right.map(p => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) })) : null,
        landmarksLeft: left ? left.map(p => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) })) : null,
      });
    }

    // Detección dinámica en vivo (solo cámara / diagnóstico).
    if (!videoOnly) {
      dynamicDetector.pushFrameInfo(frameInfo(right, left));
      const dyn = dynamicDetector.detect();
      if (dyn?.accepted) dynamicCandidateRef.current = { name: dyn.matched, score: dyn.score };
      setDynamicSign(dyn?.matched || null);

      // Clasificador ONNX (LSTM+Attention) — paralelo al DTW
      if (onnxReady && (right || left)) {
        onnxFramesRef.current.push({
          landmarksRight: right ? right.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
          landmarksLeft: left ? left.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
        });
        if (onnxFramesRef.current.length > 60) onnxFramesRef.current.shift();
        onnxFrameCountRef.current++;
        // Ejecutar cada 10 frames (~3 veces/seg) con los últimos 24-60 frames
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
    setTrainMsg(`Segmentando ${frames.length} frames…`);
    const examples = segmentFrames(frames);
    if (examples.length === 0) {
      setTrainStatus('error');
      setTrainMsg('No se detectó movimiento suficiente para segmentar la seña.');
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
      setTrainMsg(`✅ "${info.sign}" entrenada · ${data.saved} ejemplo(s) · categoría ${info.category}`);
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
    setDynamicSign(result?.accepted ? result.matched : 'No estoy seguro: entrena más ejemplos');
  }, []);

  // Modo cámara (solo activo en pestaña cámara para no competir con el video por la GPU)

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
    setTrainMsg(autoTrain ? 'Capturando la seña mientras se reproduce…' : '');
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

      {/* Header */}

      <header className={cx('flex items-center justify-between border-b px-6 py-3 gap-4 flex-wrap', isDark ? 'border-brand-line bg-brand-card' : 'border-brand-mist bg-white')}>

        <span className={cx('text-lg font-extrabold shrink-0', isDark ? 'text-white' : 'text-brand-ink')}>🔬 Diagnóstico LSM</span>

        <div className='flex gap-2 flex-wrap items-center'>

          {!videoOnly && (
            <div className={cx('flex rounded-lg overflow-hidden border', isDark ? 'border-brand-line' : 'border-brand-mist')}>

              {[['cam','📷 Cámara'],['video','🎬 Video']].map(([t, lbl]) => (

                <button key={t} onClick={() => { setTab(t); setStates(null); setScores([]); setBest(null); }}

                  className={cx('px-3 py-1 text-xs font-bold transition',

                    tab === t ? 'bg-brand-teal text-white' : isDark ? 'bg-brand-deep text-[#5A8A94]' : 'bg-white text-brand-muted'

                  )}>{lbl}</button>

              ))}

            </div>
          )}

          <button onClick={() => navigate('/practice')} className={cx('rounded-lg px-3 py-1 text-xs font-bold', isDark ? 'bg-brand-card text-brand-soft' : 'bg-gray-100 text-brand-muted')}>← Práctica</button>

        </div>

      </header>



      <div className='mx-auto max-w-7xl px-4 py-6 grid gap-4 lg:grid-cols-12'>



        {/* Panel izquierdo: visor */}

        <div className='lg:col-span-6'>

          <Card isDark={isDark}>



            {/* ── TAB CÁMARA ── */}

            {tab === 'cam' && (

              <>

                <SectionLabel isDark={isDark}>Cámara en vivo</SectionLabel>

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

                      <span className={cx('text-xs animate-pulse', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Iniciando cámara…</span>

                    </div>

                  )}

                </div>

              </>

            )}



            {/* ── TAB VIDEO ── */}

            {tab === 'video' && (

              <>

                <div className='flex items-center justify-between'>

                  <SectionLabel isDark={isDark}>Video de entrenamiento</SectionLabel>

                  <button onClick={() => fileInputRef.current?.click()}

                    className='rounded-lg bg-brand-teal px-3 py-1 text-xs font-bold text-white hover:bg-brand-cyan transition'>

                    📂 Cargar video

                  </button>

                  <input ref={fileInputRef} type='file' accept='video/*' className='hidden'

                    onChange={e => { if (e.target.files[0]) { setVideoFile(e.target.files[0]); setVideoUrl(''); } }} />

                </div>



                {/* ── Cargar por ruta / URL ── */}
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
                    <label className={cx('block text-xs font-bold', isDark ? 'text-white' : 'text-brand-ink')}>Nombre de la seña para entrenar</label>
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
                        {autoTrain ? 'Entrenar al terminar: Sí' : 'Entrenar al terminar'}
                      </button>
                    </div>
                    <p className={cx('mt-2 text-[10px]', isDark ? 'text-[#8AA8B0]' : 'text-brand-muted')}>
                      Escribe el nombre, activa el entrenamiento y reproduce el video completo una vez. Luego desactívalo y repite el video para probar el reconocimiento.
                    </p>
                    {trainStatus !== 'idle' && trainMsg && <div className={cx('mt-2 rounded-lg px-2 py-1.5 text-[11px] font-semibold', trainStatus === 'done' ? 'bg-green-500/15 text-green-400' : trainStatus === 'error' ? 'bg-red-500/15 text-red-400' : isDark ? 'bg-brand-card text-[#8AA8B0]' : 'bg-brand-cream text-brand-muted')}>{trainMsg}</div>}
                  </div>
                )}

                {/* ── Panel auto-entrenamiento ── */}
                {!videoOnly && <div className={cx('mt-3 rounded-xl border p-3', isDark ? 'border-brand-line bg-brand-deep/50' : 'border-brand-mist bg-white')}> 
                  <div className='flex items-center justify-between gap-2'>
                    <span className={cx('text-xs font-bold', isDark ? 'text-white' : 'text-brand-ink')}>🎓 Auto-entrenamiento</span>
                    <label className='flex items-center gap-1.5 cursor-pointer'>
                      <input type='checkbox' checked={autoTrain} onChange={(e) => setAutoTrain(e.target.checked)} className='accent-brand-teal' />
                      <span className={cx('text-[10px] font-bold', isDark ? 'text-[#8AA8B0]' : 'text-brand-muted')}>Entrenar al terminar</span>
                    </label>
                  </div>
                  <p className={cx('mt-1 text-[10px] leading-snug', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>
                    El video debe estar en <b>public/videos/</b> para cargarse por URL, o usa el botón 📂. Se entrena con el nombre del archivo.
                  </p>
                  {trainInfo && (
                    <div className='mt-2 flex flex-wrap items-center gap-2'>
                      <span className={cx('rounded-lg px-2 py-1 text-xs font-extrabold', isDark ? 'bg-brand-teal/20 text-brand-cyan' : 'bg-brand-teal/10 text-brand-teal')}>
                        Seña: {trainInfo.sign}
                      </span>
                      <span className={cx('rounded-lg px-2 py-0.5 text-[10px] font-bold', isDark ? 'bg-brand-card text-[#8AA8B0]' : 'bg-brand-cream text-brand-muted')}>
                        {trainInfo.category}
                      </span>
                      {!autoTrain && (
                        <button onClick={finishAutoTrain}
                          className='rounded-lg bg-brand-orange px-3 py-1 text-xs font-bold text-white hover:opacity-80 transition'>
                          🎓 Entrenar ahora
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
                      {trainStatus === 'training' && <span className='animate-pulse'>⏳ </span>}
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

                    <span className='text-4xl'>🎬</span>

                    <span className='text-sm font-semibold'>Haz clic para seleccionar un video</span>

                    <span className='text-xs opacity-60'>MP4, MOV, WebM…</span>

                  </div>

                ) : (

                  <>

                    {/* Video con canvas superpuesto dibujando landmarks */}

                    <div className='relative mt-3 overflow-hidden rounded-xl bg-black' style={{ aspectRatio: '16/9' }}>

                      {/* video visible de fondo; canvas transparente dibuja solo landmarks encima */}

                      <video ref={vid.videoRef} className='absolute inset-0 h-full w-full object-contain z-0' playsInline muted />

                      <canvas ref={vid.canvasRef} className='absolute inset-0 h-full w-full object-contain pointer-events-none z-10' />



                      {/* Seña detectada */}

                      {best && (

                        <div className='absolute top-3 left-3 rounded-xl bg-green-600/90 px-4 py-1.5 text-center backdrop-blur'>

                          <div className='text-[9px] font-bold uppercase tracking-widest text-green-200'>Estática</div>

                          <div className='text-3xl font-extrabold text-white leading-none'>{best}</div>

                        </div>

                      )}

                      <div className={cx('absolute top-3 right-3 rounded-xl px-4 py-1.5 text-center backdrop-blur', dynamicSign ? 'bg-green-600/90' : 'bg-black/60')}>

                        <div className={cx('text-[9px] font-bold uppercase tracking-widest', dynamicSign ? 'text-green-200' : 'text-[#A8CDD6]')}>Detector dinámico</div>

                        <div className='text-lg font-extrabold text-white leading-none'>{dynamicSign || (videoOnly ? 'Analizando video…' : 'Esperando gesto…')}</div>

                        <div className='mt-1 text-[9px] text-[#D4EEF4]'>{patternsLoaded.length} seña(s) entrenada(s) cargada(s)</div>

                      </div>



                      {/* Clasificador ONNX (LSTM+Attention) */}
                      <div className={cx('absolute top-20 right-3 rounded-xl px-4 py-1.5 text-center backdrop-blur', onnxSign ? 'bg-purple-600/90' : 'bg-black/60')}>
                        <div className={cx('text-[9px] font-bold uppercase tracking-widest', onnxSign ? 'text-purple-200' : 'text-[#A8CDD6]')}>LSTM+Attention</div>
                        <div className='text-lg font-extrabold text-white leading-none'>
                          {onnxReady ? (onnxSign || 'Esperando gesto…') : 'Cargando modelo…'}
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

                          {vid.ready ? (vid.handCount > 0 ? `Manos: ${vid.handCount}` : 'Sin manos detectadas') : 'MediaPipe cargando…'}

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

                        {vid.playing ? '⏸ Pausar' : '▶ Play'}

                      </button>

                      <button

                        onClick={() => { const v = vid.videoRef.current; if (v) { v.currentTime = 0; v.pause(); } }}

                        className={cx('rounded-lg px-3 py-2 text-xs font-bold transition', isDark ? 'bg-brand-deep text-[#5A8A94] hover:text-white' : 'bg-brand-cream text-brand-muted')}>

                        ⏮ Reiniciar

                      </button>

                      <div className='flex items-center gap-2 ml-auto'>

                        <span className={cx('text-[10px] shrink-0', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>Velocidad</span>

                        {[0.25, 0.5, 1].map(s => (

                          <button key={s} onClick={() => setSpeed(s)}

                            className={cx('rounded px-2 py-0.5 text-[10px] font-bold transition',

                              speed === s ? 'bg-brand-orange text-white' : isDark ? 'bg-brand-deep text-[#5A8A94]' : 'bg-brand-cream text-brand-muted'

                            )}>{s}×</button>

                        ))}

                      </div>

                    </div>

                    <button onClick={() => { setVideoFile(null); setStates(null); setScores([]); setBest(null); }}

                      className={cx('mt-2 w-full rounded-lg py-1 text-[10px] font-bold', isDark ? 'text-[#5A8A94] hover:text-white' : 'text-brand-muted hover:text-brand-ink')}>

                      🗑 Cambiar video

                    </button>

                  </>

                )}

              </>

            )}



            {/* Panel de diagnóstico estático, no se muestra en la página exclusiva de videos */}

            {!videoOnly && <DebugPanel states={states} scores={scores} filterG={filterG} setFilterG={setFilterG} isDark={isDark} shown={shown} />}

          </Card>

        </div>



        {/* Panel derecho: scores completos */}

        {!videoOnly && <div className='lg:col-span-6'>

          <Card isDark={isDark}>

            <div className='flex items-center justify-between mb-3'>

              <SectionLabel isDark={isDark}>Ranking completo</SectionLabel>

              {best && <span className='rounded-full bg-green-500/20 px-3 py-1 text-xs font-extrabold text-green-400 ring-1 ring-green-500/40'>✓ {best}</span>}

            </div>

            <div className='space-y-0.5 max-h-[75vh] overflow-y-auto'>

              {scores.length === 0 && (

                <p className={cx('py-12 text-center text-sm', isDark ? 'text-[#5A8A94]' : 'text-brand-muted')}>

                  {tab === 'cam' ? 'Pon una mano frente a la cámara…' : 'Carga un video y dale Play…'}

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

  const [isDark, setIsDark] = useState(true);

  const [path, navigate] = useRoute();



  useEffect(() => {

    document.documentElement.classList.toggle("dark", isDark);

  }, [isDark]);



  if (path === "/" || path === "/login") return <AuthPage mode="login" isDark={isDark} setIsDark={setIsDark} navigate={navigate} />;

  if (path === "/signup") return <AuthPage mode="signup" isDark={isDark} setIsDark={setIsDark} navigate={navigate} />;

  if (path === "/practice") return <PracticePage isDark={isDark} setIsDark={setIsDark} navigate={navigate} />;

  if (path === "/debug")   return <DebugPage isDark={isDark} navigate={navigate} />;

  if (path === "/video-test") return <DebugPage isDark={isDark} navigate={navigate} videoOnly />;

  if (path === "/model-test") return (

    <ModelTestPage

      isDark={isDark}

      navigate={navigate}

      useCameraMediaPipe={useCameraMediaPipe}

      reloadDynamicPatterns={reloadDynamicPatterns}

    />

  );

  if (path === "/train") return (
    <TrainPage
      isDark={isDark}
      navigate={navigate}
      useCameraMediaPipe={useCameraMediaPipe}
      reloadDynamicPatterns={reloadDynamicPatterns}
    />
  );

  if (path === "/training-viewer") return (
    <TrainingViewerPage isDark={isDark} navigate={navigate} />
  );

  if (path === "/retrain") return (
    <RetrainPage isDark={isDark} navigate={navigate} />
  );



  return (

    <div className={cx("min-h-screen transition-colors", isDark ? "bg-brand-deep" : "bg-brand-cream")}>

      <AppHeader isDark={isDark} setIsDark={setIsDark} navigate={navigate} path={path} />

      {path === "/learn" ? <LearnPage isDark={isDark} /> : <Dashboard isDark={isDark} navigate={navigate} />}

    </div>

  );

}



createRoot(document.getElementById("root")).render(<App />);

