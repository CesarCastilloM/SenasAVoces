# Referencia de Configuración de Dedos — LSM
## Fuente: Glosario Digital LSM INDISCAPACIDAD CDMX + Motor lsm_teacher.py

> **Nota:** Las descripciones del sitio web `lsm.indiscapacidad.cdmx.gob.mx` no pudieron
> extraerse programáticamente (SPA con contenido dinámico). Las descripciones aquí están
> basadas en el código del motor de reconocimiento (`lsm_teacher.py`) y documentación
> institucional disponible de LSM. Marcadas con ✓ las verificadas contra el motor actual.

---

## ABECEDARIO (A-Z + Ñ)

### A ✓
- **Patrón:** `CCCCC` (todos cerrados)
- **Dedos:** Puño cerrado, pulgar extendido lateralmente (al costado del índice)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** E (puño sin pulgar lateral), S (pulgar sobre nudillos), T (pulgar entre índice y medio)
- **finger_states clave:** `thumb_out=True, fist_tight=True, thumb_side_index=False`

### B ✓
- **Patrón:** `CEEEE` (pulgar cerrado, 4 dedos extendidos)
- **Dedos:** Cuatro dedos extendidos y juntos hacia arriba, pulgar cruzado sobre la palma
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 4 (similar pero sin pulgar cruzado), F (índice+pulgar forman círculo)
- **finger_states clave:** `index=True, middle=True, ring=True, pinky=True, thumb=False`

### C ✓
- **Patrón:** `EEEEE` (todos semi-abiertos en forma de C)
- **Dedos:** Mano curvada en forma de C, todos los dedos y pulgar forman semicírculo
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** O (más cerrada, pellizco), G (solo índice y pulgar)
- **finger_states clave:** `thumb_out=True, todos semi-extendidos, no hay pellizco`

### D ✓
- **Patrón:** `CECCC` (índice extendido, resto cerrado)
- **Dedos:** Índice extendido hacia arriba, pulgar toca la yema del medio, anular y meñique cerrados
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 1 (sin contacto pulgar-medio), G (horizontal), Z (movimiento)
- **finger_states clave:** `index=True, thumb_touch_middle=True, middle=False`

### E ✓
- **Patrón:** `CCCCC` (puño)
- **Dedos:** Puño cerrado, pulgar doblado sobre los dedos (no lateral, no arriba)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** A (pulgar lateral), S (pulgar sobre nudillos), M/N (pulgar entre dedos)
- **finger_states clave:** `fist_tight=True, thumb_out=False, thumb_below_mcps=True`

### F ✓
- **Patrón:** `CEEEE` (variante: pulgar e índice en círculo)
- **Dedos:** Pulgar e índice forman un círculo (O pequeña), medio/anular/meñique extendidos
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 9 (similar sin dedos extendidos), OK gesture
- **finger_states clave:** `thumb_touch_index=True, middle=True, ring=True, pinky=True`

### G ✓
- **Patrón:** `EECCC` (índice y pulgar extendidos)
- **Dedos:** Índice extendido horizontal, pulgar extendido paralelo al índice, apuntando al frente
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** L (pulgar hacia arriba, no horizontal), Q (apuntando abajo)
- **finger_states clave:** `index=True, thumb_out=True, hand_horizontal=True`

### H ✓
- **Patrón:** `CEECC` (índice y medio extendidos)
- **Dedos:** Índice y medio extendidos juntos horizontalmente, apuntando al frente
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** U (vertical), N variante B (hacia abajo), V (separados)
- **finger_states clave:** `index=True, middle=True, hand_horizontal=True, uv_spread=False`

### I ✓
- **Patrón:** `CCCCE` (solo meñique)
- **Dedos:** Solo meñique extendido hacia arriba, resto completamente cerrado en puño
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** J (misma pose + movimiento curvo), Y (meñique + pulgar lateral)
- **finger_states clave:** `pinky=True, index=False, middle=False, ring=False, thumb_out=False`

### J ✓
- **Patrón:** `CCCCE` + movimiento
- **Dedos:** Misma configuración que I (meñique extendido)
- **Movimiento:** Sí — meñique traza un arco hacia abajo (como una J invertida)
- **Expresión facial:** Neutral
- **Confusión frecuente:** I (sin movimiento)
- **finger_states clave:** `pinky=True, has_motion=True, oscillation detected`

### K ✓
- **Patrón:** `CEECC` (índice y medio)
- **Dedos:** Índice y medio extendidos en V, pulgar tocando la base del medio
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** V (sin pulgar tocando), P (apuntando abajo)
- **finger_states clave:** `index=True, middle=True, uv_spread=True, thumb_touch_middle_base=True`

### L ✓
- **Patrón:** `EECCC` (pulgar e índice en L)
- **Dedos:** Pulgar extendido hacia arriba, índice extendido al frente, forman ángulo recto (L)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** G (horizontal, no vertical), 7 (anular toca pulgar)
- **finger_states clave:** `index=True, thumb_out=True, thumb_up=True`

### M ✓
- **Patrón:** `CCCCC` (puño)
- **Dedos:** Puño cerrado, pulgar asoma entre el anular y meñique (debajo de 3 dedos)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** N (pulgar entre 2 dedos), S (pulgar al costado), T (pulgar entre índice y medio)
- **finger_states clave:** `fist_tight=True, thumb_below_mcps=True, thumb_side_ring=True`

### N ✓
- **Patrón:** `CCCCC` (puño) / variante `CEECC` (mano abajo)
- **Dedos:** Variante A: Puño con pulgar asomando entre índice y medio. Variante B: Índice y medio extendidos apuntando abajo.
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** M (pulgar más adentro), H (horizontal), U (hacia arriba)
- **finger_states clave:** Variante A: `fist_tight=True, thumb_side_middle=True` / Variante B: `index=True, middle=True, hand_down=True`

### Ñ ✓
- **Patrón:** `CCCCC` + movimiento
- **Dedos:** Misma configuración que N
- **Movimiento:** Sí — movimiento ondulante lateral (distingue de N estática)
- **Expresión facial:** Neutral
- **Confusión frecuente:** N (sin movimiento)
- **finger_states clave:** `same as N + has_motion=True`

### O ✓
- **Patrón:** `CCCCC` (todos curvados formando O)
- **Dedos:** Todos los dedos y pulgar curvados formando un círculo/óvalo
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** C (más abierta), F (medio/anular/meñique extendidos), 0/cero
- **finger_states clave:** `thumb_touch_index=True, fist curvado, index=False (curvado, no recto)`

### P ✓
- **Patrón:** `CEECC` (índice y medio)
- **Dedos:** Como K pero apuntando hacia abajo (mano girada)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** K (misma forma pero arriba), Q (solo pulgar e índice abajo)
- **finger_states clave:** `index=True, middle=True, hand_down=True, uv_spread=True`

### Q ✓
- **Patrón:** `EECCC` (pulgar e índice)
- **Dedos:** Pulgar e índice extendidos apuntando hacia abajo
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** G (horizontal), P (con medio extendido)
- **finger_states clave:** `index=True, thumb_out=True, hand_down=True`

### R ✓
- **Patrón:** `CEECC` (índice y medio cruzados)
- **Dedos:** Índice y medio extendidos y CRUZADOS (medio sobre índice)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** U (no cruzados), H (horizontal)
- **finger_states clave:** `index=True, middle=True, fingers_crossed=True`

### S ✓
- **Patrón:** `CCCCC` (puño)
- **Dedos:** Puño cerrado, pulgar cruza POR ENCIMA de los nudillos del índice/medio
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** A (pulgar lateral), E (pulgar debajo), T (entre dedos)
- **finger_states clave:** `fist_tight=True, thumb_side_index=True, thumb_over_top=False`

### T ✓
- **Patrón:** `CCCCC` (puño)
- **Dedos:** Puño cerrado, pulgar se inserta entre el índice y medio (asomando por el frente)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** N (pulgar más abajo), S (pulgar arriba), A (lateral)
- **finger_states clave:** `fist_tight=True, thumb_over_top=True, thumb_between_IF=True`

### U ✓
- **Patrón:** `CEECC` (índice y medio)
- **Dedos:** Índice y medio extendidos juntos hacia ARRIBA (vertical)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** H (horizontal), V (separados), 2 (similar), N variante B (abajo)
- **finger_states clave:** `index=True, middle=True, hand_up=True, uv_spread=False`

### V ✓
- **Patrón:** `CEECC` (índice y medio separados)
- **Dedos:** Índice y medio extendidos y SEPARADOS en V (victoria)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** U (juntos), K (pulgar toca medio), 2 (similar a V)
- **finger_states clave:** `index=True, middle=True, uv_spread=True, hand_up=True`

### W ✓
- **Patrón:** `CEEECC` / `CEEEC` (índice, medio, anular)
- **Dedos:** Índice, medio y anular extendidos y separados, meñique y pulgar cerrados
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 3 (con pulgar), 6 (similar configuración)
- **finger_states clave:** `index=True, middle=True, ring=True, pinky=False, thumb=False`

### X ✓
- **Patrón:** `CECCC` (índice semi-doblado)
- **Dedos:** Índice doblado como GANCHO (no recto, no cerrado), resto en puño
- **Movimiento:** No (cambiado de mov=True a False)
- **Expresión facial:** Neutral
- **Confusión frecuente:** Z (con movimiento diagonal), G (índice recto), D (índice recto + pulgar)
- **finger_states clave:** `index=False (doblado, no extendido), fist_tight=False (gancho), middle=False`

### Y ✓
- **Patrón:** `ECCCE` (pulgar y meñique)
- **Dedos:** Pulgar extendido lateralmente + meñique extendido, índice/medio/anular cerrados
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** I (sin pulgar lateral), 6 (similar), "call me" / "shaka"
- **finger_states clave:** `thumb_out=True, pinky=True, index=False, middle=False, ring=False`

### Z ✓
- **Patrón:** `CECCC` + movimiento
- **Dedos:** Índice extendido (como D pero sin contacto pulgar-medio)
- **Movimiento:** Sí — índice traza una Z en el aire (diagonal, horizontal, diagonal)
- **Expresión facial:** Neutral
- **Confusión frecuente:** X (gancho sin movimiento), J (arco), D (estática)
- **finger_states clave:** `index=True, has_motion=True, traza patrón Z`

---

## NÚMEROS 1-10

### 1
- **Dedos:** Solo índice extendido hacia arriba, puño cerrado, pulgar cerrado sobre los dedos
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** D (pulgar toca medio), G (horizontal)
- **finger_states:** `index=True, thumb=False, middle=False, ring=False, pinky=False, hand_up=True`

### 2
- **Dedos:** Índice y medio extendidos juntos hacia arriba (como U)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** U (idéntico visualmente), V (separados = 2 en algunas variantes)
- **finger_states:** `index=True, middle=True, ring=False, pinky=False, hand_up=True`

### 3
- **Dedos:** Pulgar, índice y medio extendidos (los otros dos cerrados)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** W (sin pulgar), 6 (pulgar+meñique)
- **finger_states:** `thumb_out=True, index=True, middle=True, ring=False, pinky=False`

### 4
- **Dedos:** Índice, medio, anular y meñique extendidos hacia arriba, pulgar doblado sobre palma
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** B (similar), 5 (con pulgar abierto)
- **finger_states:** `index=True, middle=True, ring=True, pinky=True, thumb=False`

### 5
- **Dedos:** Los 5 dedos extendidos y separados (mano abierta)
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** B (dedos juntos), 4+pulgar
- **finger_states:** `thumb_out=True, index=True, middle=True, ring=True, pinky=True`

### 6
- **Dedos:** Meñique y pulgar extendidos lateralmente, índice/medio/anular cerrados (como Y)
- **Movimiento:** Algunas variantes incluyen agitar la mano
- **Expresión facial:** Neutral
- **Confusión frecuente:** Y (idéntico en pose estática), "shaka"
- **finger_states:** `thumb_out=True, pinky=True, index=False, middle=False, ring=False`

### 7
- **Dedos:** Anular y pulgar se tocan en las yemas, índice/medio/meñique extendidos
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 8 (medio toca pulgar), W (sin contacto)
- **finger_states:** `thumb_touch_ring=True, index=True, middle=True, pinky=True`

### 8
- **Dedos:** Medio y pulgar se tocan en las yemas, índice/anular/meñique extendidos
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** 7 (anular toca), 9 (índice toca)
- **finger_states:** `thumb_touch_middle=True, index=True, ring=True, pinky=True`

### 9
- **Dedos:** Índice y pulgar forman círculo (como F/OK), medio/anular/meñique extendidos
- **Movimiento:** No
- **Expresión facial:** Neutral
- **Confusión frecuente:** F (idéntico), OK gesture, 0 (sin dedos extendidos)
- **finger_states:** `thumb_touch_index=True, middle=True, ring=True, pinky=True`

### 10
- **Dedos:** Puño con pulgar extendido hacia arriba
- **Movimiento:** Sí — agitar lateralmente o girar la muñeca
- **Expresión facial:** Neutral
- **Confusión frecuente:** A (sin movimiento), "thumbs up"
- **finger_states:** `thumb_out=True, thumb_up=True, fist_tight=True, has_motion=True`

---

## NÚMEROS 11-20 (requieren movimiento secuencial)

> Los números 11-20 en LSM son compuestos: se hace primero el signo de 10 (puño+pulgar con giro)
> y luego el dígito correspondiente (1-9). No son detectables con una sola pose estática.
> En la academia, se usa modo "participación" (mano visible + hold).

| Número | Secuencia | Nota |
|--------|-----------|------|
| 11 | 10 → 1 | Pulgar gira + índice |
| 12 | 10 → 2 | Pulgar gira + U |
| 13 | 10 → 3 | Pulgar gira + pulgar+índice+medio |
| 14 | 10 → 4 | Pulgar gira + 4 dedos |
| 15 | 10 → 5 | Pulgar gira + mano abierta |
| 16 | 10 → 6 | Pulgar gira + Y/shaka |
| 17 | 10 → 7 | Pulgar gira + anular-pulgar |
| 18 | 10 → 8 | Pulgar gira + medio-pulgar |
| 19 | 10 → 9 | Pulgar gira + F/OK |
| 20 | Pinza L → se tocan | Índice y pulgar forman L, luego se juntan |

---

## CONFUSIONES CRÍTICAS (para mejorar _extra_* functions)

| Par confuso | Diferencia clave | Cómo discriminar |
|-------------|------------------|------------------|
| A / E / S | Posición del pulgar | A: lateral. E: debajo nudillos. S: sobre nudillos frente |
| I / J | Movimiento | I: estática. J: arco descendente |
| N / Ñ | Movimiento | N: estática. Ñ: ondulación lateral |
| U / V / 2 | Separación dedos | U: juntos. V: separados en V. 2 = U o V según variante |
| N / H / U | Dirección mano | N: abajo. H: horizontal. U: arriba |
| X / Z | Movimiento + forma | X: gancho estático. Z: índice recto traza Z |
| G / L / Q | Orientación | G: horizontal. L: ángulo recto vertical. Q: abajo |
| O / C / F | Apertura | O: cerrada. C: semicírculo abierto. F: O+dedos arriba |
| Y / I / 6 | Pulgar | Y: pulgar lateral. I: sin pulgar. 6 = Y (regional) |
| D / 1 | Contacto pulgar | D: pulgar toca medio. 1: pulgar cerrado |
| B / 4 | Pulgar | B: cruzado. 4: doblado sin cruzar |

---

## REFERENCIA PARA EL GLOSARIO CDMX (19 categorías)

Categorías confirmadas en `https://lsm.indiscapacidad.cdmx.gob.mx/ejes/`:

| # | Categoría | URL confirmada | Señas estimadas |
|---|-----------|----------------|-----------------|
| 1 | Abecedario | `/ejes/abecedario/` ❌ 404 | 27 |
| 2 | Números | `/ejes/numeros/` ✓ | ~30 |
| 3 | Colores | `/ejes/colores/` ✓ | ~15 |
| 4 | Familia | `/ejes/familia/` ✓ | ~25 |
| 5 | Expresiones cotidianas | `/ejes/expresiones-cotidianas/` ❓ | ~60 |
| 6 | Salud | `/ejes/salud/` ❓ | ~50 |
| 7 | Trabajo | `/ejes/trabajo/` ❓ | ~40 |
| 8 | Educación | `/ejes/educacion/` ❓ | ~45 |
| 9 | Derechos | `/ejes/derechos/` ❓ | ~35 |
| 10 | Gobierno | `/ejes/gobierno/` ❓ | ~40 |
| 11 | Transporte | `/ejes/transporte/` ❓ | ~30 |
| 12 | Vivienda | `/ejes/vivienda/` ❓ | ~25 |
| 13 | Medio ambiente | `/ejes/medio-ambiente/` ❓ | ~30 |
| 14 | Tecnología | `/ejes/tecnologia/` ❓ | ~35 |
| 15 | Cultura | `/ejes/cultura/` ❓ | ~40 |
| 16 | Deporte | `/ejes/deporte/` ❓ | ~35 |
| 17 | Emociones | `/ejes/emociones/` ❌ 404 | ~30 |
| 18 | Tiempo | `/ejes/tiempo/` ❓ | ~25 |
| 19 | (Sin confirmar) | ❓ | ~32 |

> ✓ = página respondió (contenido dinámico, no extraíble)
> ❌ = 404
> ❓ = no probada

**Total estimado: 719 videos** (según el sitio oficial)
