// retrain_page.jsx
// Página temporal que re-extrae landmarks de todos los videos con MediaPipe
// usando los parámetros afinados (confianza 0.25, 2 manos, suavizado temporal)
// y regenera los JSONs de entrenamiento via /api/train-sign

import React, { useCallback, useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

function cx(...c) { return c.filter(Boolean).join(" "); }

export default function RetrainPage({ isDark, navigate }) {
  const [manifest, setManifest] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, sign: "", status: "idle" });
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [mpReady, setMpReady] = useState(false);
  const handLandmarkerRef = useRef(null);
  const mpReadyRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    fetch("/api/training-data/manifest?t=" + Date.now())
      .then(r => r.json())
      .then(m => setManifest(m))
      .catch(e => setLogs(l => [...l, "Error cargiendo manifest: " + e.message]));
  }, []);

  // Inicializar MediaPipe
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
        const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: "CPU" },
          runningMode: "IMAGE",
          numHands: 2,
          minHandDetectionConfidence: 0.25,
          minHandPresenceConfidence: 0.25,
          minTrackingConfidence: 0.2,
        });
        if (cancelled) { hl.close(); return; }
        handLandmarkerRef.current = hl;
        mpReadyRef.current = true;
        setMpReady(true);
        setLogs(l => [...l, "MediaPipe inicializado (confianza 0.25, 2 manos)"]);
      } catch (e) {
        setLogs(l => [...l, "Error MediaPipe: " + e.message]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Extraer landmarks de un video frame por frame usando seek + detect
  const extractLandmarks = useCallback(async (videoUrl, signName) => {
    const video = videoRef.current;
    const hl = handLandmarkerRef.current;
    if (!video || !hl) throw new Error("Video o MediaPipe no listo");

    const frames = [];
    let prevRight = null;
    let prevLeft = null;
    const SMOOTH = 0.5;
    const lerp = (a, b, t) => a + (b - a) * t;
    const FRAME_STEP = 1 / 30; // 30fps
    const MAX_PERSIST = 10;
    const smoothHand = (lms, prev) => {
      if (!lms) return null;
      const out = prev ? lms.map((p, j) => ({
        x: lerp(prev[j].x, p.x, SMOOTH),
        y: lerp(prev[j].y, p.y, SMOOTH),
        z: lerp(prev[j].z || 0, p.z || 0, SMOOTH),
      })) : lms;
      return out.map(lm => ({ x: +lm.x.toFixed(4), y: +lm.y.toFixed(4), z: +lm.z.toFixed(4) }));
    };

    // Cargar video
    await new Promise((resolve, reject) => {
      video.src = videoUrl;
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error("Error cargiendo video: " + videoUrl));
    });

    const duration = video.duration;
    if (!duration || duration < 0.1) return { frames };

    // Procesar frame por frame con seek
    let t = 0;
    while (t < duration) {
      if (cancelRef.current) return { frames, cancelled: true };

      // Seek al tiempo del frame
      await new Promise((resolve) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = t;
      });

      // Pequeño delay para asegurar que el frame está decodificado
      await new Promise(r => setTimeout(r, 5));

      // Verificar que el video tiene dimensiones válidas
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        t += FRAME_STEP;
        continue;
      }

      try {
        const res = hl.detect(video);
        const allHands = res?.landmarks || [];
        const handedness = res?.handedness || [];

        let rightLms = null, leftLms = null;
        for (let i = 0; i < allHands.length; i++) {
          const label = handedness[i]?.[0]?.categoryName;
          if (label === "Right" && !rightLms) rightLms = allHands[i];
          else if (label === "Left" && !leftLms) leftLms = allHands[i];
          else if (!rightLms) rightLms = allHands[i];
          else if (!leftLms) leftLms = allHands[i];
        }

        const smoothedRight = smoothHand(rightLms, prevRight);
        const smoothedLeft = smoothHand(leftLms, prevLeft);
        if (smoothedRight) prevRight = smoothedRight;
        if (smoothedLeft) prevLeft = smoothedLeft;

        if (smoothedRight || smoothedLeft) {
          frames.push({ videoTime: t, landmarksRight: smoothedRight, landmarksLeft: smoothedLeft });
        } else if ((prevRight || prevLeft) && frames.length > 0) {
          // Persistencia: mantener última posición conocida de cada mano
          let lastGapStart = frames.length;
          while (lastGapStart > 0 && frames[lastGapStart - 1].persisted) lastGapStart--;
          const persistCount = frames.length - lastGapStart;
          if (persistCount < MAX_PERSIST) {
            frames.push({ videoTime: t, landmarksRight: prevRight, landmarksLeft: prevLeft, persisted: true });
          }
        }
      } catch (e) {
        // Error en detección, saltar frame
      }

      t += FRAME_STEP;
    }

    return { frames };
  }, []);

  // Procesar todas las señas
  const retrainAll = useCallback(async () => {
    if (!manifest || !mpReadyRef.current) return;
    cancelRef.current = false;
    setRunning(true);
    setDone(false);
    setLogs(l => [...l, "Iniciando re-entrenamiento..."]);

    // Recolectar todas las señas con sus categorías
    const allSigns = [];
    for (const [cat, signs] of Object.entries(manifest)) {
      for (const sign of signs) {
        allSigns.push({ cat, sign });
      }
    }

    setProgress({ current: 0, total: allSigns.length, sign: "", status: "starting" });

    let processed = 0;
    let saved = 0;
    let failed = 0;

    for (const { cat, sign } of allSigns) {
      if (cancelRef.current) break;
      setProgress({ current: processed, total: allSigns.length, sign: `${cat}/${sign}`, status: "processing" });

      const videoUrl = `/videos/signs/${sign}.mp4`;
      try {
        const { frames, cancelled } = await extractLandmarks(videoUrl, sign);
        if (cancelled) break;

        if (frames.length < 4) {
          setLogs(l => [...l, `⚠ ${sign}: solo ${frames.length} frames, saltando`]);
          failed++;
          processed++;
          continue;
        }

        // Guardar via API - reemplazar ejemplo _1
        const res = await fetch("/api/train-sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signName: sign,
            category: cat,
            examples: [frames],
          }),
        });
        const data = await res.json();
        if (data.ok) {
          saved++;
          setLogs(l => [...l, `✓ ${sign}: ${frames.length} frames guardados`]);
        } else {
          failed++;
          setLogs(l => [...l, `✗ ${sign}: ${data.error}`]);
        }
      } catch (e) {
        failed++;
        setLogs(l => [...l, `✗ ${sign}: ${e.message}`]);
      }
      processed++;
      setProgress({ current: processed, total: allSigns.length, sign: `${cat}/${sign}`, status: "done" });
    }

    setRunning(false);
    setDone(true);
    setLogs(l => [...l, `=== COMPLETADO: ${saved} guardados, ${failed} fallidos de ${allSigns.length} total ===`]);
  }, [manifest, extractLandmarks]);

  const panel = isDark ? "bg-[#101E24] border-[#1E3038]" : "bg-white border-[#D9E4E7]";
  const textMain = isDark ? "text-[#E6F1F3]" : "text-[#12303A]";
  const textSoft = isDark ? "text-[#8AA8B0]" : "text-[#5B7883]";

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className={cx("min-h-screen", isDark ? "bg-[#08151A]" : "bg-[#F4F8F9]")}>
      <header className={cx("flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3", panel)}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className={cx("rounded-lg px-3 py-1.5 text-xs font-bold", isDark ? "bg-[#1A2C33] text-[#8AA8B0]" : "bg-[#EDF3F4] text-[#5B7883]")}
          >
            ← Volver
          </button>
          <h1 className={cx("text-sm font-bold", textMain)}>Re-entrenamiento masivo</h1>
        </div>
        <button
          onClick={() => navigate("/model-test")}
          className="rounded-lg bg-[#2AABB8] px-3 py-1.5 text-xs font-bold text-white"
        >
          Probar modelo →
        </button>
      </header>

      <div className="p-4">
        {/* Video y canvas ocultos para procesamiento */}
        <div style={{ position: "absolute", left: -9999, top: -9999 }}>
          <video ref={videoRef} style={{ width: 640, height: 480 }} />
          <canvas ref={canvasRef} width={640} height={480} />
        </div>

        <div className={cx("rounded-xl border p-6", panel)}>
          <h2 className={cx("text-lg font-bold mb-4", textMain)}>Re-extraer landmarks de todos los videos</h2>
          <p className={cx("text-xs mb-4", textSoft)}>
            Procesa los {manifest ? Object.values(manifest).flat().length : "..."} videos en public/videos/signs/
            con MediaPipe (confianza 0.25, 2 manos, suavizado temporal 0.5, persistencia 10 frames)
            y regenera los JSONs de entrenamiento.
          </p>

          {!mpReady && (
            <div className="mb-4 rounded-lg bg-[#7A2B2B]/20 border border-[#7A2B2B]/40 px-4 py-2 text-xs text-[#D96B6B]">
              Esperando a que MediaPipe se inicialice...
            </div>
          )}

          {running && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className={cx("text-sm font-bold", textMain)}>
                  {progress.status === "processing" ? "Procesando" : "Listo"}: {progress.sign}
                </span>
                <span className={cx("text-sm font-mono", textSoft)}>
                  {progress.current} / {progress.total} ({pct}%)
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-[#1E3038]">
                <div
                  className="h-full bg-[#2AABB8] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {done && (
            <div className="mb-4 rounded-lg bg-[#1A6B4A]/20 border border-[#1A6B4A]/40 px-4 py-2 text-xs text-[#D4F5E4]">
              ✓ Re-entrenamiento completado. Ve a "Probar modelo" para verificar.
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={retrainAll}
              disabled={!manifest || !mpReady || running}
              className="rounded-lg bg-[#2AABB8] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {running ? "Procesando..." : "Iniciar re-entrenamiento"}
            </button>
            {running && (
              <button
                onClick={() => { cancelRef.current = true; }}
                className="rounded-lg bg-[#7A2B2B] px-6 py-2.5 text-sm font-bold text-white"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Logs */}
        {logs.length > 0 && (
          <div className={cx("mt-4 rounded-xl border p-4", panel)}>
            <h3 className={cx("text-xs font-bold mb-2", textSoft)}>Log</h3>
            <div className="max-h-96 overflow-y-auto font-mono text-[10px] space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className={cx(
                  line.startsWith("✓") ? "text-[#4ADE80]" :
                  line.startsWith("✗") || line.startsWith("⚠") ? "text-[#FBBF24]" :
                  line.startsWith("===") ? "text-[#2AABB8] font-bold" :
                  isDark ? "text-[#8AA8B0]" : "text-[#5B7883]"
                )}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
