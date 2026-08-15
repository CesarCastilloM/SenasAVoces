# 🤟 Señas a Voces Academy

Plataforma web educativa **gratuita y accesible** para aprender Lengua de Señas Mexicana (LSM).

> **"La comunicación es un derecho, no un privilegio."**

Proyecto Enactus México 2026 · Hermosillo, Sonora

---

## 🚀 Cómo correrla

**Opción 1 — Local (5 segundos):**
```bash
# Solo abre index.html en cualquier navegador moderno
# O bien usa un servidor estático:
python -m http.server 8080
# Visita http://localhost:8080
```

**Opción 2 — Deploy estático (gratis):**
- Sube los 3 archivos a [Netlify Drop](https://app.netlify.com/drop) → URL en 30 segundos
- O a GitHub Pages → settings → Pages → Deploy from branch
- O a Vercel / Cloudflare Pages

---

## 📁 Estructura

```
academy/
├── index.html      → HTML semántico + accesible (WCAG 2.1 AA)
├── styles.css      → Estilos con variables CSS, modo claro/oscuro/alto contraste
├── app.js          → Lógica vanilla JS (sin dependencias)
└── README.md       → Este archivo
```

---

## 🎯 Secciones implementadas

| Sección | Funcionalidad |
|---------|---------------|
| **Hero** | Título, CTA, contador de impacto en vivo |
| **Crisis** | 8 cifras reales sobre la deuda de México con la comunidad sorda |
| **Cómo funciona** | 3 pasos visuales con animaciones |
| **Lecciones** | 4 niveles, Nivel 1 100% funcional con quiz |
| **Cámara** | WebRTC + mock de reconocimiento (listo para conectar a `lsmteacher.py`) |
| **Dashboard** | Estadísticas en tiempo real, mapa de México, feed en vivo |
| **Progreso** | Árbol de habilidades estilo Duolingo, insignias, racha |
| **Registro** | Formulario opcional, datos mínimos, privacidad explícita |
| **Pilares** | Guantes + LSM Teacher + Visión computacional |
| **Equipo / Aliados / Timeline** | Storytelling visual |
| **Roadmap** | 9 productos futuros (LSM, autismo, prótesis, CAA, etc.) |
| **Footer** | Licencia CC, contacto, donación |

---

## ♿ Accesibilidad (WCAG 2.1 AA)

- ✅ Contraste mínimo 4.5:1 en texto
- ✅ Botones táctiles 44x44px mínimo
- ✅ Fuente base 18px
- ✅ Navegación completa por teclado (Tab, Enter, Escape)
- ✅ ARIA labels en todos los íconos y controles
- ✅ Modo alto contraste (toggle en header)
- ✅ Modo oscuro automático (`prefers-color-scheme`)
- ✅ `prefers-reduced-motion` respetado
- ✅ Skip link al contenido principal
- ✅ Sin CAPTCHA, sin audio autoplay, sin texto sobre imágenes
- ✅ Modo quiz alternativo si no hay cámara

---

## 🔌 Conectar con backend `lsmteacher.py`

El frontend ya tiene la lógica preparada. Solo necesitas exponer estos endpoints:

```python
# Ejemplo con FastAPI
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import base64, cv2, numpy as np

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/api/recognize")
def recognize(data: dict):
    """Recibe un frame base64 y devuelve la seña detectada."""
    img_b64 = data["frame"].split(",")[-1]
    img = cv2.imdecode(np.frombuffer(base64.b64decode(img_b64), np.uint8), cv2.IMREAD_COLOR)
    # Llama a tu motor de finger_states + LETTER_EXTRA del lsm_teacher.py
    sign, confidence = your_recognition_function(img)
    return {"sign": sign, "confidence": confidence}
```

Luego en `app.js`, reemplaza `mockRecognize()` por:

```javascript
async function realRecognize(){
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;
  canvas.getContext('2d').drawImage($('#camVideo'), 0, 0, 320, 240);
  const frame = canvas.toDataURL('image/jpeg', 0.7);
  const res = await fetch('/api/recognize', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({frame})
  });
  const {sign, confidence} = await res.json();
  // actualizar UI con sign y confidence
}
```

---

## 📊 Métricas para Enactus

El dashboard registra (y exporta como CSV) datos **anónimos**:

| Métrica | Granularidad |
|---------|--------------|
| Usuarios activos | Total |
| Lecciones completadas | Por lección, por usuario |
| Países / Estados alcanzados | Geolocalización agregada |
| Horas de práctica | Total y por usuario |
| Señas más practicadas | Ranking semanal |
| Demografía | Edad (rango), tipo de usuario, motivo |
| Racha de días | Por usuario |

**Exportar:** botón "📥 Exportar datos para Enactus (CSV)" en el dashboard.

---

## 🎨 Personalización rápida

**Colores** → `styles.css` línea 11-23 (variables `--primary`, `--accent`, etc.)

**Equipo** → `app.js`, constante `TEAM`

**Timeline** → `app.js`, constante `TIMELINE`

**Roadmap** → `app.js`, constante `ROADMAP`

**Lecciones nivel 1** → `app.js`, constante `LESSONS`

**Niveles 2-4** → Actualmente requieren registro, agregar contenido en `LESSONS` con `level:2,3,4`

---

## 📝 Licencia

**Creative Commons BY-NC-SA 4.0**

Puedes usar, modificar y redistribuir libremente para fines **educativos y no comerciales**, siempre que:
- Atribuyas a "Señas a Voces — Enactus México 2026"
- Compartas bajo la misma licencia
- No lo uses comercialmente sin autorización

---

## 📞 Contacto

- 📧 hola@senasavoces.mx
- 🏛️ Aliados: DIF Sonora · SNDIF · Comunidad Sorda de Hermosillo
- 🎓 Enactus México 2026
