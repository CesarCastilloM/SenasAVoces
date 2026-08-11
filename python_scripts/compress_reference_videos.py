"""Comprime los videos fuente a clips ligeros para usarlos como referencia en la web.

Usa el mismo `slugify_label` que `extract_from_videos.py`, de modo que el nombre
del archivo de salida coincide exactamente con el nombre de la sena entrenada.

Salida: public/videos/signs/<SENA>.mp4 (plano, sin categorias, para que la
busqueda por nombre funcione sin importar en que categoria quedo la sena).

Uso:
    python compress_reference_videos.py --input "C:\\ruta\\a\\MP4"
    python compress_reference_videos.py --input "..." --height 360 --crf 32
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
# Carpetas que no forman parte del set entrenado.
SKIP_DIRS = {"FORO LSM", "ABC"}

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "public" / "videos" / "signs"


def slugify_label(stem: str) -> tuple[str, int | None]:
    """`Por Favor_2` -> ('POR_FAVOR', 2). Igual que extract_from_videos.py."""
    ascii_stem = (
        unicodedata.normalize("NFKD", stem)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    label = re.sub(r"[^A-Za-z0-9]+", "_", ascii_stem).strip("_").upper()
    match = re.match(r"^(.*?)_(\d+)$", label)
    if match:
        return match.group(1), int(match.group(2))
    return label, None


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # winget instala aqui y el PATH no se refresca en la sesion actual.
    local = Path.home() / "AppData/Local/Microsoft/WinGet"
    for candidate in [
        local / "Links/ffmpeg.exe",
        *sorted((local / "Packages").glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe")),
    ]:
        if candidate.exists():
            return str(candidate)
    sys.exit("No se encontro ffmpeg. Instalalo o agregalo al PATH.")


def collect_videos(root: Path) -> list[Path]:
    videos: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTS:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        videos.append(path)
    return videos


def compress(ffmpeg: str, src: Path, dst: Path, height: int, crf: int) -> bool:
    """Reescala manteniendo aspecto, sin audio, optimizado para streaming web."""
    cmd = [
        ffmpeg,
        "-y",
        "-loglevel", "error",
        "-i", str(src),
        "-vf", f"scale=-2:{height}",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    ERROR: {result.stderr.strip()[:200]}")
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Carpeta raiz con los videos fuente")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Carpeta de salida")
    parser.add_argument("--height", type=int, default=360, help="Alto del video de salida")
    parser.add_argument("--crf", type=int, default=30, help="Calidad H.264 (mayor = mas comprimido)")
    parser.add_argument("--force", action="store_true", help="Recomprimir aunque ya exista")
    args = parser.parse_args()

    src_root = Path(args.input)
    if not src_root.is_dir():
        sys.exit(f"No existe la carpeta: {src_root}")

    out_root = Path(args.output)
    out_root.mkdir(parents=True, exist_ok=True)

    ffmpeg = find_ffmpeg()
    videos = collect_videos(src_root)
    if not videos:
        sys.exit(f"No se encontraron videos en {src_root}")

    print(f"{len(videos)} video(s) en {src_root}")
    print(f"Salida:  {out_root}  ({args.height}p, crf {args.crf})\n")

    written: dict[str, Path] = {}
    skipped = 0
    failed = 0

    for src in videos:
        label, _ = slugify_label(src.stem)
        if not label:
            continue
        # Si dos archivos generan la misma etiqueta, nos quedamos con el primero.
        if label in written:
            skipped += 1
            continue

        dst = out_root / f"{label}.mp4"
        if dst.exists() and not args.force:
            written[label] = dst
            skipped += 1
            continue

        print(f"  {src.name} -> {label}.mp4")
        if compress(ffmpeg, src, dst, args.height, args.crf):
            written[label] = dst
        else:
            failed += 1

    total_mb = sum(p.stat().st_size for p in out_root.glob("*.mp4")) / (1024 * 1024)
    print(f"\nListo: {len(written)} video(s), {skipped} omitido(s), {failed} con error")
    print(f"Tamano total: {total_mb:.1f} MB en {out_root}")


if __name__ == "__main__":
    main()
