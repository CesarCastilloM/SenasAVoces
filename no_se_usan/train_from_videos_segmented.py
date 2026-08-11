"""
Versión mejorada de train_from_videos.py que segmenta automáticamente
las repeticiones en cada video y usa solo la mejor ejecución.

Uso:
    python train_from_videos_segmented.py --categoria numeros
    python train_from_videos_segmented.py --todas
"""
from pathlib import Path
import sys
import json
import time
import argparse
import numpy as np

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from train_from_videos import (
    GLOSARIO_JSON, TEMPLATES_DIR, LOCAL_VIDEOS_DIR,
    normalize_pose_relative, normalize_hands_relative, slugify,
    HAND_MODEL, POSE_MODEL
)
from segment_video_repetitions import extract_and_segment_video

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision


def process_categoria_segmented(cat: dict, hand_lm, pose_lm, max_videos=None, force=False):
    """
    Procesa una categoría extrayendo solo la mejor repetición de cada video.
    """
    cat_id = cat["id"]
    senas = cat.get("senas", [])
    if max_videos:
        senas = senas[:max_videos]
    
    cat_dir = TEMPLATES_DIR / cat_id
    cat_dir.mkdir(parents=True, exist_ok=True)
    local_dir = LOCAL_VIDEOS_DIR / cat_id
    
    index = []
    stats = {
        'total': 0,
        'skipped_exists': 0,
        'skipped_no_video': 0,
        'single_segment': 0,
        'multi_segment': 0,
        'failed': 0,
        'success': 0
    }
    
    for i, sena in enumerate(senas, 1):
        stats['total'] += 1
        yt_id = sena.get("youtube_id", "")
        palabra = sena.get("palabra", "").strip()
        if not palabra:
            continue
        
        slug = slugify(palabra)
        out_path = cat_dir / f"{slug}.npz"
        
        if out_path.exists() and not force:
            print(f"  [{i}/{len(senas)}] {palabra} ⏭️  (ya existe)")
            stats['skipped_exists'] += 1
            try:
                existing = np.load(out_path)
                index.append({
                    "palabra": palabra,
                    "slug": slug,
                    "youtube_id": yt_id,
                    "frames": int(existing["hands"].shape[0]),
                    "segmented": existing.get("segmented", False)
                })
            except:
                pass
            continue
        
        # Buscar video local
        video_path = None
        for ext in (".mp4", ".webm", ".mkv", ".mov", ".avi"):
            candidate = local_dir / f"{slug}{ext}"
            if candidate.exists():
                video_path = candidate
                break
        
        if video_path is None:
            print(f"  [{i}/{len(senas)}] {palabra} ⏭️  (sin video local)")
            stats['skipped_no_video'] += 1
            continue
        
        print(f"  [{i}/{len(senas)}] {palabra} 📁 {video_path.name}", end=" ", flush=True)
        
        # Extraer y segmentar
        try:
            result = extract_and_segment_video(video_path, hand_lm, pose_lm)
        except Exception as e:
            print(f"✗ error: {e}")
            stats['failed'] += 1
            continue
        
        if result is None or not result['segments']:
            print("✗ sin segmentos")
            stats['failed'] += 1
            continue
        
        segments = result['segments']
        
        # Seleccionar mejor segmento
        best = max(segments, key=lambda s: s['score'])
        
        if len(segments) == 1:
            stats['single_segment'] += 1
            print(f"(1 seg, {best['duration']}f)", end=" ", flush=True)
        else:
            stats['multi_segment'] += 1
            print(f"({len(segments)} segs, mejor={best['duration']}f)", end=" ", flush=True)
        
        # Normalizar
        try:
            pose_norm = normalize_pose_relative(best['pose'])
            hands_norm = normalize_hands_relative(best['hands'], best['pose'])
        except Exception as e:
            print(f"✗ normalización: {e}")
            stats['failed'] += 1
            continue
        
        # Guardar
        np.savez_compressed(
            out_path,
            hands=hands_norm.astype(np.float32),
            pose=pose_norm.astype(np.float32),
            hands_raw=best['hands'].astype(np.float32),
            pose_raw=best['pose'].astype(np.float32),
            fps=np.array([result['fps']], dtype=np.int32),
            label=np.array([palabra], dtype="U64"),
            segmented=np.array([True], dtype=bool),
            segment_score=np.array([best['score']], dtype=np.float32),
            total_segments=np.array([len(segments)], dtype=np.int32)
        )
        
        index.append({
            "palabra": palabra,
            "slug": slug,
            "youtube_id": yt_id,
            "frames": int(hands_norm.shape[0]),
            "segmented": True,
            "total_segments": len(segments),
            "score": float(best['score'])
        })
        
        print(f"✓")
        stats['success'] += 1
    
    # Guardar índice
    (cat_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    
    return index, stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--categoria", help="ID de categoría")
    parser.add_argument("--todas", action="store_true", help="Procesar todas")
    parser.add_argument("--max", type=int, default=None, help="Máximo videos por categoría")
    parser.add_argument("--force", action="store_true", help="Sobrescribir NPZ existentes (re-segmentar todo)")
    args = parser.parse_args()
    
    if not GLOSARIO_JSON.exists():
        print(f"ERROR: {GLOSARIO_JSON} no existe")
        return 1
    
    glosario = json.loads(GLOSARIO_JSON.read_text(encoding="utf-8"))
    categorias = glosario["categorias"]
    
    if args.categoria:
        cats = [c for c in categorias if c["id"] == args.categoria]
        if not cats:
            print(f"ERROR: categoría '{args.categoria}' no encontrada")
            return 1
    elif args.todas:
        cats = [c for c in categorias if c.get("total_senas", 0) > 0]
    else:
        cats = [c for c in categorias if c.get("total_senas", 0) > 0]
        print("Categorías disponibles:")
        for c in cats:
            print(f"  - {c['id']}  ({c['total_senas']} señas)")
        print("\nUsa --categoria <id> o --todas")
        return 0
    
    print(f"\n🎯 Procesando {len(cats)} categoría(s) con SEGMENTACIÓN AUTOMÁTICA...\n")
    
    # Inicializar MediaPipe
    hand_options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    pose_options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(POSE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    
    full_index = {}
    global_stats = {
        'total': 0,
        'skipped_exists': 0,
        'skipped_no_video': 0,
        'single_segment': 0,
        'multi_segment': 0,
        'failed': 0,
        'success': 0
    }
    
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:
        
        for cat in cats:
            print(f"\n📂 {cat['nombre']} ({cat['id']})")
            t0 = time.time()
            idx, stats = process_categoria_segmented(cat, hand_lm, pose_lm, max_videos=args.max, force=args.force)
            
            full_index[cat["id"]] = {
                "nombre": cat["nombre"],
                "leccion_academia": cat.get("leccion_academia", ""),
                "senas": idx,
                "stats": stats
            }
            
            # Acumular estadísticas
            for k in global_stats:
                global_stats[k] += stats[k]
            
            print(f"  ⏱️  {time.time()-t0:.1f}s · {len(idx)} señas procesadas")
            print(f"     ✓ {stats['success']} nuevas | "
                  f"⏭️  {stats['skipped_exists']} existían | "
                  f"🔀 {stats['multi_segment']} multi-seg | "
                  f"✗ {stats['failed']} fallidas")
    
    # Guardar índice global
    (TEMPLATES_DIR / "index_segmented.json").write_text(
        json.dumps(full_index, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    
    print(f"\n{'='*60}")
    print("📊 ESTADÍSTICAS GLOBALES")
    print(f"{'='*60}")
    print(f"Total procesadas:        {global_stats['total']}")
    print(f"  ✓ Exitosas:            {global_stats['success']}")
    print(f"  ⏭️  Ya existían:         {global_stats['skipped_exists']}")
    print(f"  ⏭️  Sin video local:     {global_stats['skipped_no_video']}")
    print(f"  ✗ Fallidas:            {global_stats['failed']}")
    print(f"\nSegmentación:")
    print(f"  📹 Video completo:      {global_stats['single_segment']}")
    print(f"  🔀 Multi-repetición:    {global_stats['multi_segment']}")
    
    if global_stats['multi_segment'] > 0:
        pct = 100 * global_stats['multi_segment'] / (global_stats['success'] or 1)
        print(f"\n💡 {pct:.1f}% de videos tenían múltiples repeticiones")
        print(f"   → Se usó solo la mejor repetición de cada uno")
    
    print(f"\n✅ Plantillas guardadas en {TEMPLATES_DIR}")
    print(f"   Índice: {TEMPLATES_DIR / 'index_segmented.json'}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
