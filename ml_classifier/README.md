# ml_classifier — Clasificador LSTM+Attention (paralelo al detector DTW)

Pipeline experimental para mejorar la diferenciacion entre senas parecidas
(ej. "90" vs "BIEN"), usando un clasificador entrenado con **Supervised
Contrastive Loss** que fuerza separacion entre clases confundibles.

**No reemplaza** `src/dynamic_sign_detector.js` (DTW). Es una comparacion
para decidir si migrar o usar como fallback/segunda opinion.

## Datos

Lee directamente `public/training_data/**/*.npy` (mismo dataset del detector
DTW), sin modificarlos.

## Uso

```bash
# Entrenar (holdout=5 excluye el ejemplo _5 de cada sena para validacion honesta)
python ml_classifier/train.py --epochs 60 --holdout 5

# Evaluar checkpoint con detalle de fallos
python ml_classifier/evaluate.py --holdout 5
```

## Arquitectura

- `dataset.py`: carga `.npy`, normaliza (centro/escala por manos presentes),
  remuestrea a 24 frames.
- `augment.py`: rotacion, escala, ruido, time-warp — aplicado on-the-fly en
  cada epoch (no genera archivos nuevos).
- `model.py`: BiLSTM (2 capas) + attention temporal pooling + cabeza de
  clasificacion + cabeza de embedding (para contrastive loss).
- `train.py`: entrena con CrossEntropy + SupCon loss combinados. Guarda mejor
  checkpoint por `val_top5` en `checkpoints/best_model.pt`.
- `evaluate.py`: reporta top-1/top-5 accuracy y lista los fallos fuera de
  top-5 con su ranking completo, para comparar contra los resultados del
  detector DTW (`scripts/test_holdout.mjs`).

## Metrica de referencia (DTW actual)

`scripts/test_holdout.mjs 5` → 236/238 (99.2%) top-1, 0 falsos positivos.
El objetivo de este experimento es igualar o superar esa cifra Y garantizar
que las senas antes confundidas (ej. "90"/"BIEN") caigan dentro del top-5
consistentemente.
