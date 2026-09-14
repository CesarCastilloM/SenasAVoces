# Lesson Builder — flujo de autoría de lecciones

Las lecciones del curso ya no viven hardcodeadas en `src/data/lessons_glosario.js`.
Ahora se guardan en Supabase y se editan desde **/admin/lessons**, una ruta
protegida dentro de la misma app React. El archivo `lessons_glosario.js` se
conserva como **fallback** (si Supabase no está configurado, no hay lecciones
publicadas, o la consulta falla, la app usa el currículo empaquetado).

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `admins` | `user_id` → quién puede usar el builder (RLS) |
| `words` | Banco de palabras/señas: `label` (único), `glyph`, `video_ref` (YouTube embed o `/videos/signs/*.mp4`), `thumbnail`, `hint`, `template`, `mov`, `tags` |
| `lessons` | `slug` (id público, ej. `G0`), `title`, `level`, `module`, `position`, `status` (`draft`/`published`), `intro_md` |
| `lesson_steps` | Pasos ordenables de una lección: `type`, `word_id`, `word_ids` (distractores/pares), `reps`, `explanation`, `hint`, `threshold` |

`lessons.slug` es el `module_id` que ya usan `module_progress` y
`sign_practice`, así el progreso existente de los alumnos sigue funcionando.

Tipos de paso: `mostrar_seña`, `elegir_correcta`, `deletrear`,
`escucha_y_repite`, `opcion_multiple`, `emparejar`. Los tipos con varias
palabras usan `word_ids` para distractores/pares (la primera palabra elegida
es la respuesta correcta).

## Setup (una sola vez)

1. **Aplicar la migración** en el SQL editor de Supabase:
   `supabase/migrations/001_lesson_builder.sql`

2. **Darte admin** (en el SQL editor, con tu email):

   ```sql
   insert into public.admins (user_id)
     select id from auth.users where email = 'tu@email.com'
   on conflict do nothing;
   ```

3. **Migrar el currículo actual** a Supabase:

   ```bash
   # agrega SUPABASE_SERVICE_ROLE_KEY=... a tu .env
   # (Settings → API → service_role en el dashboard de Supabase)
   node scripts/seed_lessons.mjs
   ```

   El seed crea las palabras, las 8 lecciones G0–G7 como `published` y un
   paso `mostrar_seña` por cada seña.

## Uso del builder

1. Inicia sesión con un usuario admin → navega a `/admin/lessons`.
2. **Lista**: estado (borrador/publicada), nivel, # de pasos, publicar/
   despublicar/eliminar rápido.
3. **Editor**: título, slug, nivel, módulo, orden, intro markdown; pasos con
   drag&drop (⠿), tipo de ejercicio, palabra(s) del banco con preview de
   video inline, repeticiones, hint y threshold.
4. **Preview** en vivo a la derecha: cómo se verá cada paso para el alumno.
5. "Guardar borrador" no afecta a los alumnos; "Publicar" lo hace visible.

## Cómo lo consume la app

`useModules()` en `src/main.jsx` devuelve el currículo empaquetado al instante
y, en segundo plano, consulta `fetchPublishedModules()` en
`src/services/lessonService.js`. Si Supabase devuelve lecciones publicadas,
reemplazan al bundle en `LearnPage` y `LessonPage` sin tocar el pipeline de
inferencia (ONNX/WASM, `lsm_detector`, `dynamic_sign_detector` intactos).

Los pasos se mapean a `items[]` (el formato que el grid de señas ya renderiza)
con metadata extra (`stepType`, `reps`, `threshold`). Hoy el runtime del
alumno reproduce todos los pasos como "ver seña + practicar"; los tipos
quiz/emparejar ya se guardan y se previsualizan en el builder — el motor de
ejercicios del lado del alumno es la siguiente fase.

## Sistema de desbloqueo (prerequisitos)

Modelo: tabla `lesson_prerequisites (lesson_id, requires_lesson_id)` — un
grafo, no una cadena (una lección puede requerir varias). Una lección **sin
filas siempre está desbloqueada**. Migración: `002_lesson_prerequisites.sql`,
que además siembra la cadena lineal por defecto `G0→G1→…→G7` (idéntica al
comportamiento secuencial que la app ya tenía implícito).

**Cómo se decide locked/unlocked:** la función RPC
`get_my_lesson_unlocks()` (security definer) devuelve por lección publicada
`is_unlocked` + `missing_prereq_slugs` para el usuario actual. "Completada"
usa el mismo criterio de siempre sobre `module_progress`:
`status='completed'` o `signs_completed >= total_signs` (cuando total > 0).

**Frontend:** `useLessonUnlocks()` en `main.jsx` consulta el RPC y se
refresca cuando cambia `moduleProgress` (completar un módulo desbloquea el
siguiente en vivo). `LearnPage` y `LessonPage` mezclan ese estado con el
candado/opacidad que ya existía; si el RPC falla o no hay sesión, caen al
desbloqueo secuencial anterior — nada se rompe.

**Builder:** el editor tiene "Requiere completar" con chips multi-select de
las demás lecciones, validación anti-ciclos en vivo y al guardar
(`createsCycle` hace DFS sobre el grafo con la edición aplicada).

**Navbar:** el hook `useIsAdmin()` (`src/hooks/useIsAdmin.js`) es la fuente
única del chequeo de admin — lo usan `AppHeader` (link "Admin" ⚙ solo para
admins) y el guard de `/admin/lessons`.

## RLS (resumen)

- `words`: lectura pública; escritura solo admins.
- `lessons`: `published` lectura pública; `draft` solo admins; escritura admins.
- `lesson_steps`: lectura si la lección padre está publicada; escritura admins.
- `lesson_prerequisites`: lectura pública; escritura admins.
- `is_admin()` es `security definer` y consulta `public.admins`.
