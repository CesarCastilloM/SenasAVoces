"""
train_from_videos.py — Pipeline de "entrenamiento" sobre los videos del
Glosario Digital LSM CDMX.

NO entrena una red neuronal — extrae plantillas de keypoints (manos +
pose) de cada video y las guarda como NPZ. En runtime, el backend compara
la secuencia del usuario con la plantilla usando DTW (Dynamic Time Warping)
para reconocer cualquier seña.

Uso:
    python train_from_videos.py --categoria numeros          # solo números
    python train_from_videos.py --categoria colores
    python train_from_videos.py --todas                       # todas (348 videos, ~3 GB)
    python train_from_videos.py --max 5                       # solo 5 videos por categoría (prueba)

Requiere:
    pip install yt-dlp mediapipe opencv-python numpy
    + ffmpeg en el PATH

Salida:
    data/templates/{categoria}/{slug}.npz   (keypoints normalizados)
    data/templates/index.json               (metadata)
"""
import argparse
import json
import re
import shutil
import subprocess
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

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# === Paths ===
ROOT = Path(__file__).resolve().parent
GLOSARIO_JSON = ROOT / "data" / "lsm_lecciones_glosario_cdmx.json"
TEMPLATES_DIR = ROOT / "data" / "templates"
VIDEOS_CACHE = ROOT / "data" / "videos_cache"
HAND_MODEL = str(ROOT / "mediapipe_models" / "hand_landmarker.task")
POSE_MODEL = str(ROOT / "mediapipe_models" / "pose_landmarker.task")

TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_CACHE.mkdir(parents=True, exist_ok=True)

# === Configuración de extracción ===
TARGET_FPS = 15            # 15 fps suficiente para señas (no perdemos info)
MAX_FRAMES = 45            # 3 segundos máximo por seña (suficiente para LSM)
MIN_FRAMES = 8             # menos de 8 frames = no usable


def slugify(text: str) -> str:
    text = text.upper().strip()
    text = re.sub(r"[ÁÀÄÂ]", "A", text)
    text = re.sub(r"[ÉÈËÊ]", "E", text)
    text = re.sub(r"[ÍÌÏÎ]", "I", text)
    text = re.sub(r"[ÓÒÖÔ]", "O", text)
    text = re.sub(r"[ÚÙÜÛ]", "U", text)
    text = re.sub(r"[Ñ]", "N", text)
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return text.strip("_")[:40]


def download_video(youtube_id: str, target_path: Path) -> bool:
    if target_path.exists() and target_path.stat().st_size > 1000:
        return True
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    opts = {
        "format": "best[height<=480][ext=mp4]/best[height<=720]/best",
        "outtmpl": str(target_path.with_suffix(".%(ext)s")),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        # Buscar el archivo descargado (puede ser .mp4 o .webm)
        for ext in (".mp4", ".webm", ".mkv"):
            p = target_path.with_suffix(ext)
            if p.exists():
                if p != target_path:
                    p.rename(target_path)
                return True
        return False
    except Exception as e:
        print(f"    ✗ Error descargando {youtube_id}: {e}")
        return False


def extract_keypoints_from_video(video_path: Path, hand_lm, pose_lm) -> dict:
    """
    Procesa el video y devuelve secuencias de keypoints normalizados.
    - hands: (T, 2, 21, 3) — hasta 2 manos, 21 puntos (x,y,z) c/u
    - pose:  (T, 33, 3)    — 33 puntos del cuerpo
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    # WebM de MediaRecorder reporta fps=1000 (basura). Usamos total frames y duración real
    # o caemos a 30 fps si el valor está fuera de rango razonable.
    if src_fps > 120 or src_fps < 5:
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        # Asumir que el clip dura ~3-6s típico de práctica → fps ≈ total / 4
        src_fps = max(15.0, min(60.0, total / 4.0)) if total > 30 else 30.0
    skip = max(1, int(round(src_fps / TARGET_FPS)))
    frame_idx = 0

    hands_seq = []   # cada item: (2, 21, 3)
    pose_seq = []    # cada item: (33, 3)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % skip != 0:
            frame_idx += 1
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # NOTA: usamos detect() (IMAGE mode) en vez de detect_for_video() para evitar
        # el requisito de timestamps monotonicamente crecientes entre videos distintos.
        # Esto permite reusar el mismo Landmarker para multiples videos.

        # --- Manos ---
        hands_arr = np.zeros((2, 21, 3), dtype=np.float32)
        try:
            hres = hand_lm.detect(mp_img)
            if hres.hand_landmarks:
                for h_idx, hand in enumerate(hres.hand_landmarks[:2]):
                    for j, lm in enumerate(hand[:21]):
                        hands_arr[h_idx, j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass

        # --- Pose ---
        pose_arr = np.zeros((33, 3), dtype=np.float32)
        try:
            pres = pose_lm.detect(mp_img)
            if pres.pose_landmarks:
                for j, lm in enumerate(pres.pose_landmarks[0][:33]):
                    pose_arr[j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass

        hands_seq.append(hands_arr)
        pose_seq.append(pose_arr)

        frame_idx += 1
        if len(hands_seq) >= MAX_FRAMES:
            break

    cap.release()

    if len(hands_seq) < MIN_FRAMES:
        return None

    return {
        "hands": np.stack(hands_seq, axis=0),
        "pose": np.stack(pose_seq, axis=0),
        "fps": TARGET_FPS,
    }


def normalize_pose_relative(pose_seq: np.ndarray) -> np.ndarray:
    """Centrar pose en mid-shoulders y normalizar por distancia hombros."""
    out = pose_seq.copy()
    # MediaPipe Pose: 11=L_shoulder, 12=R_shoulder
    if out.shape[0] == 0:
        return out
    mid = (out[:, 11] + out[:, 12]) / 2.0  # (T, 3)
    dist = np.linalg.norm(out[:, 11, :2] - out[:, 12, :2], axis=1)  # (T,)
    dist[dist < 1e-6] = 1.0
    for t in range(out.shape[0]):
        out[t] = out[t] - mid[t]
        out[t, :, :2] /= dist[t]
    return out


def normalize_hands_relative(hands_seq: np.ndarray, pose_seq: np.ndarray) -> np.ndarray:
    """Centrar manos en muñeca correspondiente y normalizar por palma."""
    out = hands_seq.copy()
    for t in range(out.shape[0]):
        for h in range(2):
            wrist = out[t, h, 0]
            if np.allclose(wrist, 0):
                continue
            mcp = out[t, h, 9]      # MCP medio
            scale = np.linalg.norm(mcp[:2] - wrist[:2]) or 1.0
            out[t, h] = out[t, h] - wrist
            out[t, h, :, :2] /= scale
    return out


LOCAL_VIDEOS_DIR = ROOT / "data" / "training_videos"


def process_categoria(cat: dict, hand_lm, pose_lm, max_videos=None, source="local"):
    """
    source: 'local'   → usa videos en data/training_videos/{cat_id}/{slug}.mp4
            'youtube' → descarga con yt-dlp (suele fallar para CDMX)
    """
    cat_id = cat["id"]
    senas = cat.get("senas", [])
    if max_videos:
        senas = senas[:max_videos]

    cat_dir = TEMPLATES_DIR / cat_id
    cat_dir.mkdir(parents=True, exist_ok=True)
    local_dir = LOCAL_VIDEOS_DIR / cat_id
    local_dir.mkdir(parents=True, exist_ok=True)

    index = []
    for i, sena in enumerate(senas, 1):
        yt_id = sena.get("youtube_id", "")
        palabra = sena.get("palabra", "").strip()
        if not palabra:
            continue

        slug = slugify(palabra)
        out_path = cat_dir / f"{slug}.npz"
        if out_path.exists():
            print(f"  [{i}/{len(senas)}] {palabra} ⏭️  (ya existe)")
            index.append({"palabra": palabra, "slug": slug, "youtube_id": yt_id, "frames": int(np.load(out_path)["hands"].shape[0])})
            continue

        # Resolver fuente del video
        video_path = None
        print(f"  [{i}/{len(senas)}] {palabra}", end=" ", flush=True)

        if source == "local":
            # Buscar archivo local con cualquier extensión
            for ext in (".mp4", ".webm", ".mkv", ".mov", ".avi"):
                candidate = local_dir / f"{slug}{ext}"
                if candidate.exists():
                    video_path = candidate
                    break
            if video_path is None:
                print(f"⏭️  no hay video local en {local_dir / (slug + '.mp4')}")
                continue
            print(f"📁 {video_path.name}", end=" ", flush=True)
        else:
            # source == "youtube"
            if not yt_id:
                print("✗ sin youtube_id")
                continue
            video_path = VIDEOS_CACHE / f"{yt_id}.mp4"
            if not download_video(yt_id, video_path):
                print("✗ descarga fallida (video privado/restringido)")
                continue
            print("📥", end=" ", flush=True)

        # 2. Extraer keypoints
        try:
            data = extract_keypoints_from_video(video_path, hand_lm, pose_lm)
        except Exception as e:
            print(f"✗ extracción falló: {e}")
            continue

        if data is None:
            print("✗ pocos frames")
            continue

        # 3. Normalizar
        pose_norm = normalize_pose_relative(data["pose"])
        hands_norm = normalize_hands_relative(data["hands"], data["pose"])

        # 4. Guardar
        np.savez_compressed(
            out_path,
            hands=hands_norm.astype(np.float32),
            pose=pose_norm.astype(np.float32),
            hands_raw=data["hands"].astype(np.float32),
            pose_raw=data["pose"].astype(np.float32),
            fps=np.array([data["fps"]], dtype=np.int32),
            label=np.array([palabra], dtype="U64"),
        )
        index.append({
            "palabra": palabra,
            "slug": slug,
            "youtube_id": yt_id,
            "frames": int(data["hands"].shape[0]),
        })
        print(f"✓ {data['hands'].shape[0]} frames")

    # Guardar índice de la categoría
    (cat_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    return index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--categoria", help="ID de categoría (numeros, colores, etc.)")
    parser.add_argument("--todas", action="store_true", help="Procesar todas")
    parser.add_argument("--max", type=int, default=None, help="Máximo videos por categoría")
    parser.add_argument("--keep-videos", action="store_true",
                        help="Conservar videos descargados (default: borrar al final)")
    parser.add_argument("--source", choices=["local", "youtube"], default="local",
                        help="local: data/training_videos/{cat}/{slug}.mp4  |  "
                             "youtube: descarga con yt-dlp (suele fallar para CDMX)")
    args = parser.parse_args()

    if not GLOSARIO_JSON.exists():
        print(f"ERROR: no existe {GLOSARIO_JSON}. Ejecuta primero: python extract_lsm.py")
        sys.exit(1)

    glosario = json.loads(GLOSARIO_JSON.read_text(encoding="utf-8"))
    categorias = glosario["categorias"]

    if args.categoria:
        cats = [c for c in categorias if c["id"] == args.categoria]
        if not cats:
            print(f"ERROR: categoría '{args.categoria}' no encontrada")
            sys.exit(1)
    elif args.todas:
        cats = [c for c in categorias if c.get("total_senas", 0) > 0]
    else:
        # Por defecto: solo categorías con datos
        cats = [c for c in categorias if c.get("total_senas", 0) > 0]
        print("Categorías disponibles con datos:")
        for c in cats:
            print(f"  - {c['id']}  ({c['total_senas']} señas)")
        print("\nUsa --categoria <id> o --todas")
        sys.exit(0)

    print(f"\n🎯 Procesando {len(cats)} categoría(s)...\n")

    # Inicializar landmarkers en VIDEO mode
    hand_options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=HAND_MODEL),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    pose_options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=POSE_MODEL),
        running_mode=mp_vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )

    full_index = {}
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:
        for cat in cats:
            print(f"\n📂 {cat['nombre']} ({cat['id']})")
            t0 = time.time()
            idx = process_categoria(cat, hand_lm, pose_lm,
                                    max_videos=args.max, source=args.source)
            full_index[cat["id"]] = {
                "nombre": cat["nombre"],
                "leccion_academia": cat.get("leccion_academia", ""),
                "senas": idx,
            }
            print(f"  ⏱️  {time.time()-t0:.1f}s · {len(idx)} señas procesadas")

    # Índice global
    (TEMPLATES_DIR / "index.json").write_text(
        json.dumps(full_index, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # Limpiar videos cacheados
    if not args.keep_videos:
        print("\n🗑️  Limpiando videos cacheados...")
        shutil.rmtree(VIDEOS_CACHE, ignore_errors=True)
        VIDEOS_CACHE.mkdir(exist_ok=True)

    print(f"\n✅ Plantillas guardadas en {TEMPLATES_DIR}")
    print(f"   Índice global: {TEMPLATES_DIR / 'index.json'}")


if __name__ == "__main__":
    main()
