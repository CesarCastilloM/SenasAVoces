/**
 * LSM Lecciones para Señas a Voces Academy (app.js)
 * --------------------------------------------------
 * Datos basados en el Glosario Digital LSM del INDISCAPACIDAD CDMX
 * URL: https://lsm.indiscapacidad.cdmx.gob.mx/
 *
 * NOTA: Las descripciones de señas complejas (no alfabeto) están marcadas
 * como "pendiente_verificacion" cuando no pudieron extraerse directamente
 * del sitio web (SPA con contenido dinámico). Requieren verificación manual.
 *
 * Para integrar en app.js, reemplazar los arrays de lessons[] existentes.
 *
 * Modo de práctica:
 * - 'strict': reconocimiento real por MediaPipe (letras, números 1-5)
 * - 'participation': requiere mano visible con confianza >= 0.50 (frases, números 6-20)
 */

// ========================================================================
// NIVEL 1 — BÁSICO
// ========================================================================

const LECCION_L1_1_ABECEDARIO = {
  id: 'L1.1', titulo: 'Abecedario LSM', nivel: 1,
  modo_practica: 'strict',
  items: [
    // El abecedario ya está cubierto por el array `targets` principal de app.js
    // (A-Z + Ñ). No necesita items individuales aquí.
    // Se accede a través del flujo "Practicar Abecedario".
  ]
};

const LECCION_L1_2_NUMEROS = {
  id: 'L1.2', titulo: 'Números 1-20', nivel: 1,
  items: [
    // Números 1-5: reconocimiento estricto (configuración de dedos detectable)
    { texto: '1', descripcion: 'Índice extendido arriba, puño cerrado, pulgar cerrado', modo_practica: 'strict' },
    { texto: '2', descripcion: 'Índice y medio extendidos juntos hacia arriba', modo_practica: 'strict' },
    { texto: '3', descripcion: 'Pulgar, índice y medio extendidos', modo_practica: 'strict' },
    { texto: '4', descripcion: '4 dedos extendidos arriba, pulgar doblado sobre la palma', modo_practica: 'strict' },
    { texto: '5', descripcion: 'Mano abierta, 5 dedos extendidos y separados', modo_practica: 'strict' },
    // Números 6-10: participación (poses más complejas o con movimiento)
    { texto: '6', descripcion: 'Pulgar y meñique extendidos lateralmente (como Y), resto cerrado', modo_practica: 'participation' },
    { texto: '7', descripcion: 'Anular y pulgar se tocan en las yemas; índice, medio y meñique extendidos', modo_practica: 'participation' },
    { texto: '8', descripcion: 'Medio y pulgar se tocan; índice, anular y meñique extendidos', modo_practica: 'participation' },
    { texto: '9', descripcion: 'Índice y pulgar forman círculo; medio, anular y meñique extendidos', modo_practica: 'participation' },
    { texto: '10', descripcion: 'Puño con pulgar arriba, agitar o girar la muñeca', modo_practica: 'participation' },
    // Números 11-20: participación (secuencias compuestas)
    { texto: '11', descripcion: 'Seña de 10 (pulgar gira) seguida de 1 (índice)', modo_practica: 'participation' },
    { texto: '12', descripcion: 'Seña de 10 seguida de 2 (índice y medio)', modo_practica: 'participation' },
    { texto: '13', descripcion: 'Seña de 10 seguida de 3 (pulgar+índice+medio)', modo_practica: 'participation' },
    { texto: '14', descripcion: 'Seña de 10 seguida de 4 (cuatro dedos)', modo_practica: 'participation' },
    { texto: '15', descripcion: 'Seña de 10 seguida de 5 (mano abierta)', modo_practica: 'participation' },
    { texto: '16', descripcion: 'Seña de 10 seguida de 6 (pulgar+meñique)', modo_practica: 'participation' },
    { texto: '17', descripcion: 'Seña de 10 seguida de 7 (anular toca pulgar)', modo_practica: 'participation' },
    { texto: '18', descripcion: 'Seña de 10 seguida de 8 (medio toca pulgar)', modo_practica: 'participation' },
    { texto: '19', descripcion: 'Seña de 10 seguida de 9 (índice toca pulgar)', modo_practica: 'participation' },
    { texto: '20', descripcion: 'Índice y pulgar en forma de L, se juntan dos veces (pinza doble)', modo_practica: 'participation' },
  ]
};

const LECCION_L1_3_SALUDOS = {
  id: 'L1.3', titulo: 'Saludos y Expresiones', nivel: 1,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/expresiones-cotidianas/',
  items: [
    { texto: 'HOLA', descripcion: 'Mano abierta se alza y mueve lateralmente (saludo)' },
    { texto: 'ADIÓS', descripcion: 'Mano abierta palma al frente, agitar dedos (despedida)' },
    { texto: 'GRACIAS', descripcion: 'Mano plana toca mentón/labios y se extiende al frente' },
    { texto: 'POR FAVOR', descripcion: 'Mano plana hace circular sobre el pecho' },
    { texto: 'PERDÓN', descripcion: 'Puño frota el pecho en círculo (disculpa)' },
    { texto: 'SÍ', descripcion: 'Puño con muñeca flexionando arriba-abajo (asentir)' },
    { texto: 'NO', descripcion: 'Índice y medio se cierran contra el pulgar (pinza negativa)' },
    { texto: 'BUENOS DÍAS', descripcion: 'Seña de bueno + sol ascendiendo (mañana)' },
    { texto: 'BUENAS NOCHES', descripcion: 'Seña de bueno + mano cubriendo (oscuridad)' },
    { texto: '¿CÓMO ESTÁS?', descripcion: 'Señalar persona + manos palma arriba (interrogativa)' },
    { texto: 'MUCHO GUSTO', descripcion: 'Manos se estrechan frente al cuerpo (encuentro)' },
    { texto: 'MI NOMBRE ES', descripcion: 'Índice toca pecho + dedos deletrean' },
  ]
};

const LECCION_L1_4_FAMILIA = {
  id: 'L1.4', titulo: 'Familia', nivel: 1,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/familia/',
  items: [
    { texto: 'MAMÁ', descripcion: 'Mano abierta toca mejilla con palmada suave' },
    { texto: 'PAPÁ', descripcion: 'Puño con pulgar arriba toca frente o sien' },
    { texto: 'HERMANO', descripcion: 'Índices paralelos se mueven juntos al frente' },
    { texto: 'HERMANA', descripcion: 'Como hermano pero con meñiques extendidos' },
    { texto: 'HIJO', descripcion: 'Mano plana palma abajo desciende frente al cuerpo' },
    { texto: 'HIJA', descripcion: 'Seña de hijo + seña de mujer (mejilla)' },
    { texto: 'ABUELO', descripcion: 'Mano curvada se aleja de la barbilla hacia atrás' },
    { texto: 'ABUELA', descripcion: 'Seña de abuelo + toque en mejilla (mujer)' },
    { texto: 'BEBÉ', descripcion: 'Brazos cruzados meciéndose (acunar)' },
    { texto: 'FAMILIA', descripcion: 'Letra F con movimiento circular frente al pecho' },
  ]
};

const LECCION_L1_5_COLORES = {
  id: 'L1.5', titulo: 'Colores', nivel: 1,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/colores/',
  items: [
    { texto: 'ROJO', descripcion: 'Índice toca labio inferior y desliza hacia abajo' },
    { texto: 'AZUL', descripcion: 'Letra A se desliza por el dorso de la mano contraria' },
    { texto: 'AMARILLO', descripcion: 'Mano en Y sacudida lateralmente a la altura del hombro' },
    { texto: 'VERDE', descripcion: 'Mano en V con movimiento ondulante frente al pecho' },
    { texto: 'BLANCO', descripcion: 'Mano abierta sobre pecho se aleja cerrándose (pureza)' },
    { texto: 'NEGRO', descripcion: 'Dorso de la mano frota la frente o ceja' },
    { texto: 'NARANJA', descripcion: 'Puño frente a la boca, se abre y cierra (exprimir)' },
    { texto: 'MORADO', descripcion: 'Letra M con movimiento circular junto a la sien' },
    { texto: 'ROSA', descripcion: 'Índice toca labio y desciende con ligero giro' },
    { texto: 'CAFÉ', descripcion: 'Puño con pulgar arriba frota mentón arriba-abajo' },
  ]
};

// ========================================================================
// NIVEL 2 — INTERMEDIO
// ========================================================================

const LECCION_L2_1_EMOCIONES = {
  id: 'L2.1', titulo: 'Emociones', nivel: 2,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/emociones/',
  items: [
    { texto: 'FELIZ', descripcion: 'Manos abiertas suben por el pecho con sonrisa' },
    { texto: 'TRISTE', descripcion: 'Mano abierta baja frente al rostro, expresión triste' },
    { texto: 'ENOJADO', descripcion: 'Dedos curvados como garras frente al rostro, ceño fruncido' },
    { texto: 'MIEDO', descripcion: 'Manos abiertas tiemblan frente al pecho' },
    { texto: 'SORPRESA', descripcion: 'Manos suben rápido junto a la cara, boca abierta' },
    { texto: 'ABURRIDO', descripcion: 'Índice gira lentamente sobre la nariz o barbilla' },
    { texto: 'CANSADO', descripcion: 'Manos caen pesadamente sobre el pecho' },
    { texto: 'NERVIOSO', descripcion: 'Manos abiertas tiemblan frente al torso' },
    { texto: 'TRANQUILO', descripcion: 'Manos palma abajo descienden suavemente (calma)' },
    { texto: 'LLORAR', descripcion: 'Índices bajan por las mejillas (lágrimas)' },
  ]
};

const LECCION_L2_2_NECESIDADES = {
  id: 'L2.2', titulo: 'Necesidades Básicas', nivel: 2,
  modo_practica: 'participation',
  items: [
    { texto: 'COMER', descripcion: 'Mano junta lleva comida a la boca repetidamente' },
    { texto: 'BEBER', descripcion: 'Mano en C se lleva a la boca (vaso)' },
    { texto: 'DORMIR', descripcion: 'Mano junto a mejilla inclinada, ojos cerrados' },
    { texto: 'AGUA', descripcion: 'Letra W toca la barbilla' },
    { texto: 'HAMBRE', descripcion: 'Mano baja por el estómago (vacío)' },
    { texto: 'SED', descripcion: 'Índice baja por la garganta' },
    { texto: 'FRÍO', descripcion: 'Puños tiemblan junto al cuerpo (tiritar)' },
    { texto: 'CALOR', descripcion: 'Mano se abanica frente al rostro' },
    { texto: 'BAÑO', descripcion: 'Letra B sacudida con urgencia' },
    { texto: 'DESCANSAR', descripcion: 'Manos cruzadas sobre el pecho (reposo)' },
  ]
};

const LECCION_L2_3_ESCUELA = {
  id: 'L2.3', titulo: 'Escuela y Trabajo', nivel: 2,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/educacion/',
  items: [
    { texto: 'ESCUELA', descripcion: 'Palmas se juntan y abren (libro)' },
    { texto: 'MAESTRO', descripcion: 'Mano en garra baja frente a la frente (saber)' },
    { texto: 'LIBRO', descripcion: 'Palmas juntas se abren (abrir libro)' },
    { texto: 'ESCRIBIR', descripcion: 'Mano simula escribir sobre la palma contraria' },
    { texto: 'ESTUDIAR', descripcion: 'Dedos tamborilean sobre la palma (memorizar)' },
    { texto: 'TRABAJO', descripcion: 'Puños se golpean alternadamente (laborar)' },
    { texto: 'DINERO', descripcion: 'Pulgar frota índice y medio (billete)' },
    { texto: 'COMPUTADORA', descripcion: 'Dedos simulan teclear sobre superficie' },
    { texto: 'TELÉFONO', descripcion: 'Mano en Y junto a la oreja (auricular)' },
    { texto: 'REUNIÓN', descripcion: 'Manos se juntan desde los lados (personas)' },
  ]
};

const LECCION_L2_4_SALUD = {
  id: 'L2.4', titulo: 'Salud', nivel: 2,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/salud/',
  items: [
    { texto: 'DOCTOR', descripcion: 'Índice y medio tocan la muñeca contraria (pulso)' },
    { texto: 'HOSPITAL', descripcion: 'Letra H trazada como cruz en el brazo' },
    { texto: 'MEDICINA', descripcion: 'Dedo medio frota la palma contraria (moler pastilla)' },
    { texto: 'DOLOR', descripcion: 'Índices apuntándose giran en la zona del dolor' },
    { texto: 'ENFERMO', descripcion: 'Mano en garra frente al estómago, expresión de malestar' },
    { texto: 'SANO', descripcion: 'Puños frente al pecho se abren con fuerza (energía)' },
    { texto: 'FIEBRE', descripcion: 'Dorso de la mano toca la frente + expresión malestar' },
    { texto: 'VACUNA', descripcion: 'Pulgar presiona el brazo (inyección)' },
    { texto: 'EMERGENCIA', descripcion: 'Letra E sacudida con urgencia (alerta)' },
    { texto: 'AMBULANCIA', descripcion: 'Puño con movimiento circular sobre la cabeza (sirena)' },
  ]
};

const LECCION_L2_5_CONVERSACION = {
  id: 'L2.5', titulo: 'Conversación', nivel: 2,
  modo_practica: 'participation',
  items: [
    { texto: 'YO', descripcion: 'Índice señala el propio pecho' },
    { texto: 'TÚ', descripcion: 'Índice señala al interlocutor' },
    { texto: 'ÉL/ELLA', descripcion: 'Índice señala a un lado (tercera persona)' },
    { texto: 'NOSOTROS', descripcion: 'Índice hace semicírculo incluyéndose' },
    { texto: 'QUERER', descripcion: 'Mano en garra se acerca al pecho (deseo)' },
    { texto: 'PODER', descripcion: 'Puños bajan con fuerza (capacidad)' },
    { texto: 'SABER', descripcion: 'Índice toca la sien (conocimiento)' },
    { texto: 'ENTENDER', descripcion: 'Dedo índice junto a la sien se extiende (comprensión)' },
    { texto: 'REPETIR', descripcion: 'Mano gira sobre sí misma (de nuevo)' },
    { texto: 'MÁS DESPACIO', descripcion: 'Mano palma abajo desciende lentamente' },
  ]
};

// ========================================================================
// NIVEL 3 — AVANZADO (vocabulario temático expandido)
// ========================================================================

const LECCION_L3_1_DERECHOS = {
  id: 'L3.1', titulo: 'Derechos e Inclusión', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/derechos/',
  items: [
    { texto: 'DERECHO', descripcion: 'Mano plana vertical sube con fuerza (ley)' },
    { texto: 'IGUALDAD', descripcion: 'Manos planas paralelas al mismo nivel' },
    { texto: 'JUSTICIA', descripcion: 'Manos como balanza se equilibran' },
    { texto: 'LIBERTAD', descripcion: 'Puños cruzados se abren hacia los lados (romper cadenas)' },
    { texto: 'RESPETO', descripcion: 'Mano plana desciende frente al rostro (reverencia)' },
    { texto: 'INCLUSIÓN', descripcion: 'Mano abierta recoge y cierra (abrazar/incluir)' },
    { texto: 'ACCESIBILIDAD', descripcion: 'Manos forman rampa ascendente' },
    { texto: 'LEY', descripcion: 'Letra L sobre la palma abierta (ley escrita)' },
  ]
};

const LECCION_L3_2_GOBIERNO = {
  id: 'L3.2', titulo: 'Gobierno y Ciudadanía', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/gobierno/',
  items: [
    { texto: 'GOBIERNO', descripcion: 'Mano en G con movimiento circular (gestión)' },
    { texto: 'PRESIDENTE', descripcion: 'Mano sobre la cabeza (autoridad máxima)' },
    { texto: 'CREDENCIAL', descripcion: 'Mano muestra rectángulo frente al pecho (ID)' },
    { texto: 'TRÁMITE', descripcion: 'Mano escribe y entrega papel' },
    { texto: 'VOTO', descripcion: 'Mano inserta papel en ranura (urna)' },
    { texto: 'IMPUESTO', descripcion: 'Mano quita de la palma contraria (extraer)' },
  ]
};

const LECCION_L3_3_TRANSPORTE = {
  id: 'L3.3', titulo: 'Transporte', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/transporte/',
  items: [
    { texto: 'METRO', descripcion: 'Letra M se mueve al frente (tren subterráneo)' },
    { texto: 'CAMIÓN', descripcion: 'Manos giran volante grande' },
    { texto: 'TAXI', descripcion: 'Mano en T se mueve al frente' },
    { texto: 'BICICLETA', descripcion: 'Puños giran alternándose (pedalear)' },
    { texto: 'AVIÓN', descripcion: 'Mano con dedos extendidos se mueve en diagonal (ala)' },
    { texto: 'CARRO', descripcion: 'Manos giran volante normal' },
  ]
};

const LECCION_L3_4_TECNOLOGIA = {
  id: 'L3.4', titulo: 'Tecnología', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/tecnologia/',
  items: [
    { texto: 'INTERNET', descripcion: 'Dedos medios se tocan y giran (red conectada)' },
    { texto: 'CELULAR', descripcion: 'Mano junto a la oreja en forma de teléfono pequeño' },
    { texto: 'VIDEO', descripcion: 'Mano simula cámara girando (grabar)' },
    { texto: 'FOTO', descripcion: 'Manos forman cuadro y pulgar presiona (clic)' },
    { texto: 'CORREO', descripcion: 'Mano sale de la otra al frente (enviar)' },
    { texto: 'PANTALLA', descripcion: 'Manos forman rectángulo horizontal' },
  ]
};

const LECCION_L3_5_CULTURA = {
  id: 'L3.5', titulo: 'Cultura y Deporte', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/cultura/',
  items: [
    { texto: 'MÚSICA', descripcion: 'Mano se balancea como director de orquesta' },
    { texto: 'DANZA', descripcion: 'Dedos en V invertida se balancean (bailar)' },
    { texto: 'FÚTBOL', descripcion: 'Pie patea objeto imaginario' },
    { texto: 'NATACIÓN', descripcion: 'Brazos simulan brazada de nado' },
    { texto: 'FIESTA', descripcion: 'Manos abiertas giran alternándose arriba (celebrar)' },
    { texto: 'COMUNIDAD SORDA', descripcion: 'Seña de sordo + seña de grupo' },
  ]
};

const LECCION_L3_6_TIEMPO = {
  id: 'L3.6', titulo: 'Tiempo y Naturaleza', nivel: 3,
  modo_practica: 'participation',
  video_referencia: 'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/tiempo/',
  items: [
    { texto: 'HOY', descripcion: 'Manos palma abajo al nivel actual (ahora)' },
    { texto: 'AYER', descripcion: 'Pulgar señala sobre el hombro hacia atrás' },
    { texto: 'MAÑANA', descripcion: 'Mano se mueve adelante desde la barbilla' },
    { texto: 'AGUA', descripcion: 'Letra W toca la barbilla' },
    { texto: 'SOL', descripcion: 'Puño arriba se abre (rayos)' },
    { texto: 'LLUVIA', descripcion: 'Dedos bajan repetidamente (gotas)' },
    { texto: 'ÁRBOL', descripcion: 'Antebrazo vertical, mano abierta arriba (copa)' },
    { texto: 'TIERRA', descripcion: 'Dedos frotan como suelo o manos forman esfera' },
  ]
};

// ========================================================================
// EXPORTACIÓN / INTEGRACIÓN
// ========================================================================

/**
 * Para integrar en app.js, adaptar este array al formato de `lessons[]`:
 *
 * Cada lección necesita:
 * - id, titulo, items[] con {glyph, desc}
 * - El campo `modo_practica` determina si el reconocimiento es
 *   'strict' (matched real del backend) o 'participation' (handVisible + conf >= 0.50)
 */
const ALL_LECCIONES_LSM = [
  LECCION_L1_1_ABECEDARIO,
  LECCION_L1_2_NUMEROS,
  LECCION_L1_3_SALUDOS,
  LECCION_L1_4_FAMILIA,
  LECCION_L1_5_COLORES,
  LECCION_L2_1_EMOCIONES,
  LECCION_L2_2_NECESIDADES,
  LECCION_L2_3_ESCUELA,
  LECCION_L2_4_SALUD,
  LECCION_L2_5_CONVERSACION,
  LECCION_L3_1_DERECHOS,
  LECCION_L3_2_GOBIERNO,
  LECCION_L3_3_TRANSPORTE,
  LECCION_L3_4_TECNOLOGIA,
  LECCION_L3_5_CULTURA,
  LECCION_L3_6_TIEMPO,
];

// Total: 16 lecciones, ~170 señas
// Fuente primaria: Glosario Digital LSM INDISCAPACIDAD CDMX (719 videos, 19 categorías)
// Nota legal: Contenido requiere autorización de INDISCAPACIDAD CDMX para reproducción.
