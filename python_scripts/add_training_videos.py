#!/usr/bin/env python3
"""
add_training_videos.py
Agrega grabaciones reales de senas desde una carpeta por sena:

  videos_entrenamiento/
    CASA/
      ana_1.mp4
      ana_2.mp4
      luis_1.mov
    COMO_ESTAS/
      ana_1.mp4

La carpeta es la sena, con el mismo nombre que en manifest.json (se quitan
acentos y espacios: "Cómo estás" -> COMO_ESTAS). El archivo es
<persona>_<toma>: la persona es lo que va antes del primer "_" y sirve para
validar dejando fuera a alguien completo.

Por cada video nuevo: extrae manos + cara con MediaPipe (igual que
extract_face_hands.py), remuestrea a 24 cuadros y lo guarda como la siguiente
grabacion real <SENA>_<n>.npy, con su persona y proporcion en examples.json.
Despues regenera las aumentaciones de esa sena (augment_npy.py). Los videos
ya agregados se saltan, asi que se puede correr cada vez que haya videos nuevos.

Uso:
  python python_scripts/add_training_videos.py
  python python_scripts/add_training_videos.py --only CASA --dry-run
  python python_scripts/add_training_videos.py --remove CASA/ana_2.mp4
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from augment_npy import TARGET_TOTAL, rebuild_augmentations
from examples_index import (
    TRAINING_DIR, category_of, load_index, load_manifest, normalize_sign, npy_path,
    reals, save_index, save_manifest, signer_from_stem, slugify_label,
)
from extract_face_hands import (
    MIN_FRAMES, TARGET_FRAMES, VIDEO_EXTS, extract_frames, hand_stats,
    landmarker_options, mp_vision, resample,
)

DEFAULT_INPUT = Path(__file__).parent.parent / "videos_entrenamiento"


def probe(video: Path) -> tuple[float, float] | None:
    """(ancho/alto, fps) del video, leidos del primer cuadro tal como lo ve
    extract_frames (OpenCV ya aplica la rotacion de los videos de celular)."""
    cap = cv2.VideoCapture(str(video))
    ok, frame = cap.read()
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    if not ok:
        return None
    h, w = frame.shape[:2]
    return w / h, fps


def scan(input_dir: Path, only: str | None):
    """(sena, carpeta, [videos]) por cada subcarpeta con videos."""
    for folder in sorted(p for p in input_dir.iterdir() if p.is_dir()):
        sign = slugify_label(folder.name)
        if not sign or (only and sign != only.upper()):
            continue
        videos = sorted(p for p in folder.iterdir() if p.suffix.lower() in VIDEO_EXTS)
        if videos:
            yield sign, folder.name, videos


def remove_recording(index: dict, cats: dict, source: str, data_dir: Path, target_total: int) -> int:
    """Borra la grabacion real `source` (p. ej. CASA/ana_2.mp4), renumera las
    demas y regenera las aumentaciones de esa sena."""
    for sign, entries in index["examples"].items():
        match = next((e for e in entries if e["kind"] == "real" and e.get("source") == source), None)
        if match is None:
            continue
        cat = cats[sign]
        npy_path(data_dir, cat, sign, match["n"]).unlink(missing_ok=True)
        entries.remove(match)
        rebuild_augmentations(index, sign, cat, data_dir, target_total)
        save_index(index, data_dir)
        print(f"Quitada {source}: {sign} queda con {len(reals(index, sign))} grabacion(es) real(es)")
        return 0
    print(f"No hay ninguna grabacion con source = {source} en examples.json")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Agrega videos de entrenamiento (varios por sena)")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Carpeta con una subcarpeta por sena")
    parser.add_argument("--data", default=str(TRAINING_DIR), help="Carpeta training_data")
    parser.add_argument("--category", default="palabras",
                        help="Categoria para senas que no estan en manifest.json")
    parser.add_argument("--only", default=None, help="Solo esta sena")
    parser.add_argument("--target-total", type=int, default=TARGET_TOTAL,
                        help="Ejemplos por sena (reales + aumentados) a los que se apunta")
    parser.add_argument("--remove", default=None, metavar="SENA/archivo",
                        help="Quita una grabacion ya agregada, p. ej. CASA/ana_2.mp4")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra lo que haria")
    args = parser.parse_args()

    data_dir = Path(args.data).resolve()
    manifest = load_manifest(data_dir)
    index = load_index(data_dir)
    cats = category_of(manifest)

    if args.remove:
        return remove_recording(index, cats, args.remove.replace("\\", "/"), data_dir, args.target_total)

    input_dir = Path(args.input).resolve()
    if not input_dir.is_dir():
        print(f"No existe la carpeta {input_dir}. Crea una subcarpeta por sena con los videos dentro.")
        return 1

    known = {e.get("source") for entries in index["examples"].values() for e in entries if e["kind"] == "real"}
    pending = [
        (sign, f"{folder}/{video.name}", video)
        for sign, folder, videos in scan(input_dir, args.only)
        for video in videos
        if f"{folder}/{video.name}" not in known
    ]
    if not pending:
        print("No hay videos nuevos.")
        return 0

    new_signs = sorted({sign for sign, _, _ in pending if sign not in cats})
    print(f"{len(pending)} video(s) nuevo(s) en {input_dir}")
    for sign in new_signs:
        print(f"  ! {sign} no esta en manifest.json: se agrega a '{args.category}'")
    if args.dry_run:
        for sign, source, _ in pending:
            print(f"  {sign:<20} <- {source} (persona: {signer_from_stem(Path(source).stem)})")
        return 0

    # Las senas nuevas entran al manifest solo si al final tienen ejemplos.
    for sign in new_signs:
        cats[sign] = args.category

    hand_options, face_options = landmarker_options()
    affected: list[str] = []
    skipped: list[str] = []
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.FaceLandmarker.create_from_options(face_options) as face_lm:
        for sign, source, video in pending:
            info = probe(video)
            frames = extract_frames(video, hand_lm, face_lm) if info else []
            if len(frames) < MIN_FRAMES:
                print(f"  {source}: solo {len(frames)} cuadros con mano, omitido")
                skipped.append(source)
                continue
            aspect, fps = info
            cat = cats[sign]
            if sign not in affected:
                # Sin aumentaciones y con las reales en 1..R: la nueva va en R+1
                normalize_sign(index, sign, cat, data_dir)
                affected.append(sign)

            arr = resample(frames, TARGET_FRAMES)
            n = len(reals(index, sign)) + 1
            (data_dir / cat).mkdir(parents=True, exist_ok=True)
            np.save(npy_path(data_dir, cat, sign, n), arr)
            signer = signer_from_stem(video.stem)
            index["examples"][sign].append({
                "n": n, "kind": "real", "signer": signer, "aspect": round(aspect, 4),
                "source": source, "seconds": round(len(frames) / fps, 2),
            })
            save_index(index, data_dir)
            n_right, n_left = hand_stats(arr)
            print(f"  {sign}_{n} <- {source} | {signer} | {len(frames)} cuadros con mano "
                  f"(der {n_right}/{TARGET_FRAMES}, izq {n_left}/{TARGET_FRAMES}) | {aspect:.2f}")

    for sign in affected:
        rebuild_augmentations(index, sign, cats[sign], data_dir, args.target_total)
    save_index(index, data_dir)
    added_signs = [s for s in new_signs if s in affected]
    if added_signs:
        manifest.setdefault(args.category, []).extend(added_signs)
        save_manifest(manifest, data_dir)

    print(f"\nListo: {len(pending) - len(skipped)} grabacion(es) agregada(s) en {len(affected)} sena(s)")
    for sign in affected:
        people = sorted({e["signer"] for e in reals(index, sign)})
        print(f"  {sign}: {len(reals(index, sign))} grabaciones, {len(people)} persona(s) ({', '.join(people)}), "
              f"{len(index['examples'][sign])} ejemplos con aumentaciones")
    if skipped:
        print(f"Omitidos: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
