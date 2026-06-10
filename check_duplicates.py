"""Analiza duplicados en videos y plantillas NPZ"""
from pathlib import Path
from collections import Counter
import re

def slugify(s: str) -> str:
    s = s.strip().upper()
    s = re.sub(r"[ÁÀÄÂ]", "A", s)
    s = re.sub(r"[ÉÈËÊ]", "E", s)
    s = re.sub(r"[ÍÌÏÎ]", "I", s)
    s = re.sub(r"[ÓÒÖÔ]", "O", s)
    s = re.sub(r"[ÚÙÜÛ]", "U", s)
    s = re.sub(r"[Ñ]", "N", s)
    s = re.sub(r"[^A-Z0-9_]+", "_", s)
    return s.strip("_")[:40]

ROOT = Path(__file__).parent
VIDEOS_DIR = ROOT / "data" / "training_videos"
TEMPLATES_DIR = ROOT / "data" / "templates"

print("=" * 60)
print("ANÁLISIS DE DUPLICADOS EN VIDEOS")
print("=" * 60)

# Analizar videos
if VIDEOS_DIR.exists():
    videos = []
    for cat_dir in VIDEOS_DIR.iterdir():
        if not cat_dir.is_dir():
            continue
        for v in cat_dir.glob("*.*"):
            if v.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov", ".avi"):
                slug = slugify(v.stem)
                videos.append((cat_dir.name, v.stem, slug, v))
    
    print(f"\n📹 Videos encontrados: {len(videos)}")
    
    # Contar duplicados por slug
    slugs = [v[2] for v in videos]
    slug_counts = Counter(slugs)
    duplicates = {s: c for s, c in slug_counts.items() if c > 1}
    
    if duplicates:
        print(f"\n⚠️  DUPLICADOS ENCONTRADOS: {len(duplicates)} palabras")
        print("\nTop 20 duplicados:")
        for slug, count in sorted(duplicates.items(), key=lambda x: -x[1])[:20]:
            print(f"  {slug}: {count}x")
            # Mostrar archivos específicos
            for cat, stem, s, path in videos:
                if s == slug:
                    print(f"    - {cat}/{stem}{path.suffix}")
    else:
        print("\n✅ No hay duplicados en videos")
    
    # Contar por categoría
    print(f"\n📊 Videos por categoría:")
    cat_counts = Counter(v[0] for v in videos)
    for cat, count in sorted(cat_counts.items()):
        print(f"  {cat}: {count}")

print("\n" + "=" * 60)
print("ANÁLISIS DE DUPLICADOS EN PLANTILLAS NPZ")
print("=" * 60)

# Analizar plantillas
if TEMPLATES_DIR.exists():
    templates = []
    for cat_dir in TEMPLATES_DIR.iterdir():
        if not cat_dir.is_dir():
            continue
        for npz in cat_dir.glob("*.npz"):
            slug = npz.stem
            templates.append((cat_dir.name, slug, npz))
    
    print(f"\n📦 Plantillas NPZ encontradas: {len(templates)}")
    
    # Contar duplicados por slug
    slugs = [t[1] for t in templates]
    slug_counts = Counter(slugs)
    duplicates = {s: c for s, c in slug_counts.items() if c > 1}
    
    if duplicates:
        print(f"\n⚠️  DUPLICADOS ENCONTRADOS: {len(duplicates)} palabras")
        print("\nTop 20 duplicados:")
        for slug, count in sorted(duplicates.items(), key=lambda x: -x[1])[:20]:
            print(f"  {slug}: {count}x")
            # Mostrar archivos específicos
            for cat, s, path in templates:
                if s == slug:
                    print(f"    - {cat}/{slug}.npz")
    else:
        print("\n✅ No hay duplicados en plantillas NPZ")
    
    # Contar por categoría
    print(f"\n📊 Plantillas por categoría:")
    cat_counts = Counter(t[0] for t in templates)
    for cat, count in sorted(cat_counts.items()):
        print(f"  {cat}: {count}")

print("\n" + "=" * 60)
