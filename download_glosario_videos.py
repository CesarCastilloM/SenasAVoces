"""
Descarga todos los videos del Glosario LSM CDMX como MP4 locales.

Trick que desbloquea las descargas:
    - Pasar `--referer https://lsm.indiscapacidad.cdmx.gob.mx/`
    - Usar la URL `/embed/<id>` (no /watch?v=)
    - Tener Node.js instalado y pasar `--js-runtimes node` a yt-dlp

Salida:
    data/training_videos/<categoria_id>/<PALABRA_SLUG>.mp4
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GLOSARIO = ROOT / "data" / "lsm_lecciones_glosario_cdmx.json"
OUT_ROOT = ROOT / "data" / "training_videos"
REFERER = "https://lsm.indiscapacidad.cdmx.gob.mx/"


def slugify(s: str) -> str:
    import unicodedata
    s = s.strip().upper()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')  # strip diacritics
    s = re.sub(r"[^A-Z0-9]+", "_", s).strip("_")
    return s or "SIGN"


def download_one(youtube_id: str, out_path: Path) -> tuple[bool, str]:
    import tempfile, shutil
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.stat().st_size > 50_000:
        return True, "ya existia"

    # Descargar a directorio temporal ASCII para evitar fallos con tildes en Windows
    with tempfile.TemporaryDirectory(prefix="ytdlp_") as tmpdir:
        tmpl = str(Path(tmpdir) / f"{youtube_id}.%(ext)s")
        cmd = [
            "yt-dlp",
            "--quiet",
            "--no-warnings",
            "--js-runtimes", "node",
            "--referer", REFERER,
            "-f", "best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", tmpl,
            f"https://www.youtube.com/embed/{youtube_id}",
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return False, "timeout"
        if r.returncode != 0:
            msg = (r.stderr or r.stdout or "").strip().splitlines()[-1:]
            return False, " | ".join(msg)[:120]

        # Buscar el archivo descargado y moverlo al destino final
        for ext in (".mp4", ".webm", ".mkv"):
            cand = Path(tmpdir) / f"{youtube_id}{ext}"
            if cand.exists() and cand.stat().st_size > 50_000:
                shutil.move(str(cand), str(out_path))
                return True, "ok"
    return False, "no file"


def main():
    if not GLOSARIO.exists():
        print(f"ERROR: no encuentro {GLOSARIO}")
        sys.exit(1)
    data = json.loads(GLOSARIO.read_text(encoding="utf-8"))

    total = 0
    okc = 0
    skipc = 0
    failc = 0
    failures: list[str] = []

    cats = data.get("categorias", [])
    print(f"Categorias: {len(cats)}  | total videos a intentar: "
          f"{sum(len(c.get('senas', [])) for c in cats)}")
    print("-" * 60)

    for cat in cats:
        cat_id = cat.get("id")
        senas = cat.get("senas", [])
        if not senas:
            continue
        cat_dir = OUT_ROOT / cat_id
        print(f"\n[{cat_id}] {len(senas)} senas -> {cat_dir}")
        for s in senas:
            total += 1
            yid = s.get("youtube_id")
            palabra = s.get("palabra") or yid
            if not yid:
                failc += 1
                continue
            out_path = cat_dir / f"{slugify(palabra)}.mp4"
            t0 = time.time()
            ok, msg = download_one(yid, out_path)
            dt = time.time() - t0
            if ok:
                if msg == "ya existia":
                    skipc += 1
                    print(f"  - {palabra:<28} (ya)  {dt:.1f}s")
                else:
                    okc += 1
                    sz = out_path.stat().st_size / 1024
                    print(f"  + {palabra:<28} OK    {dt:.1f}s  {sz:.0f}KB")
            else:
                failc += 1
                failures.append(f"{cat_id}/{palabra} ({yid}): {msg}")
                print(f"  x {palabra:<28} FAIL  {msg}")

    print("\n" + "=" * 60)
    print(f"Total intentos: {total}")
    print(f"  OK nuevas:    {okc}")
    print(f"  Ya existian:  {skipc}")
    print(f"  Fallidas:     {failc}")
    if failures:
        log = ROOT / "data" / "download_failures.txt"
        log.write_text("\n".join(failures), encoding="utf-8")
        print(f"\nLista de fallos guardada en: {log}")


if __name__ == "__main__":
    main()
