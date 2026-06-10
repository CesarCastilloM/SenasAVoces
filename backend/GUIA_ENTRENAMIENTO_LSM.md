# Guía de Entrenamiento — Dactilológico LSM

> Guía de referencia para capturar datos del alfabeto dactilológico de la Lengua de
> Señas Mexicana (LSM) con `lsm_data_collector.py`. Describe la configuración de mano
> de cada seña, si es **estática** o **dinámica**, y consejos para obtener buenas
> muestras.
>
> **Nota sobre el PDF:** el `Dic_LSM.pdf` del ITAIPBC es un documento escaneado
> (imágenes), por lo que no es legible automáticamente como texto. Esta guía replica
> el dactilológico estándar de LSM que dicho diccionario ilustra.

---

## 1. Conceptos clave

- **Seña estática:** la mano mantiene una configuración fija. Se promedian varios
  frames (`STATIC_FRAMES = 15`).
- **Seña dinámica:** requiere movimiento o trayectoria. Se graba una secuencia
  (`DYNAMIC_FRAMES = 30`).
- La cámara debe ver la mano de frente, con buena iluminación y fondo despejado.
- Mano derecha por convención (si eres zurdo, sé consistente y usa siempre la misma).

### Clasificación usada por el colector

| Tipo | Señas |
|------|-------|
| **Dinámicas** | `J`, `K`, `Ñ`, `Q`, `X`, `Z`, `RR` y números **10–20** |
| **Estáticas** | Resto del alfabeto (incluyendo `CH`, `LL`) y números **1–9** |

---

## 2. Alfabeto — configuración de mano

### Vocales y consonantes estáticas

| Letra | Tipo | Configuración de mano |
|-------|------|------------------------|
| **A** | Estática | Puño cerrado, pulgar al costado (no dentro). |
| **B** | Estática | Mano abierta, 4 dedos juntos y extendidos hacia arriba, pulgar doblado sobre la palma. |
| **C** | Estática | Mano curvada en forma de "C". |
| **CH** | Estática | Configuración de "C" pero con el índice más marcado / mano en gancho (dígrafo). |
| **D** | Estática | Índice extendido hacia arriba, resto de dedos en círculo con el pulgar. |
| **E** | Estática | Dedos doblados hacia la palma, pulgar recogido. |
| **F** | Estática | Índice y pulgar en círculo (OK), otros 3 dedos extendidos. |
| **G** | Estática | Índice y pulgar extendidos horizontalmente, casi paralelos. |
| **H** | Estática | Índice y medio extendidos juntos en horizontal. |
| **I** | Estática | Meñique extendido, resto en puño. |
| **L** | Estática | Índice y pulgar en ángulo recto (forma de "L"). |
| **LL** | Estática | Configuración de "L" con leve marca del dígrafo. |
| **M** | Estática | Pulgar bajo los 3 primeros dedos doblados. |
| **N** | Estática | Pulgar bajo índice y medio doblados. |
| **O** | Estática | Todos los dedos forman un círculo cerrado ("O"). |
| **P** | Estática | Similar a "K" pero apuntando hacia abajo. |
| **R** | Estática | Índice y medio cruzados. |
| **S** | Estática | Puño cerrado con el pulgar por delante de los dedos. |
| **T** | Estática | Pulgar entre índice y medio (puño). |
| **U** | Estática | Índice y medio juntos extendidos hacia arriba. |
| **V** | Estática | Índice y medio en "V" (separados). |
| **W** | Estática | Índice, medio y anular extendidos (tres dedos). |
| **Y** | Estática | Pulgar y meñique extendidos, resto en puño. |

### Letras dinámicas (requieren movimiento)

| Letra | Tipo | Movimiento |
|-------|------|------------|
| **J** | Dinámica | Configuración de "I" (meñique) trazando una "J" en el aire. |
| **K** | Dinámica | Índice y medio en "V", pulgar entre ambos; ligero movimiento hacia arriba. |
| **Ñ** | Dinámica | Configuración de "N" con movimiento ondulado (la tilde). |
| **Q** | Dinámica | Índice y pulgar apuntando hacia abajo con desplazamiento. |
| **X** | Dinámica | Índice doblado en gancho, con pequeño movimiento. |
| **Z** | Dinámica | Índice extendido trazando una "Z" en el aire. |
| **RR** | Dinámica | Configuración de "R" con **vibración/temblor** del dedo (dígrafo). |

---

## 3. Números

| Número | Tipo | Configuración |
|--------|------|---------------|
| **1** | Estática | Índice extendido. |
| **2** | Estática | Índice y medio (como "V"). |
| **3** | Estática | Pulgar, índice y medio extendidos. |
| **4** | Estática | Cuatro dedos extendidos, pulgar recogido. |
| **5** | Estática | Mano abierta, cinco dedos. |
| **6** | Estática | Meñique tocando el pulgar (o configuración 6). |
| **7** | Estática | Anular tocando el pulgar. |
| **8** | Estática | Medio tocando el pulgar. |
| **9** | Estática | Índice tocando el pulgar. |
| **10–20** | Dinámica | Combinaciones con movimiento / cambio de configuración. |

---

## 4. Flujo de captura recomendado

### Modo lección guiada (recomendado)

```powershell
python backend/lsm_data_collector.py --lesson --samples 5
```

- Recorre automáticamente todo el orden: `A, B, C, CH, D ... Z, Ñ, LL, RR, 1–20`.
- Avanza solo tras capturar correctamente cada seña.

### Empezar desde una seña concreta

```powershell
python backend/lsm_data_collector.py --lesson --start CH --samples 5
```

### Controles durante la captura

| Tecla | Acción |
|-------|--------|
| `ESPACIO` | Capturar muestra |
| `S` | Saltar seña |
| `P` | Seña anterior |
| `R` | Repetir última |
| `Q` | Salir |

---

## 5. Consejos para datos de calidad

- **Mínimo 5–10 muestras por seña** para empezar; 20+ para mayor robustez.
- Varía ligeramente **ángulo, distancia y posición** de la mano entre muestras.
- Para señas **dinámicas**, realiza el movimiento completo a velocidad natural
  durante toda la grabación (30 frames).
- Evita sombras fuertes y fondos con tonos de piel.
- Mantén la mano dentro del encuadre; el colector marca cuándo detecta mano válida.
- Sé **consistente**: la misma mano y orientación en todas las muestras.

---

## 6. Siguiente paso: entrenar

Tras capturar suficientes muestras:

```powershell
python backend/lsm_trainer.py
```

Esto genera los modelos estático y dinámico a partir de `data/lsm_raw/`.
Luego puedes probar el reconocimiento en tiempo real con `lsm_recognizer.py`.
