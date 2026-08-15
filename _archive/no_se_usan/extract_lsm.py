"""
extract_lsm.py — Extrae videos y señas del Glosario Digital LSM CDMX
usando Playwright (navegador real que ejecuta el JavaScript de la SPA).

Uso:
    python extract_lsm.py
    python extract_lsm.py --categoria numeros
    python extract_lsm.py --todas

Salida: SenasAVoces/data/lsm_lecciones_glosario_cdmx.json (actualizado)
"""
import asyncio
import json
import re
import sys
import os
from datetime import date
from pathlib import Path

try:
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
except ImportError:
    print("ERROR: playwright no instalado. Ejecuta: pip install playwright && playwright install chromium")
    sys.exit(1)

BASE_URL = "https://lsm.indiscapacidad.cdmx.gob.mx"
OUTPUT_PATH = Path(__file__).parent / "data" / "lsm_lecciones_glosario_cdmx.json"

CATEGORIAS = [
    {"id": "abecedario",              "nombre": "Abecedario",              "leccion_academia": "L1.1"},
    {"id": "numeros",                 "nombre": "Números",                 "leccion_academia": "L1.2"},
    {"id": "colores",                 "nombre": "Colores",                 "leccion_academia": "L1.5"},
    {"id": "familia",                 "nombre": "Familia",                 "leccion_academia": "L1.4"},
    {"id": "expresiones-cotidianas",  "nombre": "Expresiones Cotidianas",  "leccion_academia": "L1.3"},
    {"id": "salud",                   "nombre": "Salud",                   "leccion_academia": "L2.4"},
    {"id": "trabajo",                 "nombre": "Trabajo",                 "leccion_academia": "L2.3"},
    {"id": "educacion",               "nombre": "Educación",               "leccion_academia": "L2.3"},
    {"id": "derechos",                "nombre": "Derechos",                "leccion_academia": "L3.1"},
    {"id": "gobierno",                "nombre": "Gobierno",                "leccion_academia": "L3.2"},
    {"id": "transporte",              "nombre": "Transporte",              "leccion_academia": "L3.3"},
    {"id": "vivienda",                "nombre": "Vivienda",                "leccion_academia": "L3.4"},
    {"id": "medio-ambiente",          "nombre": "Medio Ambiente",          "leccion_academia": "L3.5"},
    {"id": "tecnologia",              "nombre": "Tecnología",              "leccion_academia": "L3.6"},
    {"id": "cultura",                 "nombre": "Cultura",                 "leccion_academia": "L3.7"},
    {"id": "deporte",                 "nombre": "Deporte",                 "leccion_academia": "L3.8"},
    {"id": "emociones",               "nombre": "Emociones",               "leccion_academia": "L2.1"},
    {"id": "tiempo",                  "nombre": "Tiempo",                  "leccion_academia": "L3.9"},
]


async def extract_categoria(page, cat_id: str) -> list[dict]:
    url = f"{BASE_URL}/ejes/{cat_id}/"
    print(f"  → Cargando {url}")

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=20000)
    except PWTimeout:
        print(f"  ✗ Timeout en {cat_id}")
        return []

    # El HTML ya contiene data-videoid en el HTML estático (WordPress)
    # No necesitamos esperar JS — parsear directamente con JS del DOM
    senas = await page.evaluate("""() => {
        const results = [];
        const seen = new Set();

        // Patrón: <button data-videoid="YTID"> con <span class="cdmx-widget-video-thumbnail-title">NOMBRE</span>
        document.querySelectorAll('button[data-videoid]').forEach(btn => {
            const ytId = btn.getAttribute('data-videoid') || btn.dataset.videoid || '';
            if (!ytId) return;

            const titleEl = btn.querySelector('.cdmx-widget-video-thumbnail-title');
            const nombre = titleEl?.textContent?.trim() || '';

            if (seen.has(ytId)) return;
            seen.add(ytId);

            results.push({
                palabra: nombre.toUpperCase(),
                descripcion: '',
                video_url: 'https://www.youtube.com/watch?v=' + ytId,
                video_embed: 'https://www.youtube.com/embed/' + ytId,
                thumbnail_url: 'https://img.youtube.com/vi/' + ytId + '/mqdefault.jpg',
                youtube_id: ytId,
                fuente: 'glosario_cdmx'
            });
        });

        return results;
    }""")

    print(f"  ✓ {len(senas)} señas encontradas en {cat_id}")
    return senas


async def main():
    # Determinar qué categorías extraer
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg == "--todas":
        cats_to_extract = CATEGORIAS
    elif arg == "--categoria" and len(sys.argv) > 2:
        target = sys.argv[2]
        cats_to_extract = [c for c in CATEGORIAS if c["id"] == target]
        if not cats_to_extract:
            print(f"Categoría '{target}' no encontrada.")
            sys.exit(1)
    else:
        # Por defecto: extraer todas
        cats_to_extract = CATEGORIAS

    print(f"\n🔍 Extrayendo {len(cats_to_extract)} categorías del Glosario LSM CDMX...\n")

    resultado = {
        "fuente": "Glosario Digital LSM — INDISCAPACIDAD CDMX",
        "url": BASE_URL + "/",
        "total_videos": 719,
        "total_categorias": 19,
        "fecha_extraccion": str(date.today()),
        "nota_legal": "Contenido del Gobierno de la Ciudad de México. Reproducción requiere autorización de INDISCAPACIDAD CDMX.",
        "categorias": []
    }

    # Cargar JSON existente para no perder datos previos
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)
        # Indexar categorías existentes
        existing_cats = {c["id"]: c for c in existing.get("categorias", [])}
    else:
        existing_cats = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, slow_mo=200)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900}
        )
        page = await context.new_page()

        for cat in CATEGORIAS:
            cat_id = cat["id"]

            if cat in cats_to_extract:
                senas = await extract_categoria(page, cat_id)
            else:
                # Conservar datos existentes
                senas = existing_cats.get(cat_id, {}).get("senas", [])

            resultado["categorias"].append({
                "id": cat_id,
                "nombre": cat["nombre"],
                "url": f"{BASE_URL}/ejes/{cat_id}/",
                "leccion_academia": cat["leccion_academia"],
                "total_senas": len(senas),
                "senas": senas
            })

        await browser.close()

    # Guardar resultado
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)

    total_con_video = sum(
        1 for cat in resultado["categorias"]
        for s in cat["senas"] if s.get("video_url")
    )
    total_senas = sum(len(cat["senas"]) for cat in resultado["categorias"])
    print(f"\n✅ Guardado en {OUTPUT_PATH}")
    print(f"   {total_senas} señas totales · {total_con_video} con video URL")


if __name__ == "__main__":
    asyncio.run(main())
