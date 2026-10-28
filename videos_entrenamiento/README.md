# Entrenar con más videos por seña

Hoy cada seña tiene **una sola grabación de una sola persona** (más 12 copias
aumentadas de ese mismo video). Así el modelo aprende cómo hace la seña esa
persona, no cómo varía entre personas. Esta carpeta es donde se ponen videos
nuevos (varias personas y varias tomas por seña) para agregarlos al dataset.

Los videos **no se suben a git** (pesan mucho): solo se suben los `.npy` que se
generan a partir de ellos. Respalda los videos en otro lado (Drive, disco
externo), porque hacen falta para volver a extraerlos si cambia el pipeline.

---

## 1. Preparar Python (una sola vez)

Usa **Python 3.11**: `mediapipe` no tiene paquetes para las versiones más nuevas.
Desde la raíz del repo:

```bash
py -3.11 -m venv .venv
```

```bash
.venv\Scripts\activate
```

```bash
pip install -r python_scripts/requirements.txt
```

(`torch` y `onnx` solo hacen falta para el paso 7. `.venv/` ya está en `.gitignore`.)

## 2. Grabar

Lo que más ayuda al modelo es la **variedad de personas**, no la cantidad de tomas.

- **De 3 a 5 personas por seña**, de 2 a 3 tomas cada una. Si hay alguien zurdo, mejor.
- **De la cabeza a la cintura**, con las dos manos dentro del cuadro todo el tiempo.
- Luz de frente, fondo liso si se puede; nada de contraluz.
- **Un clip por seña**: empieza y termina con las manos abajo, con medio segundo
  de margen antes y después.
- Celular o webcam, horizontal o vertical: da igual, el script guarda la
  proporción de cada video y la corrige. A 30 fps o más.
- Empieza por las señas de las lecciones publicadas y por las que más se
  confunden (1 contra D, AZUL contra USTEDES, PAPA).

Diez señas grabadas por cinco personas enseñan más que 238 señas con un solo video.

## 3. Acomodar los videos

Una subcarpeta por seña, un archivo por toma:

```
videos_entrenamiento/
  CASA/
    ana_1.mp4
    ana_2.mp4
    luis_1.mov
  COMO_ESTAS/
    ana_1.mp4
    sofia_1.mp4
```

- **Carpeta = nombre de la seña** como aparece en `public/training_data/manifest.json`.
  Se le quitan acentos, ñ, signos y espacios, así que "Cuñado" queda `CUNADO` y
  "¿Cómo estás?" queda `COMO_ESTAS`. Si escribes la carpeta con acentos o
  espacios, el script la convierte igual.
- **Archivo = `<persona>_<toma>`**. La persona es lo que va antes del primer `_`
  y debe escribirse **igual en todas las señas** (`ana`, no `Ana` en unas y
  `ana_g` en otras): con eso se mide qué tan bien le va al modelo con alguien
  que no vio al entrenar.
- Formatos: `.mp4`, `.mov`, `.avi`, `.webm`, `.mkv`, `.m4v`.
- Una carpeta que no está en el manifest se agrega como seña nueva en
  `palabras` (o en la categoría que indiques con `--category`).

## 4. Agregar los videos al dataset

Primero mira qué va a hacer, sin cambiar nada:

```bash
python python_scripts/add_training_videos.py --dry-run
```

Y luego agrégalos:

```bash
python python_scripts/add_training_videos.py
```

Por cada video nuevo, el script:

1. Extrae manos y cara con MediaPipe y remuestrea la seña a 24 cuadros.
2. La guarda como la siguiente grabación real de la seña, `public/training_data/<categoría>/<SEÑA>_<n>.npy`,
   y anota en `examples.json` quién la hizo, de qué video viene y su proporción.
3. Regenera las aumentaciones de esa seña a partir de **cada** grabación real.

Los videos que ya se agregaron se saltan, así que puedes correrlo cada vez que
agregues videos. Al final muestra cuántas grabaciones y personas tiene cada seña.

Para quitar una toma mala:

```bash
python python_scripts/add_training_videos.py --remove CASA/ana_2.mp4
```

Para revisar el estado del dataset (señas por número de personas y si el
índice coincide con los archivos):

```bash
python python_scripts/examples_index.py
```

## 5. Medir

```bash
node scripts/sim_live_detection.mjs
```

Reproduce cada grabación real como si viniera de la webcam y la pasa por el
mismo detector que usa `/model-test`. Reporta dos medidas:

| Medida | Qué compara | Para qué sirve |
|---|---|---|
| **Otra persona** | La grabación de alguien contra los patrones de **todos los demás** | Es lo que va a vivir un usuario nuevo. **Esta es la que importa.** Solo aparece en señas grabadas por 2+ personas. |
| Misma persona | La grabación contra las aumentaciones de los videos, incluidos los suyos | Optimista. Es lo único que se puede medir mientras una seña tenga una sola persona. |

Cuando haya al menos 40 grabaciones en "otra persona", el script también
calibra los umbrales con esos datos. Si sugiere valores distintos de
`LIVE_DEFAULTS` en `src/utils/dynamic_sign_detector.js`, cámbialos ahí y vuelve
a medir.

## 6. Probar en la app

```bash
npm run dev
```

Abre `http://localhost:5173/model-test`. El aviso de arriba debe mostrar las
238 señas (o más, si agregaste nuevas) y más secuencias que antes.

## 7. (Opcional) Reentrenar el modelo ONNX

El modelo ONNX hoy solo se usa en `/debug`; `/model-test` usa el detector DTW,
que aprovecha los videos nuevos sin reentrenar nada. Para reentrenarlo,
deja fuera a una persona que haya grabado muchas señas y valida con ella:

```bash
python python_scripts/train.py --epochs 60 --holdout-signer ana
```

```bash
python python_scripts/evaluate.py
```

```bash
python python_scripts/export_onnx.py
```

`export_onnx.py` copia a `public/` el modelo, las etiquetas y
`sign_model_meta.json`; con ese archivo el navegador sabe que el modelo espera
la proporción corregida. Sin `--holdout-signer` el entrenamiento valida contra
copias del mismo video y el número sale inflado (avisa en pantalla).

## 8. Subir los cambios

```bash
git add public/training_data
```

Eso incluye los `.npy` nuevos, `examples.json` y `manifest.json` si hubo señas
nuevas. Si reentrenaste, agrega también `public/sign_model.onnx`,
`public/sign_labels.json`, `public/sign_model_meta.json` y
`python_scripts/checkpoints/`.

---

## Cómo funciona por dentro

**`public/training_data/examples.json`** describe cada `.npy`:

```json
{"n":3,"kind":"real","signer":"ana","aspect":1.7778,"source":"CASA/ana_1.mp4","seconds":2.1}
{"n":7,"kind":"aug","from":3,"preset":2,"signer":"ana","aspect":1.7778}
```

- **Numeración:** primero las grabaciones reales (`_1` a `_R`) y después las
  aumentaciones. `_1` de cada seña es la grabación original (`signer: "original"`).
- **Aumentaciones por grabación**, para que cada seña tenga unos 13 ejemplos y
  el detector no se vuelva lento con cada video nuevo:

  | Grabaciones reales | 1 | 2 | 3 | 4 | 5–6 | 7–12 | 13 o más |
  |---|---|---|---|---|---|---|---|
  | Aumentaciones de cada una | 12 | 6 | 4 | 3 | 2 | 1 | 0 |

- **Proporción:** MediaPipe normaliza x e y entre 0 y 1 por separado, así que
  la misma mano sale deformada distinto en un video vertical, uno horizontal y
  la webcam. Cada ejemplo guarda la proporción de su video y la app la corrige
  al cargar los patrones.
- **Límite en la app:** `/model-test` carga hasta 24 ejemplos por seña
  (`MAX_PATTERN_EXAMPLES`), las grabaciones reales primero; cada patrón cuesta
  tiempo en cada evaluación en vivo.
- **La página `/train`** (grabar con la webcam desde la app) también sirve, pero
  guarda clips de máximo 1 s. Lo que se graba ahí no entra al índice en ese
  momento: la próxima vez que corras `add_training_videos.py` o
  `augment_npy.py` en esa seña se adopta como grabación real de la persona
  `webcam`.

## Problemas comunes

- **"solo N cuadros con mano, omitido":** MediaPipe no vio las manos en casi
  todo el video. Revisa que las manos estén en cuadro y con buena luz.
- **`pip install` falla con mediapipe:** estás en una versión de Python sin
  paquete; crea el entorno con `py -3.11` (paso 1).
- **La seña no aparece en `/model-test`:** el nombre de la carpeta no coincide
  con el del manifest (revisa la salida de `--dry-run`) o el `.npy` no se subió.
- **`augment_npy.py` sin `--only` regenera todas las señas:** las aumentaciones
  nuevas conservan la cara y la mano en reposo del video original, así que la
  medida "misma persona" sube aunque el detector no haya mejorado. Fíjate en
  "otra persona".
