"""
examples_index.py
Indice de ejemplos de entrenamiento: public/training_data/examples.json.

Cada <SENA>_<n>.npy queda descrito por una entrada:
  {"n": 1, "kind": "real", "signer": "ana", "aspect": 1.7778,
   "source": "CASA/ana_1.mp4", "seconds": 2.1}
  {"n": 4, "kind": "aug", "from": 1, "preset": 2, "signer": "ana", "aspect": 1.7778}

  kind     real = grabacion de una persona; aug = derivado de una real.
  signer   quien hizo la sena (las aumentaciones heredan el de su base);
           permite validar dejando fuera a una persona completa.
  aspect   ancho/alto del video de origen, para corregir la proporcion
           (MediaPipe normaliza x e y a [0,1] por separado).

Convencion de numeracion: las reales van primero (1..R), contiguas, y las
aumentaciones despues (R+1..). Los cargadores que no leen el indice siguen
funcionando porque recorren _1, _2, ... hasta el primer faltante.

Solo depende de la biblioteca estandar.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

TRAINING_DIR = Path(__file__).parent.parent / "public" / "training_data"
INDEX_NAME = "examples.json"
WEBCAM_ASPECT = 4 / 3
# Senas grabadas antes del indice: _1 real (signer "original") y el resto
# aumentaciones de _1, en el orden de PRESETS de augment_npy.py.
ORIGINAL_SIGNER = "original"


def slugify_label(stem: str) -> str:
    """Igual que extract_face_hands.py: sin acentos, solo A-Z0-9 y '_'."""
    ascii_stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "_", ascii_stem).strip("_").upper()


def signer_from_stem(stem: str) -> str:
    """'ana_2' -> 'ana'. La persona es lo que va antes del primer '_'."""
    name = slugify_label(stem.split("_")[0]).lower()
    return name or "desconocido"


def augmentations_per_real(n_real: int, target_total: int) -> int:
    """Cuantas aumentaciones generar por grabacion real para que la sena tenga
    ~target_total ejemplos: con 1 real -> 12, con 4 -> 3, con 13 o mas -> 0.
    Asi el costo del DTW (un patron por ejemplo) no crece con cada video."""
    if n_real <= 0:
        return 0
    return max(0, math.ceil(target_total / n_real) - 1)


def load_manifest(data_dir: Path = TRAINING_DIR) -> dict:
    return json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))


def save_manifest(manifest: dict, data_dir: Path = TRAINING_DIR) -> None:
    (data_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def category_of(manifest: dict) -> dict[str, str]:
    return {
        sign: cat
        for cat, signs in manifest.items()
        if isinstance(signs, list)
        for sign in signs
    }


def npy_path(data_dir: Path, category: str, sign: str, n: int) -> Path:
    return data_dir / category / f"{sign}_{n}.npy"


def _bootstrap(data_dir: Path) -> dict:
    """Describe los datos que existian antes del indice."""
    manifest = load_manifest(data_dir)
    aspects_file = data_dir / "video_aspect.json"
    aspects = json.loads(aspects_file.read_text(encoding="utf-8")) if aspects_file.exists() else {}
    default = aspects.get("default", WEBCAM_ASPECT)
    video_aspect = aspects.get("signs", {})

    examples: dict[str, list[dict]] = {}
    for cat, signs in manifest.items():
        if not isinstance(signs, list):
            continue
        for sign in signs:
            aspect = round(video_aspect.get(sign, default), 4)
            entries = []
            n = 1
            while npy_path(data_dir, cat, sign, n).exists():
                if n == 1:
                    entries.append({
                        "n": 1, "kind": "real", "signer": ORIGINAL_SIGNER, "aspect": aspect,
                        "source": f"videos/signs/{sign}.mp4" if sign in video_aspect else None,
                    })
                else:
                    entries.append({
                        "n": n, "kind": "aug", "from": 1, "preset": n - 2,
                        "signer": ORIGINAL_SIGNER, "aspect": aspect,
                    })
                n += 1
            if entries:
                examples[sign] = entries
    return {"version": 1, "default_aspect": round(default, 4), "examples": examples}


def load_index(data_dir: Path = TRAINING_DIR) -> dict:
    """Lee examples.json; si no existe, lo construye desde los archivos."""
    path = data_dir / INDEX_NAME
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return _bootstrap(data_dir)


def save_index(index: dict, data_dir: Path = TRAINING_DIR) -> None:
    """Una entrada por linea: legible en un diff y ~10x mas chico que indent=2."""
    lines = ["{", f' "version": {index.get("version", 1)},',
             f' "default_aspect": {index.get("default_aspect", round(WEBCAM_ASPECT, 4))},',
             ' "examples": {']
    signs = sorted(index["examples"])
    for i, sign in enumerate(signs):
        entries = sorted(index["examples"][sign], key=lambda e: e["n"])
        lines.append(f"  {json.dumps(sign, ensure_ascii=False)}: [")
        for j, e in enumerate(entries):
            sep = "," if j < len(entries) - 1 else ""
            lines.append("   " + json.dumps(e, ensure_ascii=False, separators=(",", ":")) + sep)
        lines.append("  ]" + ("," if i < len(signs) - 1 else ""))
    lines += [" }", "}"]
    (data_dir / INDEX_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8")


def reals(index: dict, sign: str) -> list[dict]:
    return sorted(
        (e for e in index["examples"].get(sign, []) if e["kind"] == "real"),
        key=lambda e: e["n"],
    )


def sign_files(data_dir: Path, category: str, sign: str) -> dict[int, Path]:
    """{n: ruta} de <sign>_<n>.npy. Compara el nombre exacto: COMO_*.npy
    tambien encontraria COMO_ESTAS_2.npy, que es de otra sena."""
    out = {}
    for p in (data_dir / category).glob(f"{sign}_*.npy"):
        name, _, num = p.stem.rpartition("_")
        if name == sign and num.isdigit():
            out[int(num)] = p
    return out


def normalize_sign(index: dict, sign: str, category: str, data_dir: Path = TRAINING_DIR) -> list[dict]:
    """Deja una sena lista para agregar grabaciones o regenerar aumentaciones:
    adopta como reales los .npy que no estan en el indice (p. ej. guardados
    desde la pagina /train con la webcam), borra las aumentaciones y renumera
    las reales 1..R. Devuelve las reales."""
    entries = index["examples"].setdefault(sign, [])
    files = sign_files(data_dir, category, sign)
    known = {e["n"] for e in entries}
    for n in sorted(set(files) - known):
        entries.append({
            "n": n, "kind": "real", "signer": "webcam",
            "aspect": index.get("default_aspect", round(WEBCAM_ASPECT, 4)),
            "source": "fuera del indice (p. ej. /train)",
        })
    real_entries = sorted((e for e in entries if e["kind"] == "real"), key=lambda e: e["n"])
    real_ns = {e["n"] for e in real_entries}
    for n, path in files.items():
        if n not in real_ns:
            path.unlink()
    # Renumerar en dos pasos para no pisar archivos: n -> temporal -> 1..R
    moves = [(e, files[e["n"]]) for e in real_entries if e["n"] in files]
    temps = []
    for e, path in moves:
        tmp = path.with_name(f"{sign}__tmp_{e['n']}.npy")
        path.rename(tmp)
        temps.append((e, tmp))
    for new_n, (e, tmp) in enumerate(temps, start=1):
        tmp.rename(npy_path(data_dir, category, sign, new_n))
        e["n"] = new_n
    kept = [e for e, _ in temps]
    index["examples"][sign] = kept
    return kept


def check_index(index: dict, manifest: dict, data_dir: Path = TRAINING_DIR) -> list[str]:
    """Problemas de consistencia entre indice y archivos (lista vacia = ok)."""
    problems = []
    cats = category_of(manifest)
    for sign, entries in index["examples"].items():
        cat = cats.get(sign)
        if cat is None:
            problems.append(f"{sign}: esta en el indice pero no en manifest.json")
            continue
        ns = sorted(e["n"] for e in entries)
        if ns != list(range(1, len(ns) + 1)):
            problems.append(f"{sign}: numeracion no contigua {ns}")
        n_real = len(reals(index, sign))
        if any(e["kind"] == "real" and e["n"] > n_real for e in entries):
            problems.append(f"{sign}: hay reales despues de aumentaciones")
        for e in entries:
            if not npy_path(data_dir, cat, sign, e["n"]).exists():
                problems.append(f"{sign}: falta {cat}/{sign}_{e['n']}.npy")
    return problems


if __name__ == "__main__":
    # Resumen del indice: python python_scripts/examples_index.py
    idx = load_index()
    man = load_manifest()
    by_signers: dict[int, int] = {}
    for sign in idx["examples"]:
        people = {e["signer"] for e in reals(idx, sign)}
        by_signers[len(people)] = by_signers.get(len(people), 0) + 1
    total = sum(len(v) for v in idx["examples"].values())
    real_total = sum(len(reals(idx, s)) for s in idx["examples"])
    print(f"{len(idx['examples'])} senas, {total} ejemplos ({real_total} grabaciones reales)")
    for k in sorted(by_signers):
        print(f"  {by_signers[k]} senas con {k} persona(s)")
    issues = check_index(idx, man)
    print("Indice consistente" if not issues else "Problemas:\n  " + "\n  ".join(issues[:20]))
