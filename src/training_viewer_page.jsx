// training_viewer_page.jsx
// Visualizador de datos de entrenamiento: muestra cada frame con landmarks
// dibujados sobre un canvas, el vector de features, y velocidad/aceleración.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { fingerStates } from "./lsm_detector.js";
import { featureFromFingerStates, frameInfo, buildSequence } from "./dynamic_sign_detector.js";

function cx(...c) { return c.filter(Boolean).join(" "); }

const FEATURE_LABELS = [
  "ang.index", "ang.middle", "ang.ring", "ang.pinky", "ang.thumb",
  "ext.thumb", "ext.index", "ext.middle", "ext.ring", "ext.pinky",
  "palmOriY", "fingerOriY", "fingerOriZ", "palmNormZ", "imGap",
  "vel.x", "vel.y", "acc.x", "acc.y",
];

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

const CATEGORY_LABELS = {
  numeros: "Números", palabras: "Palabras", familia: "Familia",
  colores: "Colores", salud: "Salud", tecnologia: "Tecnología",
  expresiones: "Expresiones",
};

// rect = { x, y, w, h } área real donde se muestra el video dentro del canvas (letterbox contain-fit)
function drawHand(ctx, lms, w, h, mirror = true, color = "#2AABB8", rect = null) {
  const rx = rect ? rect.x : 0, ry = rect ? rect.y : 0;
  const rw = rect ? rect.w : w, rh = rect ? rect.h : h;
  const tx = mirror ? (x) => rx + (1 - x) * rw : (x) => rx + x * rw;
  const ty = (y) => ry + y * rh;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 4;
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!lms[a] || !lms[b]) continue;
    ctx.beginPath();
    ctx.moveTo(tx(lms[a].x), ty(lms[a].y));
    ctx.lineTo(tx(lms[b].x), ty(lms[b].y));
    ctx.stroke();
  }

  for (let i = 0; i < lms.length; i++) {
    const p = lms[i];
    if (!p) continue;
    const x = tx(p.x), y = ty(p.y);
    const isTip = [4, 8, 12, 16, 20].includes(i);
    const isWrist = i === 0;
    ctx.beginPath();
    ctx.arc(x, y, isWrist ? 6 : isTip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isWrist ? "#D98E36" : isTip ? "#E6F1F3" : color;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  return { tx, ty };
}

function drawVelocityArrow(ctx, lms, vx, vy, w, h, mirror = true, rect = null) {
  if (!lms[0]) return;
  const rx = rect ? rect.x : 0, ry = rect ? rect.y : 0;
  const rw = rect ? rect.w : w, rh = rect ? rect.h : h;
  const tx = mirror ? (x) => rx + (1 - x) * rw : (x) => rx + x * rw;
  const ty = (y) => ry + y * rh;
  const wx = tx(lms[0].x), wy = ty(lms[0].y);
  const scale = 80;
  const ex = wx + vx * scale;
  const ey = wy + vy * scale;
  ctx.strokeStyle = "#D98E36";
  ctx.lineWidth = 3;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(wx, wy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // Flecha
  const ang = Math.atan2(ey - wy, ex - wx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4));
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function FeatureBar({ label, value, max = 1 }) {
  const pct = Math.min(100, Math.max(0, (Math.abs(value) / max) * 100));
  const color = value < 0 ? "#D96B6B" : "#2AABB8";
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 shrink-0 text-right font-mono text-[#8AA8B0]">{label}</span>
      <div className="relative h-3 flex-1 rounded-sm bg-[#1E3038]">
        <div
          className="absolute h-full rounded-sm transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 shrink-0 font-mono text-[#E6F1F3]">{value.toFixed(3)}</span>
    </div>
  );
}

export default function TrainingViewerPage({ isDark, navigate }) {
  const [manifest, setManifest] = useState(null);
  const [selectedCat, setSelectedCat] = useState("palabras");
  const [selectedSign, setSelectedSign] = useState(null);
  const [selectedExample, setSelectedExample] = useState(1);
  const [frames, setFrames] = useState([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(15);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [liveHands, setLiveHands] = useState(null); // landmarks detectados por MediaPipe en tiempo real
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(0);
  const handLandmarkerRef = useRef(null);
  const mpReadyRef = useRef(false);
  const smoothedHandsRef = useRef(null); // landmarks suavizados con lerp
  const lastDetectTsRef = useRef(0);

  // Cargar manifest
  useEffect(() => {
    fetch(`/api/training-data/manifest?t=${Date.now()}`)
      .then(r => r.json())
      .then(m => {
        setManifest(m);
        const firstCat = Object.keys(m)[0];
        setSelectedCat(firstCat);
        if (m[firstCat]?.length) setSelectedSign(m[firstCat][0]);
      })
      .catch(e => console.error(e));
  }, []);

  // Cargar frames de la seña seleccionada
  useEffect(() => {
    if (!selectedSign || !selectedCat) return;
    const fp = `/training_data/${selectedCat}/${selectedSign}_${selectedExample}.json`;
    fetch(fp)
      .then(r => {
        if (!r.ok) throw new Error("no encontrado");
        return r.json();
      })
      .then(data => {
        setFrames(data);
        setCurrentFrame(0);
        // Usar el video comprimido de public/videos/signs/ (existe para todas las señas)
        setVideoUrl(`/videos/signs/${selectedSign}.mp4`);
        setVideoReady(false);
      })
      .catch(() => {
        // intentar sin número
        const fp2 = `/training_data/${selectedCat}/${selectedSign}.json`;
        fetch(fp2)
          .then(r => r.json())
          .then(data => {
            setFrames(data);
            setCurrentFrame(0);
            setVideoUrl(`/videos/signs/${selectedSign}.mp4`);
            setVideoReady(false);
          })
          .catch(() => setFrames([]));
      });
  }, [selectedCat, selectedSign, selectedExample]);

  // Calcular secuencia DTW
  const sequence = useMemo(() => {
    if (frames.length === 0) return [];
    const infos = frames.map(f => {
      const lr = f.landmarksRight ?? f.landmarks ?? null;
      if (!lr && !f.landmarksLeft) return null;
      return frameInfo(lr, f.landmarksLeft ?? null);
    });
    return buildSequence(infos);
  }, [frames]);

  // Info del frame actual
  const frameData = useMemo(() => {
    if (frames.length === 0 || currentFrame >= frames.length) return null;
    const f = frames[currentFrame];
    const lr = f.landmarksRight ?? f.landmarks ?? null;
    if (!lr && !f.landmarksLeft) return null;
    const fs = lr ? fingerStates(lr) : null;
    const info = frameInfo(lr, f.landmarksLeft ?? null);
    const vec = sequence[currentFrame];
    return { f, fs, info, vec, lms: lr };
  }, [frames, currentFrame, sequence]);

  // Inicializar MediaPipe HandLandmarker para detección en vivo sobre el video
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
        const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.25,
          minHandPresenceConfidence: 0.25,
          minTrackingConfidence: 0.2,
        });
        if (cancelled) { hl.close(); return; }
        handLandmarkerRef.current = hl;
        mpReadyRef.current = true;
      } catch (e) {
        console.error("MediaPipe init error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Calcula el rect (letterbox) donde se muestra el video dentro del canvas
  // usando el mismo criterio que object-fit: contain
  function getVideoRect(vid, canvasW, canvasH) {
    if (!vid || !vid.videoWidth || !vid.videoHeight) return null;
    const videoRatio = vid.videoWidth / vid.videoHeight;
    const canvasRatio = canvasW / canvasH;
    let w, h, x, y;
    if (videoRatio > canvasRatio) {
      // Video más ancho: barras arriba/abajo
      w = canvasW;
      h = canvasW / videoRatio;
      x = 0;
      y = (canvasH - h) / 2;
    } else {
      // Video más alto: barras a los lados
      h = canvasH;
      w = canvasH * videoRatio;
      y = 0;
      x = (canvasW - w) / 2;
    }
    return { x, y, w, h };
  }

  // Dibujar SOLO las 2 manos detectadas por MediaPipe (sin JSON)
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const vid = videoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const rect = getVideoRect(vid, w, h);
    const hands = smoothedHandsRef.current;
    if (hands && hands.length > 0) {
      for (let i = 0; i < Math.min(2, hands.length); i++) {
        const color = hands[i].handedness === "Left" ? "#2AABB8" : "#D98E36";
        if (hands[i].extrapolated) ctx.globalAlpha = 0.5;
        drawHand(ctx, hands[i].landmarks, w, h, true, color, rect);
        ctx.globalAlpha = 1;
      }
    }
  }, []);

  // Lerp helper — suavizado temporal
  const lerp = (a, b, t) => a + (b - a) * t;
  const SMOOTH = 0.5; // factor de suavizado (0=congelado, 1=sin suavizado)
  const MISS_FRAMES_KEEP = 45; // frames a mantener/extrapolar la última detección antes de borrar (~1.5s a 30fps)
  const VELOCITY_DECAY = 0.92; // decaimiento de velocidad por frame durante extrapolación
  const missCountRef = useRef(0);

  // Extrapola una mano hacia adelante usando su velocidad por landmark, con decaimiento
  function extrapolateHand(hand) {
    const vel = hand.velocity || hand.landmarks.map(() => ({ x: 0, y: 0, z: 0 }));
    const landmarks = hand.landmarks.map((p, j) => ({
      x: Math.min(1, Math.max(0, p.x + vel[j].x)),
      y: Math.min(1, Math.max(0, p.y + vel[j].y)),
      z: p.z + vel[j].z,
    }));
    const decayedVel = vel.map(v => ({ x: v.x * VELOCITY_DECAY, y: v.y * VELOCITY_DECAY, z: v.z * VELOCITY_DECAY }));
    return { handedness: hand.handedness, landmarks, velocity: decayedVel, extrapolated: true };
  }

  // Actualizar manos suavizadas hacia las detectadas, con extrapolación por oclusión
  function updateSmoothed(rawHands, rawHandedness) {
    const prev = smoothedHandsRef.current;
    if (!rawHands || rawHands.length === 0) {
      // Sin detección: extrapolar cada mano previa usando su velocidad conocida
      missCountRef.current++;
      if (prev && missCountRef.current <= MISS_FRAMES_KEEP) {
        smoothedHandsRef.current = prev.map(extrapolateHand);
      } else {
        smoothedHandsRef.current = null;
      }
      return;
    }

    missCountRef.current = 0;
    const maxHands = Math.min(2, rawHands.length);
    const newHands = [];
    for (let i = 0; i < maxHands; i++) {
      const raw = rawHands[i];
      const handed = rawHandedness?.[i]?.categoryName || (i === 0 ? "Left" : "Right");
      // Buscar mano previa con misma handedness para hacer lerp
      const prevHand = prev?.find(h => h.handedness === handed);
      let smoothed, velocity;
      if (prevHand) {
        smoothed = raw.map((p, j) => ({
          x: lerp(prevHand.landmarks[j].x, p.x, SMOOTH),
          y: lerp(prevHand.landmarks[j].y, p.y, SMOOTH),
          z: lerp(prevHand.landmarks[j].z || 0, p.z || 0, SMOOTH),
        }));
        // Velocidad = desplazamiento entre frame anterior y el nuevo suavizado (para extrapolar si se pierde)
        velocity = smoothed.map((p, j) => ({
          x: p.x - prevHand.landmarks[j].x,
          y: p.y - prevHand.landmarks[j].y,
          z: (p.z || 0) - (prevHand.landmarks[j].z || 0),
        }));
      } else {
        smoothed = raw.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
        velocity = smoothed.map(() => ({ x: 0, y: 0, z: 0 }));
      }
      newHands.push({ handedness: handed, landmarks: smoothed, velocity, extrapolated: false });
    }
    // Si antes teníamos 2 manos y ahora solo 1, extrapolar la que falta usando su velocidad
    if (prev && prev.length === 2 && newHands.length === 1) {
      const missing = prev.find(h => !newHands.find(n => n.handedness === h.handedness));
      if (missing) newHands.push(extrapolateHand(missing));
    }
    smoothedHandsRef.current = newHands;
  }

  // Loop principal: detección + render a 60fps con requestAnimationFrame
  // Funciona tanto en play como en pausa/scrub
  useEffect(() => {
    if (!videoReady) return;

    let running = true;

    function loop() {
      if (!running) return;
      const vid = videoRef.current;
      const hl = handLandmarkerRef.current;
      const now = performance.now();

      // Detectar cada ~33ms (30fps) si MediaPipe está listo
      if (hl && mpReadyRef.current && vid && vid.readyState >= 2) {
        if (now - lastDetectTsRef.current > 33) {
          lastDetectTsRef.current = now;
          try {
            const res = hl.detectForVideo(vid, now);
            updateSmoothed(res?.landmarks || null, res?.handedness || null);
          } catch (e) {}
        }
      }

      // Render cada frame
      draw();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoReady, draw]);
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const vid = videoRef.current;
    if (vid && videoReady) {
      // Reproducir video real
      vid.play().catch(() => {});
      function onTime() {
        const t = vid.currentTime;
        // Encontrar el frame más cercano por videoTime
        let best = 0, bestDiff = Infinity;
        for (let i = 0; i < frames.length; i++) {
          const diff = Math.abs(frames[i].videoTime - t);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        setCurrentFrame(best);
        if (vid.ended) setPlaying(false);
      }
      vid.addEventListener("timeupdate", onTime);
      return () => { vid.removeEventListener("timeupdate", onTime); vid.pause(); };
    } else {
      // Sin video: reproducir frames por FPS
      function tick(now) {
        if (!playing) return;
        const elapsed = now - lastTimeRef.current;
        const interval = 1000 / fps;
        if (elapsed >= interval) {
          lastTimeRef.current = now;
          setCurrentFrame(prev => {
            if (prev >= frames.length - 1) {
              setPlaying(false);
              return prev;
            }
            return prev + 1;
          });
        }
        rafRef.current = requestAnimationFrame(tick);
      }
      lastTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }
  }, [playing, frames.length, fps, videoReady, frames]);

  const signs = manifest?.[selectedCat] || [];
  const examples = [];
  for (let n = 1; n <= 8; n++) {
    examples.push(n);
  }

  return (
    <div className={cx("min-h-screen", isDark ? "bg-[#08151A]" : "bg-[#F4F8F9]")}>
      <header className={cx(
        "flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3",
        isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]"
      )}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/model-test")}
            className="rounded-lg bg-[#2AABB8] px-3 py-1.5 text-xs font-bold text-white"
          >
            ← Probar modelo
          </button>
          <h1 className={cx("text-lg font-bold", isDark ? "text-[#E6F1F3]" : "text-[#12303A]")}>
            Visualizador de Entrenamiento
          </h1>
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[280px_1fr_300px]">
        {/* ── Selector de seña ── */}
        <div className={cx(
          "rounded-xl border p-3",
          isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]"
        )}>
          <h2 className={cx("mb-2 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
            Categoría
          </h2>
          <div className="mb-3 flex flex-wrap gap-1">
            {manifest && Object.keys(manifest).map(cat => (
              <button
                key={cat}
                onClick={() => { setSelectedCat(cat); setSelectedSign(manifest[cat][0]); setSelectedExample(1); }}
                className={cx(
                  "rounded-md px-2 py-1 text-[10px] font-bold",
                  selectedCat === cat
                    ? "bg-[#2AABB8] text-white"
                    : isDark ? "bg-[#1E3038] text-[#8AA8B0]" : "bg-[#E8F0F2] text-[#5B7883]"
                )}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>

          <h2 className={cx("mb-2 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
            Señas ({signs.length})
          </h2>
          <div className="max-h-48 overflow-y-auto rounded-md border border-[#1E3038]">
            {signs.map(s => (
              <button
                key={s}
                onClick={() => { setSelectedSign(s); setSelectedExample(1); }}
                className={cx(
                  "block w-full px-3 py-1.5 text-left text-xs font-semibold",
                  selectedSign === s
                    ? "bg-[#2AABB8]/20 text-[#2AABB8]"
                    : isDark ? "text-[#E6F1F3] hover:bg-[#1E3038]" : "text-[#12303A] hover:bg-[#F4F8F9]"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {selectedSign && (
            <>
              <h2 className={cx("mb-2 mt-3 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
                Ejemplo
              </h2>
              <div className="flex flex-wrap gap-1">
                {examples.map(n => (
                  <button
                    key={n}
                    onClick={() => setSelectedExample(n)}
                    className={cx(
                      "h-7 w-7 rounded-md text-[10px] font-bold",
                      selectedExample === n
                        ? "bg-[#D98E36] text-white"
                        : isDark ? "bg-[#1E3038] text-[#8AA8B0]" : "bg-[#E8F0F2] text-[#5B7883]"
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Canvas + controles ── */}
        <div className={cx(
          "rounded-xl border p-4",
          isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]"
        )}>
          {selectedSign && (
            <div className="mb-3 flex items-center gap-3">
              <h2 className={cx("text-xl font-bold", isDark ? "text-[#E6F1F3]" : "text-[#12303A]")}>
                {selectedSign}
              </h2>
              <span className="rounded-md bg-[#1E3038] px-2 py-0.5 text-[10px] font-bold text-[#8AA8B0]">
                Ejemplo #{selectedExample}
              </span>
              <span className="rounded-md bg-[#1E3038] px-2 py-0.5 text-[10px] font-bold text-[#8AA8B0]">
                {frames.length} frames
              </span>
            </div>
          )}

          <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "4/3" }}>
            {/* Video visible a máxima calidad */}
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="absolute inset-0 h-full w-full"
                style={{ transform: "scaleX(-1)", width: "100%", height: "100%", objectFit: "contain" }}
                muted
                playsInline
                preload="auto"
                onLoadedData={() => setVideoReady(true)}
                onError={() => setVideoReady(false)}
              />
            )}
            {/* Canvas transparente solo para landmarks encima */}
            <canvas ref={canvasRef} width={1280} height={960} className="absolute inset-0 h-full w-full object-contain pointer-events-none" />
            {frames.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-[#8AA8B0]">Cargando…</p>
              </div>
            )}
            {frameData && (
              <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] font-mono text-[#E6F1F3]">
                Frame {currentFrame + 1}/{frames.length} · t={frameData.f.videoTime?.toFixed(2) || "?"}s
                {videoReady ? " · video OK" : " · sin video"}
              </div>
            )}
            {/* Leyenda de colores */}
            <div className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1 text-[9px] font-mono text-[#E6F1F3] space-y-0.5">
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#2AABB8]" /> Mano izquierda</div>
              <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#D98E36]" /> Mano derecha</div>
            </div>
          </div>

          {/* Controles */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setPlaying(p => !p)}
              disabled={frames.length === 0}
              className="rounded-lg bg-[#2AABB8] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {playing ? "⏸ Pausar" : "▶ Reproducir"}
            </button>
            <button
              onClick={() => { setPlaying(false); setCurrentFrame(0); }}
              disabled={frames.length === 0}
              className="rounded-lg bg-[#1E3038] px-3 py-2 text-xs font-bold text-[#8AA8B0] disabled:opacity-40"
            >
              ⏮
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={currentFrame}
              onChange={e => {
                setPlaying(false);
                const idx = parseInt(e.target.value);
                setCurrentFrame(idx);
                const vid = videoRef.current;
                if (vid && videoReady && frames[idx]) {
                  vid.currentTime = frames[idx].videoTime || 0;
                }
              }}
              className="flex-1 accent-[#2AABB8]"
            />
            <label className="flex items-center gap-1 text-[10px] text-[#8AA8B0]">
              FPS
              <input
                type="number"
                min={1}
                max={30}
                value={fps}
                onChange={e => setFps(Math.max(1, Math.min(30, parseInt(e.target.value) || 15)))}
                className="w-12 rounded bg-[#1E3038] px-1 py-0.5 text-center text-[#E6F1F3]"
              />
            </label>
          </div>
        </div>

        {/* ── Feature vector ── */}
        <div className={cx(
          "rounded-xl border p-4",
          isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]"
        )}>
          <h2 className={cx("mb-3 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
            Vector de Features · Frame {currentFrame + 1}
          </h2>

          {frameData?.vec ? (
            <div className="space-y-1">
              {frameData.vec.map((v, i) => (
                <FeatureBar
                  key={i}
                  label={FEATURE_LABELS[i] || `f${i}`}
                  value={v}
                  max={i >= 15 ? 2 : 1}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#8AA8B0]">Sin datos</p>
          )}

          {frameData?.fs && (
            <>
              <h2 className={cx("mb-2 mt-4 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
                Estados de dedos
              </h2>
              <div className="grid grid-cols-5 gap-1 text-center">
                {["thumb", "index", "middle", "ring", "pinky"].map(d => (
                  <div key={d} className={cx(
                    "rounded-md py-1 text-[10px] font-bold",
                    frameData.fs[d] ? "bg-[#1A6B4A] text-[#D4F5E4]" : "bg-[#3A1B1B] text-[#F5C9C9]"
                  )}>
                    {d === "thumb" ? "P" : d === "index" ? "I" : d === "middle" ? "M" : d === "ring" ? "A" : "Q"}
                  </div>
                ))}
              </div>

              <h2 className={cx("mb-2 mt-4 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
                Ángulos articulares
              </h2>
              <div className="space-y-1 font-mono text-[10px] text-[#E6F1F3]">
                {["index", "middle", "ring", "pinky", "thumb"].map(d => (
                  <div key={d} className="flex justify-between">
                    <span className="text-[#8AA8B0]">ang.{d}</span>
                    <span>{frameData.fs.ang?.[d]?.toFixed(1) || "—"}°</span>
                  </div>
                ))}
              </div>

              <h2 className={cx("mb-2 mt-4 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
                Orientación
              </h2>
              <div className="space-y-1 font-mono text-[10px] text-[#E6F1F3]">
                <div className="flex justify-between"><span className="text-[#8AA8B0]">palmOriY</span><span>{frameData.fs.palmOriY?.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-[#8AA8B0]">fingerOriY</span><span>{frameData.fs.fingerOriY?.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-[#8AA8B0]">fingerOriZ</span><span>{frameData.fs.fingerOriZ?.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-[#8AA8B0]">palmNormZ</span><span>{frameData.fs.palmNormalZ?.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-[#8AA8B0]">imGap</span><span>{frameData.fs.imGap?.toFixed(3)}</span></div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Gráfico de secuencia temporal ── */}
      {sequence.length > 0 && (
        <div className={cx(
          "mx-4 mb-4 rounded-xl border p-4",
          isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]"
        )}>
          <h2 className={cx("mb-3 text-xs font-bold uppercase", isDark ? "text-[#8AA8B0]" : "text-[#5B7883]")}>
            Evolución temporal · {selectedSign} #{selectedExample} ({sequence.length} frames)
          </h2>
          <TimelineChart sequence={sequence} currentFrame={currentFrame} labels={FEATURE_LABELS} />
        </div>
      )}
    </div>
  );
}

// Gráfico de líneas temporal para ver cómo evoluciona cada feature
function TimelineChart({ sequence, currentFrame, labels }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sequence.length === 0) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#08151A";
    ctx.fillRect(0, 0, w, h);

    const dims = sequence[0].length;
    const padL = 40, padR = 10, padT = 10, padB = 20;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Encontrar min/max global
    let minV = Infinity, maxV = -Infinity;
    for (const vec of sequence) {
      for (let d = 0; d < dims; d++) {
        if (vec[d] < minV) minV = vec[d];
        if (vec[d] > maxV) maxV = vec[d];
      }
    }
    const range = maxV - minV || 1;

    // Grid
    ctx.strokeStyle = "#1E3038";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    // Dibujar líneas para cada feature
    const colors = [
      "#2AABB8", "#D98E36", "#1A6B4A", "#D96B6B", "#E6F1F3",
      "#5B7883", "#8AA8B0", "#F5C9C9", "#D4F5E4", "#FFE08A",
      "#2AABB8", "#D98E36", "#1A6B4A", "#D96B6B", "#E6F1F3",
      "#FFE08A", "#FFB347", "#FF6B6B", "#4ECDC4",
    ];

    for (let d = 0; d < dims; d++) {
      ctx.strokeStyle = colors[d % colors.length];
      ctx.lineWidth = d >= 15 ? 2 : 1;
      ctx.globalAlpha = d >= 15 ? 1 : 0.5;
      ctx.beginPath();
      for (let i = 0; i < sequence.length; i++) {
        const x = padL + (plotW * i) / Math.max(1, sequence.length - 1);
        const y = padT + plotH - ((sequence[i][d] - minV) / range) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Línea del frame actual
    if (currentFrame < sequence.length) {
      const x = padL + (plotW * currentFrame) / Math.max(1, sequence.length - 1);
      ctx.strokeStyle = "#D98E36";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#5B7883";
    ctx.font = "9px monospace";
    ctx.fillText(minV.toFixed(2), 2, padT + plotH);
    ctx.fillText(maxV.toFixed(2), 2, padT + 10);
    ctx.fillText("frames →", padL, h - 5);
  }, [sequence, currentFrame]);

  return (
    <div className="overflow-x-auto">
      <canvas ref={canvasRef} width={900} height={200} className="w-full" />
      <div className="mt-2 flex flex-wrap gap-2">
        {labels.map((l, i) => (
          <span key={i} className="flex items-center gap-1 text-[9px] text-[#8AA8B0]">
            <span className="h-2 w-2 rounded-full" style={{
              backgroundColor: ["#2AABB8","#D98E36","#1A6B4A","#D96B6B","#E6F1F3",
                "#5B7883","#8AA8B0","#F5C9C9","#D4F5E4","#FFE08A",
                "#2AABB8","#D98E36","#1A6B4A","#D96B6B","#E6F1F3",
                "#FFE08A","#FFB347","#FF6B6B","#4ECDC4"][i % 19]
            }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
