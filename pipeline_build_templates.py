"""
pipeline_build_templates.py — Pipeline completo para construir plantillas NPZ
desde los videos del Glosario Digital LSM CDMX.

Captura (por frame):
  • Manos       (2, 21, 3)  — 21 landmarks por mano
  • Pose/Brazos (33, 3)     — hombros, codos, muñecas, torso completo
  • Cara        (10, 2)     — cejas, ojos, boca (puntos clave de expresión facial)
                              LSM usa cejas y boca para negar, preguntar, enfatizar

Pasos automáticos:
  1. Lee lsm_lecciones_glosario_cdmx.json  →  señas con youtube_id
  2. Descarga con yt-dlp (360p/480p)
  3. Extrae manos + pose + cara con MediaPipe frame a frame (IMAGE mode)
  4. Detecta repeticiones y elige la de MAYOR CALIDAD
  5. Normaliza keypoints (muñeca / hombros / cara centrada en nariz)
  6. Guarda data/templates/{categoria}/{slug}.npz
  7. Genera data/templates/index.json

Uso:
    python pipeline_build_templates.py
    python pipeline_build_templates.py --cat numeros
    python pipeline_build_templates.py --cat numeros --max 10
    python pipeline_build_templates.py --reprocess
    python pipeline_build_templates.py --dry-run

Requiere:
    pip install yt-dlp mediapipe opencv-python numpy
    + ffmpeg en el PATH
"""
import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path

import cv2
import numpy as np

try:
    import yt_dlp
except ImportError:
    print("ERROR: pip install yt-dlp")
    sys.exit(1)

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
except ImportError:
    print("ERROR: pip install mediapipe")
    sys.exit(1)

# ─────────────────────────────────────────────
# Rutas
# ─────────────────────────────────────────────
ROOT          = Path(__file__).resolve().parent
GLOSARIO_JSON = ROOT / "data" / "lsm_lecciones_glosario_cdmx.json"
TEMPLATES_DIR = ROOT / "data" / "templates"
CACHE_DIR     = ROOT / "data" / "videos_cache"
HAND_MODEL    = ROOT / "mediapipe_models" / "hand_landmarker.task"
POSE_MODEL    = ROOT / "mediapipe_models" / "pose_landmarker.task"
FACE_MODEL    = ROOT / "mediapipe_models" / "face_landmarker.task"

TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────
# Parámetros de extracción
# ─────────────────────────────────────────────
TARGET_FPS        = 15      # fps de muestreo (suficiente para LSM)
MAX_FRAMES        = 120     # tope de frames por video completo (~8 s a 15 fps)
MIN_FRAMES_VIDEO  = 8       # videos con menos frames son descartados

# Segmentación de repeticiones
MIN_PAUSE_FRAMES    = 4     # frames sin mano para cortar segmento
MIN_SEGMENT_FRAMES  = 8     # frames mínimos por repetición
MAX_SEGMENT_FRAMES  = 60    # tope de frames por repetición seleccionada

# ─────────────────────────────────────────────
# Índices de landmarks faciales clave (Face Landmarker, 478 puntos)
# Solo guardamos los más relevantes para expresión en LSM
# ─────────────────────────────────────────────
# Cejas: arriba/abajo indica negación, pregunta sí/no
CEJA_IZQ  = [70, 63, 105, 66, 107]   # ceja izquierda (5 pts)
CEJA_DER  = [336, 296, 334, 293, 300] # ceja derecha   (5 pts)
# Boca: apertura indica énfasis, sorpresa, negación
BOCA      = [13, 14, 78, 308, 61, 291, 17, 0]  # labios superior/inferior/comisuras
# Ojos: apertura / guiño
OJO_IZQ   = [159, 145, 33, 133]       # ojo izquierdo
OJO_DER   = [386, 374, 362, 263]      # ojo derecho
# Nariz (referencia para normalización)
NARIZ     = [1, 4]                    # punta y base

FACE_IDXS = CEJA_IZQ + CEJA_DER + BOCA + OJO_IZQ + OJO_DER + NARIZ  # 30 puntos
N_FACE    = len(FACE_IDXS)  # 30

# Índices de pose relevantes para brazos (MediaPipe Pose 33 landmarks)
# 11=L_shoulder 12=R_shoulder 13=L_elbow 14=R_elbow 15=L_wrist 16=R_wrist
# 23=L_hip 24=R_hip  (referencia de torso)
ARMS_IDXS = [11, 12, 13, 14, 15, 16, 23, 24]
N_ARMS    = len(ARMS_IDXS)  # 8


# ─────────────────────────────────────────────
# Utilidades
# ─────────────────────────────────────────────
def slugify(text: str) -> str:
    text = text.upper().strip()
    for src, dst in [("ÁÀÄÂ","A"),("ÉÈËÊ","E"),("ÍÌÏÎ","I"),("ÓÒÖÔ","O"),("ÚÙÜÛ","U"),("Ñ","N")]:
        for c in src:
            text = text.replace(c, dst)
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return text.strip("_")[:40]


def download_video(yt_id: str, out_path: Path) -> bool:
    """Descarga el video de YouTube. Devuelve True si existe o se descargó."""
    if out_path.exists() and out_path.stat().st_size > 5_000:
        return True
    url = f"https://www.youtube.com/watch?v={yt_id}"
    opts = {
        "format": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/best",
        "outtmpl": str(out_path.with_suffix(".%(ext)s")),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "merge_output_format": "mp4",
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        for ext in (".mp4", ".webm", ".mkv"):
            p = out_path.with_suffix(ext)
            if p.exists() and p.stat().st_size > 5_000:
                if p != out_path:
                    p.rename(out_path)
                return True
        return False
    except Exception as e:
        print(f"    ✗ descarga: {e}")
        return False


# ─────────────────────────────────────────────
# Extracción de keypoints (frame a frame)
# ─────────────────────────────────────────────
def extract_keypoints(video_path: Path, hand_lm, pose_lm, face_lm) -> dict | None:
    """
    Extrae por frame:
      - hands (T, 2, 21, 3)  — ambas manos
      - pose  (T, 33, 3)     — cuerpo completo (brazos incluidos)
      - arms  (T, 8,  3)     — subconjunto de pose: hombros, codos, muñecas, caderas
      - face  (T, 30, 2)     — puntos clave de expresión facial (cejas, boca, ojos)
    Usa IMAGE mode — sin restricción de timestamps.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if src_fps > 120 or src_fps < 5:
        src_fps = 30.0
    skip = max(1, int(round(src_fps / TARGET_FPS)))

    hands_seq, pose_seq, face_seq = [], [], []
    fi = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if fi % skip != 0:
            fi += 1
            continue

        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # --- Manos (2, 21, 3) ---
        h_arr = np.zeros((2, 21, 3), dtype=np.float32)
        try:
            hres = hand_lm.detect(mp_img)
            if hres.hand_landmarks:
                for hi, hand in enumerate(hres.hand_landmarks[:2]):
                    for j, lm in enumerate(hand[:21]):
                        h_arr[hi, j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass

        # --- Pose completa (33, 3) — incluye brazos ---
        p_arr = np.zeros((33, 3), dtype=np.float32)
        try:
            pres = pose_lm.detect(mp_img)
            if pres.pose_landmarks:
                for j, lm in enumerate(pres.pose_landmarks[0][:33]):
                    p_arr[j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass

        # --- Cara: 30 puntos clave de expresión (cejas, boca, ojos) (N_FACE, 2) ---
        # Solo x,y — z de cara es poco confiable en video YouTube
        f_arr = np.zeros((N_FACE, 2), dtype=np.float32)
        try:
            fres = face_lm.detect(mp_img)
            if fres.face_landmarks:
                lms = fres.face_landmarks[0]  # primera cara
                for i, idx in enumerate(FACE_IDXS):
                    if idx < len(lms):
                        f_arr[i] = (lms[idx].x, lms[idx].y)
        except Exception:
            pass

        hands_seq.append(h_arr)
        pose_seq.append(p_arr)
        face_seq.append(f_arr)
        fi += 1
        if len(hands_seq) >= MAX_FRAMES:
            break

    cap.release()

    if len(hands_seq) < MIN_FRAMES_VIDEO:
        return None

    hands_np = np.stack(hands_seq)  # (T, 2, 21, 3)
    pose_np  = np.stack(pose_seq)   # (T, 33, 3)
    face_np  = np.stack(face_seq)   # (T, N_FACE, 2)

    # Extraer subconjunto de brazos de la pose completa
    arms_np  = pose_np[:, ARMS_IDXS, :]  # (T, 8, 3)

    return {
        "hands": hands_np,
        "pose":  pose_np,
        "arms":  arms_np,
        "face":  face_np,
    }


# ─────────────────────────────────────────────
# Detección y selección de repeticiones
# ─────────────────────────────────────────────
def find_segments(hands_seq: np.ndarray) -> list[tuple[int, int]]:
    """Detecta bloques de actividad separados por pausas sin manos."""
    T = hands_seq.shape[0]
    has_hand = np.array([not np.all(hands_seq[t] == 0) for t in range(T)])

    # Suavizar: rellenar gaps cortos dentro de un segmento
    gap_tol = max(2, MIN_PAUSE_FRAMES // 2)
    smooth = has_hand.copy()
    for t in range(gap_tol, T - gap_tol):
        if not smooth[t] and smooth[t - 1] and smooth[t + 1]:
            smooth[t] = True

    segments, in_seg, seg_start, no_hand = [], False, 0, 0
    for t in range(T):
        if smooth[t]:
            if not in_seg:
                seg_start, in_seg = t, True
            no_hand = 0
        else:
            if in_seg:
                no_hand += 1
                if no_hand >= MIN_PAUSE_FRAMES:
                    end = t - no_hand
                    if end - seg_start >= MIN_SEGMENT_FRAMES:
                        segments.append((seg_start, end))
                    in_seg, no_hand = False, 0
    if in_seg:
        end = T - 1
        if end - seg_start >= MIN_SEGMENT_FRAMES:
            segments.append((seg_start, end))

    return segments or [(0, T - 1)]


def score_segment(hands: np.ndarray, pose: np.ndarray, face: np.ndarray,
                  s: int, e: int) -> float:
    """
    Calidad de un segmento:
      - 40% cobertura de manos
      - 25% movimiento de manos
      - 20% cobertura de pose (brazos visibles)
      - 15% actividad facial (cejas/boca en movimiento)
    """
    h = hands[s:e]
    p = pose[s:e]
    f = face[s:e]

    # Cobertura de manos
    cov_h = float(np.mean([not np.all(h[t] == 0) for t in range(len(h))]))

    # Movimiento de manos
    motion = 0.0
    for hi in range(2):
        pos   = h[:, hi, :, :2]
        valid = ~np.all(pos == 0, axis=(1, 2))
        if np.sum(valid) > 1:
            motion += float(np.var(pos[valid]))

    # Cobertura de pose (brazos: hombros + codos)
    arm_pts = p[:, [11, 12, 13, 14], :2]  # hombros y codos
    cov_p   = float(np.mean(~np.all(arm_pts == 0, axis=(1, 2))))

    # Actividad facial: varianza de cejas y boca
    # cejas = primeros 10 pts, boca = siguientes 8 pts
    face_active = 0.0
    if not np.all(f == 0):
        ceja_var = float(np.var(f[:, :10, :]))   # cejas
        boca_var = float(np.var(f[:, 10:18, :])) # boca
        face_active = min((ceja_var + boca_var) * 10.0, 1.0)

    return (cov_h   * 0.40
            + min(motion, 0.5) * 0.25
            + cov_p * 0.20
            + face_active * 0.15)


def best_segment(hands: np.ndarray, pose: np.ndarray,
                 face: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """Retorna (hands, pose, face, info) del segmento de mayor calidad."""
    segs   = find_segments(hands)
    scored = []
    for s, e in segs:
        length = e - s
        if length > MAX_SEGMENT_FRAMES:
            trim = (length - MAX_SEGMENT_FRAMES) // 2
            s, e = s + trim, e - trim
        sc = score_segment(hands, pose, face, s, e)
        scored.append((sc, s, e))

    scored.sort(reverse=True)
    best_sc, bs, be = scored[0]
    info = {
        "n_reps":     len(segs),
        "best_score": round(best_sc, 3),
        "best_start": bs,
        "best_end":   be,
        "best_frames": be - bs,
    }
    return hands[bs:be], pose[bs:be], face[bs:be], info


# ─────────────────────────────────────────────
# Normalización
# ─────────────────────────────────────────────
def normalize_pose(pose: np.ndarray) -> np.ndarray:
    """Centrar en mid-shoulders, escalar por distancia entre hombros."""
    out  = pose.copy()
    mid  = (out[:, 11] + out[:, 12]) / 2.0
    dist = np.linalg.norm(out[:, 11, :2] - out[:, 12, :2], axis=1)
    dist[dist < 1e-6] = 1.0
    for t in range(out.shape[0]):
        out[t] -= mid[t]
        out[t, :, :2] /= dist[t]
    return out


def normalize_hands(hands: np.ndarray) -> np.ndarray:
    """Centrar cada mano en su muñeca, escalar por largo de palma."""
    out = hands.copy()
    for t in range(out.shape[0]):
        for h in range(2):
            wrist = out[t, h, 0]
            if np.allclose(wrist, 0):
                continue
            scale = np.linalg.norm(out[t, h, 9, :2] - wrist[:2]) or 1.0
            out[t, h] -= wrist
            out[t, h, :, :2] /= scale
    return out


def normalize_face(face: np.ndarray) -> np.ndarray:
    """
    Centrar cara en la nariz (últimos 2 pts = índices NARIZ),
    escalar por distancia interceja.
    """
    out = face.copy()
    # nariz = últimos 2 puntos del array (índices -2 y -1)
    nariz = out[:, -2:, :].mean(axis=1)   # (T, 2)
    # distancia entre ceja izq media y ceja der media
    ceja_l = out[:, 2, :]   # punto central ceja izq
    ceja_r = out[:, 7, :]   # punto central ceja der
    scale  = np.linalg.norm(ceja_l - ceja_r, axis=1)  # (T,)
    scale[scale < 1e-6] = 1.0
    for t in range(out.shape[0]):
        if np.all(face[t] == 0):
            continue
        out[t] -= nariz[t]
        out[t] /= scale[t]
    return out


# ─────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────
def process_sign(sena: dict, cat_id: str, hand_lm, pose_lm, face_lm,
                 reprocess: bool = False) -> dict | None:
    """
    Procesa UNA seña: descarga → extrae → segmenta → normaliza → guarda NPZ.
    Devuelve metadata o None si falló.
    """
    palabra  = sena["palabra"].strip()
    yt_id    = sena.get("youtube_id", "")
    if not palabra or not yt_id:
        return None

    slug     = slugify(palabra)
    cat_dir  = TEMPLATES_DIR / cat_id
    cat_dir.mkdir(parents=True, exist_ok=True)
    out_path = cat_dir / f"{slug}.npz"

    if out_path.exists() and not reprocess:
        data = np.load(out_path, allow_pickle=True)
        return {
            "palabra": palabra, "slug": slug, "youtube_id": yt_id,
            "frames": int(data["hands"].shape[0]),
            "status": "cached",
        }

    # 1 — Descargar
    video_path = CACHE_DIR / f"{yt_id}.mp4"
    print(f"    ↓ descargando {yt_id}…", end=" ", flush=True)
    if not download_video(yt_id, video_path):
        print("FALLO")
        return None
    print("ok", end=" ", flush=True)

    # 2 — Extraer keypoints
    raw = extract_keypoints(video_path, hand_lm, pose_lm, face_lm)
    if raw is None:
        print("→ sin frames útiles")
        return None

    # 3 — Detectar repeticiones y tomar la mejor
    h_best, p_best, f_best, seg_info = best_segment(
        raw["hands"], raw["pose"], raw["face"]
    )
    n_reps = seg_info["n_reps"]

    # 4 — Normalizar
    h_norm = normalize_hands(h_best)
    p_norm = normalize_pose(p_best)
    f_norm = normalize_face(f_best)
    a_norm = p_norm[:, ARMS_IDXS, :]   # brazos ya normalizados desde pose

    # Info de actividad facial para el log
    face_activity = float(np.var(f_norm[f_norm != 0])) if not np.all(f_best == 0) else 0.0
    face_tag = "👀 cara activa" if face_activity > 0.001 else ""

    # 5 — Guardar
    np.savez_compressed(
        out_path,
        # Keypoints normalizados (para DTW/matching)
        hands      = h_norm.astype(np.float32),   # (T, 2, 21, 3)
        pose       = p_norm.astype(np.float32),   # (T, 33, 3)
        arms       = a_norm.astype(np.float32),   # (T, 8, 3)  hombros+codos+muñecas+caderas
        face       = f_norm.astype(np.float32),   # (T, 30, 2) cejas+boca+ojos norm.
        # Keypoints crudos (para análisis / visualización)
        hands_raw  = h_best.astype(np.float32),
        pose_raw   = p_best.astype(np.float32),
        face_raw   = f_best.astype(np.float32),
        # Metadata
        fps        = np.array([TARGET_FPS], dtype=np.int32),
        label      = np.array([palabra], dtype="U64"),
        n_reps     = np.array([n_reps], dtype=np.int32),
        seg_score  = np.array([seg_info["best_score"]], dtype=np.float32),
        face_idxs  = np.array(FACE_IDXS, dtype=np.int32),
        arms_idxs  = np.array(ARMS_IDXS, dtype=np.int32),
    )

    frames = h_norm.shape[0]
    print(f"→ {frames}f  |  {n_reps} rep(s), score={seg_info['best_score']:.2f}  {face_tag}")
    return {
        "palabra": palabra, "slug": slug, "youtube_id": yt_id,
        "frames": frames, "n_reps": n_reps,
        "seg_score": seg_info["best_score"],
        "face_active": face_activity > 0.001,
        "status": "ok",
    }


def main():
    ap = argparse.ArgumentParser(description="Pipeline NPZ desde videos CDMX LSM")
    ap.add_argument("--cat",       help="ID de categoría (e.g. numeros, colores)")
    ap.add_argument("--max",       type=int, default=None, help="Máx señas por categoría")
    ap.add_argument("--reprocess", action="store_true", help="Sobreescribir NPZ existentes")
    ap.add_argument("--keep",      action="store_true", help="Conservar videos en cache")
    ap.add_argument("--dry-run",   action="store_true", dest="dry", help="Solo listar, no procesar")
    args = ap.parse_args()

    if not GLOSARIO_JSON.exists():
        print(f"ERROR: no existe {GLOSARIO_JSON}")
        sys.exit(1)
    if not HAND_MODEL.exists() or not POSE_MODEL.exists():
        print(f"ERROR: modelos de Manos/Pose no encontrados en {ROOT / 'mediapipe_models'}")
        print("  Hand:  https://developers.google.com/mediapipe/solutions/vision/hand_landmarker")
        print("  Pose:  https://developers.google.com/mediapipe/solutions/vision/pose_landmarker")
        print("  Face:  https://developers.google.com/mediapipe/solutions/vision/face_landmarker  (opcional)")
        sys.exit(1)

    glosario   = json.loads(GLOSARIO_JSON.read_text(encoding="utf-8"))
    categorias = glosario["categorias"]

    if args.cat:
        cats = [c for c in categorias if c["id"] == args.cat]
        if not cats:
            ids = [c["id"] for c in categorias]
            print(f"ERROR: categoría '{args.cat}' no encontrada.\nDisponibles: {ids}")
            sys.exit(1)
    else:
        cats = [c for c in categorias if c.get("total_senas", 0) > 0]

    if args.dry:
        print("\n📋 DRY RUN — categorías y señas disponibles:\n")
        total = 0
        for cat in cats:
            senas = cat["senas"][:args.max] if args.max else cat["senas"]
            print(f"  [{cat['id']}] {cat['nombre']}  →  {len(senas)} señas")
            for s in senas:
                print(f"      {s['palabra']}  (yt:{s.get('youtube_id','?')})")
            total += len(senas)
        print(f"\nTotal: {total} señas")
        return 0

    print(f"\n🚀  Pipeline LSM  |  {len(cats)} categoría(s)\n")

    # Inicializar MediaPipe una sola vez
    if not FACE_MODEL.exists():
        print(f"⚠️  Face Landmarker no encontrado en {FACE_MODEL}")
        print("   Descárgalo de: https://developers.google.com/mediapipe/solutions/vision/face_landmarker")
        print("   El pipeline continúa SIN datos faciales (face = ceros).")
        use_face = False
    else:
        use_face = True

    hand_opts = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    pose_opts = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(POSE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    face_opts = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(FACE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.3,
        min_face_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    ) if use_face else None

    full_index = {}
    t_global = time.time()
    n_ok = n_skip = n_fail = 0

    def run_pipeline(hand_lm, pose_lm, face_lm):
        nonlocal n_ok, n_skip, n_fail
        for cat in cats:
            cat_id = cat["id"]
            senas  = cat["senas"]
            if args.max:
                senas = senas[:args.max]

            print(f"\n📂  {cat['nombre']}  ({cat_id})  —  {len(senas)} señas")
            cat_results = []
            t_cat = time.time()

            for i, sena in enumerate(senas, 1):
                palabra = sena.get("palabra", "?")
                print(f"  [{i:3d}/{len(senas)}]  {palabra:<30}", end=" ", flush=True)
                try:
                    result = process_sign(sena, cat_id, hand_lm, pose_lm, face_lm,
                                         reprocess=args.reprocess)
                except Exception as ex:
                    print(f"ERROR: {ex}")
                    n_fail += 1
                    continue

                if result is None:
                    n_fail += 1
                elif result["status"] == "cached":
                    print(f"(ya existe, {result['frames']}f)")
                    n_skip += 1
                    cat_results.append(result)
                else:
                    n_ok += 1
                    cat_results.append(result)

            elapsed = time.time() - t_cat
            print(f"\n  ✅ {cat['nombre']}: {len(cat_results)} señas en {elapsed:.1f}s")
            full_index[cat_id] = {
                "nombre": cat["nombre"],
                "leccion": cat.get("leccion_academia", ""),
                "senas": cat_results,
            }

    with mp_vision.HandLandmarker.create_from_options(hand_opts) as hand_lm, \
         mp_vision.PoseLandmarker.create_from_options(pose_opts) as pose_lm:

        if face_opts:
            with mp_vision.FaceLandmarker.create_from_options(face_opts) as face_lm:
                run_pipeline(hand_lm, pose_lm, face_lm)
        else:
            run_pipeline(hand_lm, pose_lm, None)

    # Guardar índice global
    idx_path = TEMPLATES_DIR / "index.json"
    idx_path.write_text(json.dumps(full_index, ensure_ascii=False, indent=2), encoding="utf-8")

    elapsed_total = time.time() - t_global
    print(f"""
╔══════════════════════════════════════════╗
║  PIPELINE COMPLETADO                     ║
║  ✅ procesadas : {n_ok:<6}                  ║
║  ⏭️  en cache  : {n_skip:<6}                  ║
║  ✗  fallidas  : {n_fail:<6}                  ║
║  ⏱️  tiempo    : {elapsed_total:>6.1f}s               ║
║  📁 templates : {str(TEMPLATES_DIR)[:30]:30} ║
╚══════════════════════════════════════════╝
""")

    if not args.keep:
        print("🗑️  Limpiando caché de videos…")
        shutil.rmtree(CACHE_DIR, ignore_errors=True)
        CACHE_DIR.mkdir(exist_ok=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
