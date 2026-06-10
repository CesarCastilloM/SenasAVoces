/* ============================================================
 SEÑAS A VOCES ACADEMY — APP.JS
 - Persistencia en localStorage
 - Datos mock realistas para demo
 - Mock API endpoints documentados
 - Sin frameworks externos (vanilla JS)
 ============================================================ */
(function(){
'use strict';

/* ============================================================
 1. DATOS MAESTROS
 ============================================================ */

// Alfabeto LSM (descripciones simples)
const ALPHABET = [
 ['A','Puño cerrado con el pulgar visible al costado.'],
 ['B','Cuatro dedos juntos hacia arriba; pulgar cruzado sobre la palma.'],
 ['C','Toda la mano curvada en forma de "C", dedos juntos.'],
 ['D','Índice apuntando arriba; el pulgar toca la yema del medio.'],
 ['E','Todos los dedos doblados tocando la palma; pulgar sobre ellos.'],
 ['F','Pulgar e índice se tocan formando un círculo; otros 3 arriba.'],
 ['G','Pulgar e índice extendidos en horizontal, como apuntando.'],
 ['H','Índice y medio juntos en horizontal, como apuntando al costado.'],
 ['I','Solo el meñique extendido hacia arriba; resto en puño.'],
 ['J','Como "I" pero dibujando una "J" en el aire con el meñique.'],
 ['K','Índice y medio en V con pulgar entre ellos, hacia el frente.'],
 ['L','Mano vertical: pulgar e índice en ángulo recto ("L").'],
 ['M','Puño con tres dedos doblados sobre el pulgar.'],
 ['N','Puño con dos dedos doblados sobre el pulgar.'],
 ['Ñ','Como "N" pero con un leve movimiento ondulante.'],
 ['O','Todos los dedos juntos al pulgar formando un círculo "O".'],
 ['P','Índice hacia arriba y medio al frente; pulgar entre ellos.'],
 ['Q','Como "G" pero bajando la mano (pulgar e índice hacia abajo).'],
 ['R','Índice y medio cruzados (uno sobre el otro); resto cerrado.'],
 ['S','Puño compacto; el pulgar va sobre los dedos.'],
 ['T','Puño con el pulgar asomando entre el índice y el medio.'],
 ['U','Índice y medio juntos, apuntando hacia arriba.'],
 ['V','Índice y medio separados (V de victoria).'],
 ['W','Índice, medio y anular extendidos hacia arriba (tres dedos).'],
 ['X','Índice doblado como gancho; resto cerrado.'],
 ['Y','Solo pulgar y meñique extendidos ("call me").'],
 ['Z','Índice extendido dibujando una "Z" en el aire.']
];

// Lecciones nivel 1 (libres)
const LESSONS = [
 {id:'L1.1', level:1, title:'Alfabeto LSM', items: ALPHABET.map(([g,d])=>({glyph:g,label:'Letra '+g,desc:d}))},
 // L1.2-L1.5 se sobreescriben por GLOSARIO_LESSONS con datos completos en orden correcto
 {id:'G1', level:1, title:'Números (todos)', icon:'�', items:[]},
 {id:'G2', level:1, title:'Expresiones cotidianas',items:[]},
 {id:'G3', level:2, title:'Colores (todos)', items:[]},
 {id:'G4', level:2, title:'Familia (50 señas)', items:[]}
,
 // ============== NIVEL 2 — Comunicación diaria ==============
 {id:'L2.1', level:2, title:'Emociones', video_ref:'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/emociones/', items:[
 {glyph:'',label:'FELIZ', desc:'Ambas manos abiertas subiendo por el pecho alternadamente con sonrisa amplia.'},
 {glyph:'',label:'TRISTE', desc:'Índices bajando por las mejillas desde los ojos (lágrimas), expresión triste.'},
 {glyph:'',label:'ENOJADO', desc:'Manos en garra frente al rostro tensando los dedos, ceño fruncido.'},
 {glyph:'',label:'ASUSTADO', desc:'Manos abiertas subiéndose rápido frente al pecho, ojos muy abiertos.'},
 {glyph:'',label:'SORPRENDIDO',desc:'Manos en C junto a los ojos abriéndose rápido, cejas arriba, boca abierta.'},
 {glyph:'',label:'AMOR', desc:'Brazos cruzados sobre el pecho (auto-abrazo), expresión cálida.'},
 ]},
 {id:'L2.2', level:2, title:'Necesidades básicas', items:[
 {glyph:'',label:'COMER', desc:'Mano cerrada (como sujetando comida) acercándose a la boca varias veces.'},
 {glyph:'',label:'BEBER', desc:'Mano en C (forma de vaso) llevándose a la boca e inclinando.'},
 {glyph:'',label:'AGUA', desc:'Letra W tocando la barbilla dos veces con los tres dedos.'},
 {glyph:'',label:'DORMIR', desc:'Mano abierta junto a la mejilla, inclinando la cabeza sobre ella (almohada).'},
 {glyph:'',label:'BAÑO', desc:'Letra T agitada de lado a lado frente al cuerpo.'},
 {glyph:'',label:'HAMBRE', desc:'Mano en garra bajando por el centro del torso (estómago vacío).'},
 {glyph:'',label:'SED', desc:'Índice deslizándose por el frente de la garganta hacia abajo.'},
 {glyph:'AYUDA',label:'AYUDA', desc:'Puño con pulgar arriba sobre la palma abierta, ambas manos subiendo juntas.'},
 ]},
 {id:'L2.3', level:2, title:'Escuela y trabajo', video_ref:'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/educacion/', items:[
 {glyph:'A',label:'A',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/UIdCFNf_Udc',thumbnail:'https://img.youtube.com/vi/UIdCFNf_Udc/mqdefault.jpg'},
 {glyph:'B',label:'B',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/Ub3BVznewp8',thumbnail:'https://img.youtube.com/vi/Ub3BVznewp8/mqdefault.jpg'},
 {glyph:'BACHILLERATO/PREPARATORIA',label:'BACHILLERATO/PREPARATORIA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/l8JK-WWjlEY',thumbnail:'https://img.youtube.com/vi/l8JK-WWjlEY/mqdefault.jpg'},
 {glyph:'BIBLIOTECA',label:'BIBLIOTECA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/TBBh5m4uPfA',thumbnail:'https://img.youtube.com/vi/TBBh5m4uPfA/mqdefault.jpg'},
 {glyph:'BORRADOR',label:'BORRADOR',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/7rcqjaFGZG0',thumbnail:'https://img.youtube.com/vi/7rcqjaFGZG0/mqdefault.jpg'},
 {glyph:'C',label:'C',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/wxmyvk8yjsQ',thumbnail:'https://img.youtube.com/vi/wxmyvk8yjsQ/mqdefault.jpg'},
 {glyph:'CAFETERÍA',label:'CAFETERÍA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/rAGqNgkzcOo',thumbnail:'https://img.youtube.com/vi/rAGqNgkzcOo/mqdefault.jpg'},
 {glyph:'CLASE',label:'CLASE',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/x67IJU69Fog',thumbnail:'https://img.youtube.com/vi/x67IJU69Fog/mqdefault.jpg'},
 {glyph:'CONFERENCIA',label:'CONFERENCIA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/yz9qXXgrh7E',thumbnail:'https://img.youtube.com/vi/yz9qXXgrh7E/mqdefault.jpg'},
 {glyph:'CUADERNO',label:'CUADERNO',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/RQGUB96tU7k',thumbnail:'https://img.youtube.com/vi/RQGUB96tU7k/mqdefault.jpg'},
 {glyph:'D',label:'D',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/w9d8xuTit9k',thumbnail:'https://img.youtube.com/vi/w9d8xuTit9k/mqdefault.jpg'},
 {glyph:'DACTILOLOGÍA (ALFABETO)',label:'DACTILOLOGÍA (ALFABETO)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/fY81OuLYqQg',thumbnail:'https://img.youtube.com/vi/fY81OuLYqQg/mqdefault.jpg'}
 ]},
 {id:'L2.4', level:2, title:'Salud y emergencias', video_ref:'https://lsm.indiscapacidad.cdmx.gob.mx/ejes/salud/', items:[
 {glyph:'ADICCIÓN',label:'ADICCIÓN',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/tl1donTkFG0',thumbnail:'https://img.youtube.com/vi/tl1donTkFG0/mqdefault.jpg'},
 {glyph:'AGRURAS',label:'AGRURAS',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/O0iwDwiq8o4',thumbnail:'https://img.youtube.com/vi/O0iwDwiq8o4/mqdefault.jpg'},
 {glyph:'ALCOHOL (1)',label:'ALCOHOL (1)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/7rcFH43ct-M',thumbnail:'https://img.youtube.com/vi/7rcFH43ct-M/mqdefault.jpg'},
 {glyph:'ALCOHOL (2)',label:'ALCOHOL (2)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/1wlqRnSSnXk',thumbnail:'https://img.youtube.com/vi/1wlqRnSSnXk/mqdefault.jpg'},
 {glyph:'ALERGIA',label:'ALERGIA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/i3Xcbwg4dls',thumbnail:'https://img.youtube.com/vi/i3Xcbwg4dls/mqdefault.jpg'},
 {glyph:'AMBULANCIA',label:'AMBULANCIA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/x6HdMcLyWtY',thumbnail:'https://img.youtube.com/vi/x6HdMcLyWtY/mqdefault.jpg'},
 {glyph:'ANESTESIA (1)',label:'ANESTESIA (1)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/CzuPy9uDgjA',thumbnail:'https://img.youtube.com/vi/CzuPy9uDgjA/mqdefault.jpg'},
 {glyph:'ANESTESIA (2)',label:'ANESTESIA (2)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/9k-oV6Qsyy0',thumbnail:'https://img.youtube.com/vi/9k-oV6Qsyy0/mqdefault.jpg'},
 {glyph:'ARDOR',label:'ARDOR',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/wSCVl4qhej4',thumbnail:'https://img.youtube.com/vi/wSCVl4qhej4/mqdefault.jpg'},
 {glyph:'ARTRITIS',label:'ARTRITIS',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/Nfo5FPcTwFc',thumbnail:'https://img.youtube.com/vi/Nfo5FPcTwFc/mqdefault.jpg'},
 {glyph:'ASCO (NÁUSEAS)',label:'ASCO (NÁUSEAS)',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/E9a92aqS8GU',thumbnail:'https://img.youtube.com/vi/E9a92aqS8GU/mqdefault.jpg'},
 {glyph:'ASMA',label:'ASMA',desc:'Seña del Glosario LSM CDMX',video_ref:'https://www.youtube.com/embed/OjHwtylg3u4',thumbnail:'https://img.youtube.com/vi/OjHwtylg3u4/mqdefault.jpg'}
 ]},
 {id:'L2.5', level:2, title:'Conversación básica', items:[
 {glyph:'SI',label:'SÍ', desc:'Puño cerrado asintiendo desde la muñeca (como cabeza diciendo sí).'},
 {glyph:'NO',label:'NO', desc:'Índice y medio (en V) cerrando contra el pulgar dos veces rápido.'},
 {glyph:'',label:'CÓMO', desc:'Ambas manos en puño, dorsos arriba, girando hacia afuera simultáneamente + cejas arriba.'},
 {glyph:'',label:'QUÉ', desc:'Manos abiertas con palmas arriba, agitando suavemente + cejas arriba.'},
 {glyph:'',label:'DÓNDE', desc:'Índice extendido agitándose de lado a lado + expresión interrogativa (cejas arriba).'},
 {glyph:'⏰',label:'CUÁNDO', desc:'Índice dibujando círculo alrededor del otro índice levantado + cejas arriba.'},
 {glyph:'',label:'QUIÉN', desc:'Índice frente al mentón girando pequeños círculos + cejas arriba.'},
 {glyph:'',label:'POR QUÉ', desc:'Mano en Y tocándose la sien, agitando suave + expresión interrogativa.'},
 ]},

 // ============== NIVEL 3 — Comunicación fluida ==============
 {id:'L3.1', level:3, title:'Vocabulario del guante', items:[
 {glyph:'',label:'BUENAS', desc:'Mano abierta junto a la sien moviéndose hacia adelante.'},
 {glyph:'',label:'TARDES', desc:'Antebrazo horizontal, mano abierta bajando lentamente.'},
 {glyph:'',label:'GRACIAS', desc:'Mano abierta desde la barbilla extendiéndose hacia adelante.'},
 {glyph:'',label:'TE QUIERO', desc:'Mano en forma de Y (pulgar, índice y meñique extendidos) hacia el frente.'},
 {glyph:'',label:'AHORA SÍ', desc:'Manos planas bajando juntas con énfasis afirmativo.'},
 {glyph:'',label:'NEGOCIO A GOBIERNO',desc:'Mano en B golpeando palma + mano en G hacia arriba.'},
 {glyph:'',label:'OYENTES NO ENTIENDEN',desc:'Índices señalando oídos y luego cruce de manos negando.'},
 {glyph:'',label:'COMPÁRTEME TU SACAPUNTAS',desc:'Mano en S girando + manos abiertas como pidiendo.'},
 ]},
 {id:'L3.2', level:3, title:'Frases completas', items:[
 {glyph:'',label:'HOLA, ¿CÓMO ESTÁS?', desc:'Saludo + signo de CÓMO + apuntando al interlocutor.'},
 {glyph:'',label:'ESTOY BIEN, GRACIAS', desc:'Apuntar al pecho + signo BIEN + GRACIAS.'},
 {glyph:'',label:'¿CÓMO TE LLAMAS?', desc:'CÓMO + LLAMARSE + apuntando al interlocutor.'},
 {glyph:'',label:'ME LLAMO ___', desc:'Apuntar al pecho + LLAMARSE + deletrear nombre.'},
 {glyph:'',label:'MUCHO GUSTO', desc:'Manos chocando juntas + signo de GUSTO en el pecho.'},
 {glyph:'',label:'HASTA LUEGO', desc:'Mano abierta agitándose lateralmente con sonrisa.'},
 ]},
 {id:'L3.3', level:3, title:'Gramática LSM', items:[
 {glyph:'⏳',label:'TIEMPO (pasado)', desc:'Mano abierta moviéndose hacia atrás sobre el hombro.'},
 {glyph:'',label:'TIEMPO (presente)', desc:'Manos planas presionando hacia abajo frente al pecho.'},
 {glyph:'⏩',label:'TIEMPO (futuro)', desc:'Mano abierta moviéndose hacia adelante desde el hombro.'},
 {glyph:'',label:'PREGUNTA', desc:'Cejas levantadas + signo + mantener última seña.'},
 {glyph:'',label:'NEGACIÓN', desc:'Sacudir la cabeza + signo NO al final de la frase.'},
 {glyph:'',label:'CONDICIONAL (SI)', desc:'Signo SI con índice levantado, cejas hacia arriba.'},
 ]},
 {id:'L3.4', level:3, title:'Expresiones faciales', items:[
 {glyph:'',label:'AFIRMACIÓN', desc:'Cejas neutras, asentir suavemente durante el signo.'},
 {glyph:'',label:'INTERROGACIÓN', desc:'Cejas arriba, leve inclinación hacia adelante.'},
 {glyph:'',label:'NEGACIÓN/ENOJO', desc:'Cejas fruncidas, sacudir la cabeza.'},
 {glyph:'',label:'SORPRESA', desc:'Boca abierta, ojos amplios, cejas muy altas.'},
 {glyph:'',label:'IRONÍA/SARCASMO',desc:'Boca ladeada, ojos entrecerrados.'},
 {glyph:'',label:'NEUTRAL', desc:'Rostro relajado, contacto visual directo.'},
 ]},
 {id:'L3.5', level:3, title:'Práctica conversacional', items:[
 {glyph:'',label:'¿QUIERES UN CAFÉ?', desc:'QUERER + apuntando interlocutor + CAFÉ + cejas arriba.'},
 {glyph:'',label:'TENGO HAMBRE', desc:'YO + TENER + HAMBRE.'},
 {glyph:'',label:'HOY LLUEVE', desc:'HOY + LLOVER (manos en garra cayendo).'},
 {glyph:'',label:'¿QUÉ DÍA ES HOY?', desc:'QUÉ + DÍA + HOY + cejas arriba.'},
 {glyph:'',label:'VAMOS AL PARQUE', desc:'NOSOTROS + IR + PARQUE.'},
 {glyph:'',label:'LLÁMAME LUEGO', desc:'TELÉFONO + YO + LUEGO/FUTURO.'},
 ]},

 // ============== NIVEL 4 — Avanzado + Certificación ==============
 {id:'L4.1', level:4, title:'Conversaciones completas', items:[
 {glyph:'',label:'PRESENTARSE', desc:'HOLA + ME LLAMO ___ + MUCHO GUSTO.'},
 {glyph:'',label:'HABLAR DE TU CASA', desc:'YO + VIVIR + CASA + descripción (grande/pequeña).'},
 {glyph:'',label:'PRESENTAR A TU FAMILIA',desc:'Señalar + FAMILIA + roles (mamá, papá, hermano).'},
 {glyph:'',label:'HABLAR DE TU TRABAJO',desc:'YO + TRABAJAR + lugar + descripción.'},
 {glyph:'',label:'PEDIR EN UN RESTAURANTE',desc:'YO + QUERER + plato + POR FAVOR.'},
 {glyph:'',label:'PEDIR DIRECCIONES', desc:'DÓNDE + lugar + cejas arriba + esperar respuesta.'},
 ]},
 {id:'L4.2', level:4, title:'Simulacros oficiales', items:[
 {glyph:'',label:'EXAMEN ESCRITO', desc:'Práctica de comprensión lectora con vocabulario LSM.'},
 {glyph:'',label:'EXAMEN VIDEO', desc:'Grabarte signando una conversación de 2 minutos.'},
 {glyph:'',label:'EXAMEN PRESENCIAL', desc:'Diálogo con evaluador certificado CONOCER-SEP.'},
 {glyph:'',label:'PRECISIÓN GESTUAL', desc:'Ejecutar 20 signos consecutivos con ≥90% precisión.'},
 {glyph:'',label:'FLUIDEZ', desc:'Mantener una conversación de 5 min sin pausas largas.'},
 {glyph:'',label:'EVALUACIÓN INTEGRAL',desc:'Combinación de los 5 exámenes anteriores.'},
 ]},
 {id:'L4.3', level:4, title:'Práctica con intérpretes', items:[
 {glyph:'',label:'COMPRENSIÓN AUDITIVA-VISUAL', desc:'Ver video de intérprete y traducir a español escrito.'},
 {glyph:'',label:'INTERPRETACIÓN EN VIVO', desc:'Sesión 1-a-1 con intérprete voluntario (15 min).'},
 {glyph:'',label:'INTERPRETACIÓN DE EVENTOS', desc:'Practicar interpretación de discurso pre-grabado.'},
 {glyph:'',label:'EXPRESIÓN CORPORAL AVANZADA', desc:'Trabajar rostro + cuerpo + manos simultáneamente.'},
 {glyph:'',label:'MEMORIA DE CORTO PLAZO', desc:'Repetir secuencias de 8+ signos al primer intento.'},
 {glyph:'',label:'NETWORKING CON COMUNIDAD', desc:'Asistir a evento sordo y mantener 3 conversaciones.'},
 ]},
 {id:'L4.4', level:4, title:'Certificado QR verificable', items:[
 {glyph:'',label:'REQUISITOS', desc:'Completar niveles 1-3 + aprobar simulacros del 4.'},
 {glyph:'🆔',label:'IDENTIFICACIÓN', desc:'INE/IFE + comprobante de domicilio vigentes.'},
 {glyph:'',label:'PAGO DEL EXAMEN', desc:'Cuota CONOCER-SEP (descuento para usuarios Señas a Voces).'},
 {glyph:'',label:'FECHA DE EVALUACIÓN', desc:'Agendar con evaluador acreditado (presencial o remoto).'},
 {glyph:'',label:'CERTIFICADO DIGITAL', desc:'PDF + QR verificable en línea válido por 4 años.'},
 {glyph:'',label:'RECERTIFICACIÓN', desc:'Cada 4 años con examen de actualización (50% de costo).'},
 ]},
 {id:'L4.5', level:4, title:'Bolsa de empleo inclusivo', items:[
 {glyph:'',label:'CV BILINGÜE', desc:'Crear CV destacando certificación LSM + español.'},
 {glyph:'',label:'ENTREVISTA EN LSM', desc:'Práctica de entrevista con intérprete simulado.'},
 {glyph:'',label:'EMPRESAS ALIADAS', desc:'Catálogo de empresas con vacantes para certificados LSM.'},
 {glyph:'',label:'TABULADOR SALARIAL', desc:'Rangos de sueldo para intérpretes en México (2026).'},
 {glyph:'',label:'CONTRATO LABORAL', desc:'Plantilla de contrato con cláusulas de accesibilidad.'},
 {glyph:'',label:'EMPRENDIMIENTO LSM', desc:'Cómo crear tu propio negocio de servicios LSM.'},
 ]}
];

// Fusionar lecciones generadas desde el glosario CDMX (348 señas con DTW)
if (typeof GLOSARIO_LESSONS !== 'undefined' && Array.isArray(GLOSARIO_LESSONS)) {
 GLOSARIO_LESSONS.forEach(gl => {
 const idx = LESSONS.findIndex(l => l.id === gl.id);
 if (idx >= 0) LESSONS[idx] = gl; // reemplaza si el id ya existía
 else LESSONS.push(gl); // agrega al final
 });
}

// Niveles 2–4 (vista resumida)
const _countLevel = (lvl) => LESSONS.filter(l => l.level === lvl).length;
const LEVEL_META = {
 1:{title:'Fundamentos', tag:'l1', count:_countLevel(1), locked:false},
 2:{title:'Comunicación diaria', tag:'l2', count:_countLevel(2), locked:true},
 3:{title:'Comunicación fluida', tag:'l3', count:_countLevel(3), locked:true},
 4:{title:'Avanzado + Certificación', tag:'l4', count:_countLevel(4), locked:true},
};

// Estados de México (para registro)
const MX_STATES = [
 'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua',
 'CDMX','Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero','Hidalgo',
 'Jalisco','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro',
 'Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala',
 'Veracruz','Yucatán','Zacatecas'
];

// Equipo (placeholders editables)
const TEAM = [
 {name:'César', role:'Fundador - Hardware', initials:'C'},
 {name:'César', role:'Co-fundador - Estrategia', initials:'C'},
 {name:'Emiliano', role:'IA / Visión por computadora', initials:'E'},
 {name:'Mario', role:'Pedagogía LSM - Comunidad', initials:'M'},
];

// Timeline
const TIMELINE = [
 {year:'2026', done:true, title:'Lanzamiento Academy + piloto DIF Sonora',
 desc:'5 sistemas de guantes desplegados en Hermosillo. Plataforma web abierta al público.'},
 {year:'2027', done:false, title:'Expansión a 5 estados',
 desc:'Convenios con DIF de Jalisco, CDMX, Oaxaca, Estado de México y Nuevo León.'},
 {year:'2028', done:false, title:'App móvil + visión computacional',
 desc:'LSM Teacher Mobile (iOS/Android) offline. Reconocimiento sin hardware.'},
 {year:'2030', done:false, title:'Red global hispanohablante',
 desc:'500 sistemas desplegados. 50,000 personas capacitadas. Certificación oficial CONOCER-SEP en línea.'}
];

// Roadmap
const ROADMAP = [
 {tag:'live', title:'LSM Teacher Web', desc:'Enseñanza de lengua de señas con cámara.', when:'EN VIVO'},
 {tag:'live', title:'Guante Señas a Voces', desc:'Traducción LSM a voz en tiempo real.', when:'EN VIVO'},
 {tag:'soon', title:'LSM para Autismo', desc:'Comunicación alternativa aumentativa (CAA).', when:'MUY PRONTO'},
 {tag:'soon', title:'Prótesis Inteligente', desc:'Control por señas y feedback háptico.', when:'2027'},
 {tag:'soon', title:'LSM Teacher Mobile', desc:'App nativa iOS/Android, offline.', when:'2027'},
 {tag:'future', title:'Plataforma Multilingüe', desc:'ASL, BSL, LSE y más lenguas de señas.', when:'2028'},
 {tag:'future', title:'CAA Suite', desc:'Parálisis cerebral, afasia, daño cerebral.', when:'2028'},
 {tag:'future', title:'Certificación Online', desc:'Examen CONOCER-SEP digital.', when:'2029'},
 {tag:'future', title:'Red Global', desc:'Comunidades sordas hispanohablantes conectadas.', when:'2030'},
];

// Sin mock data. Todos los datos del dashboard vienen del backend real.

/* ============================================================
 2. STORAGE / ESTADO
 ============================================================ */
const STORAGE = {
 get(key, def){ try{ return JSON.parse(localStorage.getItem('sav_'+key)) ?? def; }catch{ return def; } },
 set(key, val){ try{ localStorage.setItem('sav_'+key, JSON.stringify(val)); }catch{} }
};

const state = {
 progress: STORAGE.get('progress', { completed:[], current:'L1.1' }),
 user: STORAGE.get('user', null),
 prefs: STORAGE.get('prefs', { theme:null, contrast:false, lang:'es' }),
 streak: STORAGE.get('streak', { days:0, last:null }),
 minutes: STORAGE.get('minutes', 0)
};

function saveAll(){
 STORAGE.set('progress', state.progress);
 STORAGE.set('user', state.user);
 STORAGE.set('prefs', state.prefs);
 STORAGE.set('streak', state.streak);
 STORAGE.set('minutes', state.minutes);
}

/* ============================================================
 3. UTILIDADES
 ============================================================ */
const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => Array.from(p.querySelectorAll(s));
const fmt = (n) => n.toLocaleString('es-MX');
function showToast(msg, type=''){
 const t = $('#toast'); t.textContent = msg; t.className = 'toast show '+type;
 setTimeout(()=>{ t.classList.remove('show'); }, 2800);
}

/* ============================================================
 4. RENDER: LECCIONES (niveles)
 ============================================================ */
function renderLevels(){
 const grid = $('#levelsGrid');
 const completedByLevel = (lvl) => state.progress.completed.filter(id => id.startsWith('L'+lvl+'.')).length;

 grid.innerHTML = [1,2,3,4].map(lvl => {
 const meta = LEVEL_META[lvl];
 const done = completedByLevel(lvl);
 const pct = Math.round(done/meta.count*100);
 const items = lvl===1
 ? LESSONS.map(l=>`<li>${l.title}</li>`).join('')
 : level2_4items(lvl);
 const btn = meta.locked && !state.user
 ? `<button class="btn btn-secondary full" data-start-level="${lvl}">Crear perfil y empezar</button>`
 : `<button class="btn btn-primary full" data-start-level="${lvl}">${done>0?'Continuar':'Empezar nivel '+lvl}</button>`;
 return `
 <article class="level-card" data-level="${lvl}" ${meta.locked && !state.user?'data-locked="true"':''}>
 <span class="level-tag ${meta.tag}">Nivel ${lvl} - ${meta.locked?'Perfil':'Libre'}</span>
 <h3>${meta.title}</h3>
 <p>${levelDesc(lvl)}</p>
 <ul>${items}</ul>
 <div class="level-progress"><span style="width:${pct}%"></span></div>
 <span class="level-progress-text">${done} / ${meta.count} lecciones - ${pct}%</span>
 <div style="margin-top:12px">${btn}</div>
 </article>`;
 }).join('');

 $$('[data-start-level]').forEach(b => b.addEventListener('click', () => {
 const lvl = +b.dataset.startLevel;
 if (LEVEL_META[lvl].locked && !state.user) {
 document.querySelector('#registro').scrollIntoView({behavior:'smooth'});
 showToast('Crea tu perfil gratuito para acceder al nivel '+lvl,'');
 return;
 }
 const lessonsOfLvl = LESSONS.filter(l => l.level === lvl);
 if (!lessonsOfLvl.length){ showToast('Nivel '+lvl+' aún no tiene lecciones.','error'); return; }
 const firstPending = lessonsOfLvl.find(l => !state.progress.completed.includes(l.id))
 || lessonsOfLvl[0];
 startLesson(firstPending);
 }));
}

function levelDesc(lvl){
 return ({
 1:'Las bases para empezar a comunicarte. Sin registro requerido.',
 2:'Lo que necesitas para conversar en el día a día.',
 3:'70+ señas del vocabulario del guante Señas a Voces.',
 4:'Preparación para examen CONOCER-SEP + certificado digital.'
 })[lvl];
}

function level2_4items(lvl){
 return LESSONS
 .filter(l => l.level === lvl)
 .map(l => `<li>${l.icon} ${l.title}</li>`)
 .join('');
}

/* ============================================================
 5. LECCIÓN ACTIVA (Modal con Quiz)
 ============================================================ */
const lessonModal = $('#lessonModal');
let activeLesson = null, lessonIdx = 0;

function startLesson(lesson){
 activeLesson = lesson; lessonIdx = 0;
 const hasVideos = lesson.video_ref || lesson.items.some(it => it.video_ref);

 if (hasVideos) {
 // Lección con videos del glosario CDMX -> abrir modal con flujo video+participación
 $('#lessonTitle').textContent = (lesson.icon || '') + ' ' + lesson.title;
 lessonModal.classList.add('open');
 document.body.style.overflow = 'hidden';
 renderLessonStep();
 } else {
 // Lección de abecedario -> flujo de cámara tradicional
 targets.length = 0;
 lesson.items.forEach(it => targets.push({ glyph: it.glyph, desc: it.desc, label: it.label }));
 camIdx = 0; _resetHold(); _needRelease = false;
 $('#targetGlyph').textContent = targets[0].glyph;
 $('#targetLabel').textContent = (targets[0].label || ('Letra ' + targets[0].glyph)) + ' - ' + targets[0].desc;
 const camSection = document.querySelector('.camera-section') || $('#cameraStage');
 if (camSection) camSection.scrollIntoView({behavior:'smooth', block:'center'});
 if (!camStream) startCamera();
 showToast('Lección: ' + (lesson.icon||'') + ' ' + lesson.title + ' - haz cada seña frente a la cámara','success');
 }
}
function closeLesson(){
 lessonModal.classList.remove('open');
 document.body.style.overflow = '';
 stopPracticeCam();
 $('#refVideo').src = '';
}

// === Cámara de práctica dentro del modal (split view) ===
let practiceCamStream = null;
async function startPracticeCam(){
 const vid = $('#practiceCam');
 const btn = $('#togglePracticeCam');
 if (practiceCamStream) return;
 try {
 practiceCamStream = await navigator.mediaDevices.getUserMedia({
 video: { width: 640, height: 480, facingMode: 'user' },
 audio: false
 });
 vid.srcObject = practiceCamStream;
 await vid.play();
 if (btn) btn.textContent = 'Pausar';
 } catch (err) {
 console.warn('[practiceCam]', err);
 showToast('No se pudo acceder a la cámara: ' + err.message, 'error');
 }
}
function stopPracticeCam(){
 if (practiceCamStream) {
 practiceCamStream.getTracks().forEach(t => t.stop());
 practiceCamStream = null;
 }
 const vid = $('#practiceCam');
 if (vid) vid.srcObject = null;
 // practiceStatus ya no existe en el HTML fijo — está en el innerHTML dinámico
 const btn = $('#togglePracticeCam');
 if (btn) btn.textContent = 'Iniciar cámara';
 const recBtn = document.getElementById('recordPracticeBtn');
 if (recBtn) recBtn.disabled = true;
 stopPracticeLoop();
 const scoreEl = $('#practiceScore');
 if (scoreEl) { scoreEl.textContent = ''; scoreEl.className = 'practice-score'; }
}

// Graba 3 segundos de la cámara y sube el video al backend para entrenamiento
async function recordPractice(durationMs = 3000){
 if (!practiceCamStream) {
 showToast('Inicia la cámara primero','error');
 return;
 }
 if (!activeLesson || !activeLesson.items[lessonIdx]) return;
 const item = activeLesson.items[lessonIdx];
 const recBtn = document.getElementById('recordPracticeBtn');
 const status = { textContent: '' }; // practiceStatus eliminado del HTML fijo

 // Detectar mimetype soportado
 const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
 const mimeType = mimes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

 let recorder;
 try {
 recorder = new MediaRecorder(practiceCamStream, { mimeType });
 } catch (e) {
 showToast('Tu navegador no soporta MediaRecorder','error');
 return;
 }
 const chunks = [];
 recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

 recBtn.disabled = true;
 recBtn.textContent = 'Grabando…';
 status.textContent = 'Grabando…';

 recorder.start();
 // Cuenta atrás visual
 let remaining = Math.ceil(durationMs / 1000);
 const tick = setInterval(() => {
 remaining--;
 recBtn.textContent = remaining > 0 ? `${remaining}s…` : 'Subiendo…';
 }, 1000);

 setTimeout(() => {
 recorder.stop();
 clearInterval(tick);
 }, durationMs);

 recorder.onstop = async () => {
 const blob = new Blob(chunks, { type: mimeType });
 const fd = new FormData();
 fd.append('video', blob, `${item.label}.webm`);
 fd.append('label', item.label);
 fd.append('categoria', activeLesson.id || 'misc');

 status.textContent = 'Subiendo…';
 try {
 const r = await fetch(LSM_BACKEND + '/api/training/upload', { method: 'POST', body: fd });
 const j = await r.json();
 if (j.ok) {
 showToast(`Plantilla guardada: ${j.label}`, 'success');
 status.textContent = 'Guardada · En vivo';
 } else {
 showToast('Error al subir: ' + (j.error||'desconocido'), 'error');
 status.textContent = 'En vivo';
 }
 } catch (err) {
 showToast('Backend offline: video no subido', 'error');
 status.textContent = 'En vivo';
 }
 recBtn.disabled = false;
 recBtn.textContent = 'Grabar (3s)';
 };
}
function renderLessonStep(){
 const item = activeLesson.items[lessonIdx];
 const videoUrl = item.video_ref || activeLesson.video_ref || null;
 const hasVideo = !!videoUrl;

 // --- Glyph: thumbnail si hay video, texto si no ---
 const glyphEl = $('#lessonGlyph');
 if (hasVideo && item.thumbnail) {
 glyphEl.innerHTML = `<img src="${item.thumbnail}" alt="${item.label}" style="width:100%;max-width:220px;border-radius:12px;display:block;margin:0 auto">`;
 } else {
 glyphEl.textContent = item.glyph;
 }
 $('#lessonDesc').textContent = item.desc || '';
 $('#lessonInstruction').textContent = `Seña ${lessonIdx+1} de ${activeLesson.items.length}: ${item.label}`;
 $('#lessonProg').style.width = ((lessonIdx)/activeLesson.items.length*100)+'%';

 // --- Video: resetear iframe ---
 const refWrap = $('#refVideoWrap');
 const refBtn = $('#refVideoBtn');
 $('#refVideo').src = '';
 refWrap.style.display = 'none';

 if (hasVideo) {
 // Vista split: video CDMX + cámara del estudiante lado a lado
 $('#lessonStage').style.display = 'none';
 $('#lessonSplit').style.display = 'grid';
 // Construir embed nocookie + overlay con thumbnail (siempre disponible)
 const ytId = (videoUrl.match(/\/embed\/([^?&/]+)/) || [])[1] || '';
 const iframe = $('#refVideo');
 const container = iframe.parentElement; // .ref-video-container
 // Limpiar overlays previos
 container.querySelectorAll('.ref-video-overlay,.ref-video-open-btn').forEach(n => n.remove());

 let embedUrl = videoUrl;
 if (ytId) {
 embedUrl = `https://www.youtube-nocookie.com/embed/${ytId}` +
   `?autoplay=1&mute=1&loop=1&playlist=${ytId}` +
   `&controls=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3`;
 }
 iframe.src = embedUrl;

 // Overlay clickeable con thumbnail (visible 2.5s, luego se oculta dejando el iframe)
 // Si el video del Glosario CDMX está restringido, este overlay queda hasta que el usuario clickee
 if (ytId) {
 const overlay = document.createElement('div');
 overlay.className = 'ref-video-overlay';
 overlay.innerHTML = `
   <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" alt="Vista previa">
   <button type="button" class="ref-video-play" aria-label="Ver en YouTube">
     <svg viewBox="0 0 68 48" width="56" height="40" aria-hidden="true">
       <path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#f00"/>
       <path d="M45 24 27 14v20" fill="#fff"/>
     </svg>
     <span>Ver video en YouTube</span>
   </button>`;
 overlay.addEventListener('click', () => {
   window.open(`https://www.youtube.com/watch?v=${ytId}`, '_blank', 'noopener');
 });
 container.appendChild(overlay);

 // Pequeño botón siempre visible (esquina) para abrir en YouTube
 const openBtn = document.createElement('a');
 openBtn.className = 'ref-video-open-btn';
 openBtn.href = `https://www.youtube.com/watch?v=${ytId}`;
 openBtn.target = '_blank';
 openBtn.rel = 'noopener';
 openBtn.textContent = 'YouTube';
 openBtn.title = 'Abrir video en YouTube';
 container.appendChild(openBtn);

 // Auto-ocultar el overlay tras 2.5s para dejar ver el iframe si carga
 setTimeout(() => { overlay.classList.add('faded'); }, 2500);
 }

 // Iniciar cámara y loop de reconocimiento
 startPracticeCam();
 setTimeout(() => startPracticeLoop(), 300);

 // UI debajo del split: instrucciones + barra de progreso + score
 $('#quizOptions').innerHTML = `
 <div class="pf-wrap">
 <div class="pf-instruction">
 <span class="pf-sign-name">${item.label}</span>
 <span class="pf-sign-desc">${item.desc || ''}</span>
 </div>
 <div class="pf-bar-row">
 <span class="pf-score-badge" id="pfScore">—</span>
 <div class="pf-hold-track"><div class="pf-hold-fill" id="pfHoldBar"></div></div>
 <span class="pf-hint" id="pfHint">Imita la seña del video...</span>
 </div>
 <button class="btn btn-ghost pf-skip" id="pfSkip">Saltar</button>
 </div>`;
 document.getElementById('pfSkip').addEventListener('click', () => {
 stopPracticeLoop();
 showToast('Seña saltada', '');
 setTimeout(nextLessonStep, 200);
 });
 } else {
 // Sin video -> quiz clásico de texto
 $('#lessonStage').style.display = '';
 $('#lessonSplit').style.display = 'none';
 stopPracticeCam();
 const correct = item.label;
 const pool = activeLesson.items.map(i=>i.label).filter(l=>l!==correct);
 const shuffled = pool.sort(()=>Math.random()-.5).slice(0,3);
 const options = [correct, ...shuffled].sort(()=>Math.random()-.5);
 $('#quizOptions').innerHTML = options.map(o => `<button class="quiz-option" data-val="${o}">${o}</button>`).join('');
 $$('.quiz-option').forEach(btn => btn.addEventListener('click', () => {
 if (btn.dataset.val === correct){
 btn.classList.add('correct');
 showToast('¡Correcto! OK','success');
 setTimeout(nextLessonStep, 700);
 } else {
 btn.classList.add('wrong');
 $$('.quiz-option').forEach(b => { if (b.dataset.val===correct) b.classList.add('correct'); });
 showToast('Casi. La respuesta correcta es: '+correct,'error');
 setTimeout(nextLessonStep, 1600);
 }
 $$('.quiz-option').forEach(b => b.disabled = true);
 }));
 }
}
function nextLessonStep(){
 stopPracticeLoop();
 practiceHoldSec = 0;
 // Limpiar buffer DTW para que no contamine la siguiente seña
 if (backendOnline) {
 fetch(LSM_BACKEND + '/api/practice_reset', {
 method: 'POST',
 headers: {'Content-Type': 'application/json'},
 body: JSON.stringify({ user_id: state.user?.id || 'anon' })
 }).catch(() => {});
 }
 const scoreEl = $('#practiceScore');
 if (scoreEl) { scoreEl.textContent = ''; scoreEl.className = 'practice-score'; }
 lessonIdx++;
 if (lessonIdx >= activeLesson.items.length){
 // Completada
 const isNew = !state.progress.completed.includes(activeLesson.id);
 if (isNew) state.progress.completed.push(activeLesson.id);
 const durationSec = Math.ceil(activeLesson.items.length * 0.5) * 60;
 state.minutes += Math.ceil(activeLesson.items.length * 0.5);
 saveAll();
 renderLevels(); renderProfile();
 showToast(' ¡Lección completada!','success');
 closeLesson();
 // Registrar lección real en el backend (alimenta el feed y el dashboard)
 if (backendOnline && isNew){
 const userId = state.user?.id || 'anon';
 fetch(LSM_BACKEND + '/api/lesson/complete', {
 method: 'POST',
 headers: {'Content-Type':'application/json'},
 body: JSON.stringify({
 user_id: userId,
 lesson_id: activeLesson.id,
 duration_sec: durationSec,
 precision: 1.0,
 })
 }).then(() => {
 // Refrescar feed y stats con la nueva actividad real
 fetchDashboard();
 fetchFeed();
 }).catch(err => console.warn('[lesson/complete]', err));
 }
 return;
 }
 renderLessonStep();
}

$('#closeLesson').addEventListener('click', closeLesson);
$('#skipBtn').addEventListener('click', nextLessonStep);
$('#nextStepBtn').addEventListener('click', nextLessonStep);
// Toggle cámara de práctica dentro del modal
const _toggleCamBtn = document.getElementById('togglePracticeCam');
if (_toggleCamBtn) _toggleCamBtn.addEventListener('click', () => {
 if (practiceCamStream) stopPracticeCam();
 else startPracticeCam();
});
const _recBtn = document.getElementById('recordPracticeBtn');
if (_recBtn) _recBtn.addEventListener('click', () => recordPractice(3000));

// === Práctica con feedback visual (envía frames a /api/practice_frame) ===
let practiceLoopId = null;
let practiceHoldSec = 0;
const PRACTICE_TARGET_SCORE = 0.55; // umbral para considerar "bien hecho"
const PRACTICE_HOLD_REQUIRED = 1.2; // segundos con score alto para auto-avanzar
const PRACTICE_FRAME_MS = 90; // ~11 fps — tracking fluido

async function sendPracticeFrame(){
 if (!practiceCamStream || !activeLesson || !lessonModal.classList.contains('open')) return;
 const item = activeLesson.items[lessonIdx];
 if (!item) return;

 const video = document.getElementById('practiceCam');
 if (!video || video.readyState < 2) return;

 // Capturar frame — sin espejo (el backend necesita imagen normal)
 const cap = document.createElement('canvas');
 cap.width = 320; cap.height = 240;
 const capCtx = cap.getContext('2d');
 capCtx.drawImage(video, 0, 0, cap.width, cap.height);
 const frameB64 = cap.toDataURL('image/jpeg', 0.75).split(',')[1];

 try {
 const r = await fetch(LSM_BACKEND + '/api/practice_frame', {
 method: 'POST',
 headers: {'Content-Type': 'application/json'},
 body: JSON.stringify({ frame: 'data:image/jpeg;base64,' + frameB64, target: (item.glyph || item.label), user_id: state.user?.id || 'anon' })
 });
 if (!r.ok) return;
 const j = await r.json();
 if (!j.ok) return;

 const matched = j.score >= PRACTICE_TARGET_SCORE;
 const pct = Math.round((j.score || 0) * 100);

 // 1) Dibujar landmarks sobre el canvas de la cámara
 _drawPracticeLandmarks(j.hands_landmarks || [], matched);

 // 2) Score encima del video
 const liveScore = document.getElementById('practiceLiveScore');
 if (liveScore) {
 liveScore.style.display = 'block';
 liveScore.textContent = pct >= 70 ? ` ${pct}%` : pct >= 40 ? ` ${pct}%` : ` ${pct}%`;
 }

 // 3) Score badge + hint + barra en el panel de info
 const pfScore = document.getElementById('pfScore');
 const pfHint = document.getElementById('pfHint');
 const pfBar = document.getElementById('pfHoldBar');
 if (pfScore) pfScore.textContent = pct >= 70 ? ` ${pct}%` : pct >= 40 ? ` ${pct}%` : ` ${pct}%`;
 if (pfHint) pfHint.textContent = j.hint || (matched ? '¡Bien! Mantén la seña...' : 'Ajusta tu posición...');

 // 4) Barra de hold + auto-avance (incremento ~= frame_ms en segundos)
 const step = PRACTICE_FRAME_MS / 1000;
 if (matched) {
 practiceHoldSec = Math.min(practiceHoldSec + step, PRACTICE_HOLD_REQUIRED + 0.1);
 } else {
 practiceHoldSec = Math.max(0, practiceHoldSec - step * 0.5);
 }
 const holdPct = Math.min(100, (practiceHoldSec / PRACTICE_HOLD_REQUIRED) * 100);
 if (pfBar) pfBar.style.width = holdPct + '%';

 if (practiceHoldSec >= PRACTICE_HOLD_REQUIRED) {
 stopPracticeLoop();
 if (liveScore) liveScore.style.display = 'none';
 showToast('¡' + item.label + ' lograda!', 'success');
 setTimeout(nextLessonStep, 500);
 }
 } catch (_) { /* backend offline */ }
}

// Pinta las landmarks de TODAS las manos detectadas sobre el canvas de práctica
// Reutiliza el estilo oficial MediaPipe (mismos colores que el alfabeto).
function _drawPracticeLandmarks(handsArr, matched){
 const cnv = document.getElementById('practiceCanvas');
 const v = document.getElementById('practiceCam');
 if (!cnv || !v || !v.videoWidth) return;
 if (cnv.width !== v.videoWidth || cnv.height !== v.videoHeight){
 cnv.width = v.videoWidth;
 cnv.height = v.videoHeight;
 }
 const ctx = cnv.getContext('2d');
 ctx.clearRect(0, 0, cnv.width, cnv.height);
 if (!handsArr || !handsArr.length) return;

 const W = cnv.width, H = cnv.height;
 const sx = W * 0.005;

 // Pintar cada mano (puede haber 1 o 2)
 for (const lms of handsArr){
 if (!lms || !lms.length) continue;

 // Aristas
 ctx.lineCap = 'round';
 ctx.shadowColor = 'rgba(0,0,0,.55)';
 ctx.shadowBlur = 5;
 for (const fname in HAND_FINGERS){
 const f = HAND_FINGERS[fname];
 ctx.strokeStyle = matched ? '#16A34A' : f.color;
 ctx.lineWidth = Math.max(1.5, sx * f.width / 2);
 for (const [a,b] of f.edges){
 if (!lms[a] || !lms[b]) continue;
 ctx.beginPath();
 ctx.moveTo(lms[a].x * W, lms[a].y * H);
 ctx.lineTo(lms[b].x * W, lms[b].y * H);
 ctx.stroke();
 }
 }

 // Nodos
 ctx.shadowBlur = 0;
 for (let i = 0; i < lms.length; i++){
 const p = lms[i];
 let r;
 if (i === LM_WRIST) r = Math.max(5, sx * 1.6);
 else if (LM_TIPS.has(i)) r = Math.max(4, sx * 1.3);
 else r = Math.max(3, sx * 1.0);
 ctx.fillStyle = '#FFFFFF';
 ctx.strokeStyle = matched ? '#16A34A' : '#1E40AF';
 ctx.lineWidth = Math.max(1, sx * 0.6);
 ctx.beginPath();
 ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
 ctx.fill();
 ctx.stroke();
 }
 }

 // Marco verde cuando está bien hecha
 if (matched){
 ctx.strokeStyle = '#16A34A';
 ctx.lineWidth = Math.max(3, sx * 1.5);
 ctx.shadowColor = 'rgba(22,163,74,.6)';
 ctx.shadowBlur = 12;
 ctx.strokeRect(2, 2, W - 4, H - 4);
 ctx.shadowBlur = 0;
 }
}

function startPracticeLoop(){
 if (practiceLoopId) clearInterval(practiceLoopId);
 practiceHoldSec = 0;
 practiceLoopId = setInterval(sendPracticeFrame, PRACTICE_FRAME_MS);
}
function stopPracticeLoop(){
 if (practiceLoopId) { clearInterval(practiceLoopId); practiceLoopId = null; }
 practiceHoldSec = 0;
}

document.addEventListener('keydown', e => {
 if (e.key === 'Escape' && lessonModal.classList.contains('open')) closeLesson();
});

/* ============================================================
 6. PERFIL / SKILL TREE / BADGES
 ============================================================ */
function renderProfile(){
 $('#profileName').textContent = state.user?.name ? `Hola, ${state.user.name}` : 'Estudiante anónimo';
 $('#profileStreak').innerHTML = ` Racha: <strong>${state.streak.days} días</strong> - Tiempo: <strong>${state.minutes} min</strong>`;

 // Skill tree: nodos = lecciones nivel 1
 const tree = $('#skillTree');
 tree.innerHTML = LESSONS.map((l,i) => {
 const done = state.progress.completed.includes(l.id);
 const cur = !done && i === state.progress.completed.length;
 return `<div class="skill-node ${done?'done':''} ${cur?'current':''}" role="listitem" title="${l.title}" aria-label="${l.title}${done?' completada':''}">${l.icon}</div>`;
 }).join('');

 // Badges
 const earned = {
 first_sign: state.progress.completed.length >= 1,
 first_lesson:state.progress.completed.length >= 1,
 alphabet: state.progress.completed.includes('L1.1'),
 week: state.streak.days >= 7,
 level1: state.progress.completed.filter(id=>id.startsWith('L1.')).length === LESSONS.length,
 level2: false,
 level3: false,
 cert: false
 };
 $$('#badgesRow .badge').forEach(b => {
 if (earned[b.dataset.badge]) b.classList.add('earned');
 else b.classList.remove('earned');
 });
}

/* ============================================================
 7. DASHBOARD — DATOS REALES DEL BACKEND
 Regla de transparencia: NUNCA se inventan ni modifican datos.
 Si el backend no responde -> mostramos cero y un aviso honesto.
 ============================================================ */

// Último snapshot del dashboard (null = aún no cargado)
let _dashData = null;

// Convierte segundos a texto legible ("hace 3 min", "hace 2h")
function _agoText(sec){
 if (sec < 60) return `hace ${sec}s`;
 if (sec < 3600) return `hace ${Math.floor(sec/60)} min`;
 return `hace ${Math.floor(sec/3600)}h`;
}

// Muestra aviso de "datos no disponibles" en el dashboard
function _showOfflineBanner(){
 const feed = $('#liveFeed');
 if (!feed) return;
 if (feed.querySelector('.offline-note')) return;
 const li = document.createElement('li');
 li.className = 'offline-note';
 li.style.cssText = 'opacity:.7;font-style:italic;font-size:.85rem;';
 li.innerHTML = '<span class="avatar" style="background:#64748B">ℹ</span>' +
 '<div>El backend no está corriendo.<br>' +
 '<code style="font-size:.8rem">python lsm_teacher_web.py</code> para ver datos reales.</div>';
 feed.prepend(li);
}

async function fetchDashboard(){
 if (!backendOnline) { _showOfflineBanner(); return; }
 try{
 const r = await fetch(LSM_BACKEND + '/api/dashboard');
 if (!r.ok) return;
 const d = await r.json();
 if (!d.ok) return;
 _dashData = d;

 // Stats cards
 const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
 setTxt('stat-users', fmt(d.total_users));
 setTxt('stat-lessons', fmt(d.total_lessons));
 setTxt('dash-users', fmt(d.total_users));
 setTxt('dash-lessons', fmt(d.total_lessons));
 setTxt('dash-hours', fmt(d.total_hours));
 // Países: solo podemos estimar desde usuarios registrados con country ≠ MX
 // No lo inventamos: mostramos el número de países únicos del backend si existiera;
 // por ahora mostramos «—» hasta que el backend reporte un conteo real de países.
 setTxt('stat-countries', d.unique_countries ?? '—');
 setTxt('dash-countries', d.unique_countries ?? '—');

 // Top señas practicadas
 const topEl = $('#topSigns');
 if (topEl && d.top_letters && d.top_letters.length){
 topEl.innerHTML = d.top_letters.map(t =>
 `<li>${t.letter} <span class="cnt">${fmt(t.count)}</span></li>`
 ).join('');
 } else if (topEl){
 topEl.innerHTML = '<li style="opacity:.6">Aún no hay señas practicadas</li>';
 }

 // Actualizar mapa con conteos reales por estado
 if (d.state_counts) _updateMapCounts(d.state_counts);

 }catch(e){
 console.warn('[dashboard] fetch error:', e);
 }
}

async function fetchFeed(){
 if (!backendOnline){ _showOfflineBanner(); return; }
 try{
 const r = await fetch(LSM_BACKEND + '/api/feed?limit=15');
 if (!r.ok) return;
 const d = await r.json();
 if (!d.ok) return;

 const feed = $('#liveFeed');
 if (!feed) return;

 if (!d.events || d.events.length === 0){
 // Aún no hay actividad real registrada
 if (!feed.querySelector('.no-activity')){
 feed.innerHTML = '<li class="no-activity" style="opacity:.65;font-style:italic;font-size:.85rem;">' +
 '<span class="avatar" style="background:#64748B"></span>' +
 '<div>Sin actividad registrada aún.<br>Completa una lección para que aparezca aquí.</div></li>';
 }
 return;
 }

 // Construir feed solo con datos reales
 feed.innerHTML = d.events.map(ev => {
 const initial = (ev.name || '?').charAt(0).toUpperCase();
 const place = ev.state ? ` de <em>${ev.state}</em>` : '';
 const ago = _agoText(ev.ago_sec);
 return `<li>
 <span class="avatar" aria-hidden="true">${initial}</span>
 <div><strong>${ev.name}</strong>${place} ${ev.action} "${ev.lesson}" — ${ago}</div>
 </li>`;
 }).join('');
 }catch(e){
 console.warn('[feed] fetch error:', e);
 }
}

// Actualiza el mapa con conteos reales por estado (del backend)
function _updateMapCounts(stateCounts){
 const rects = $$('#mexicoStates rect');
 rects.forEach(rect => {
 const stateName = rect.dataset.state;
 const count = stateCounts[stateName] || 0;
 rect.dataset.students = String(count);
 // Recalcular nivel de actividad basado en conteos reales
 const max = Math.max(...Object.values(stateCounts), 1);
 const ratio = count / max;
 rect.dataset.activity = ratio > 0.6 ? '3' : ratio > 0.2 ? '2' : count > 0 ? '1' : '0';
 rect.setAttribute('aria-label',
 `${stateName}, ${count} estudiante${count !== 1 ? 's' : ''} registrado${count !== 1 ? 's' : ''}`);
 });
}

/* ============================================================
 8. MAPA DE MÉXICO (cartograma simplificado)
 ============================================================ */
function initMap(){
 const g = $('#mexicoStates');
 // Cartograma simplificado (no es topología real, pero da clara visualización)
 const states = [
 {n:'Baja California', x:40, y:20, w:90,h:70, a:2},
 {n:'Sonora', x:130,y:50, w:90,h:60, a:3},
 {n:'Chihuahua', x:220,y:40, w:80,h:60, a:2},
 {n:'Coahuila', x:300,y:40, w:80,h:55, a:1},
 {n:'Nuevo León', x:380,y:40, w:60,h:50, a:2},
 {n:'Tamaulipas', x:440,y:50, w:70,h:60, a:1},
 {n:'Baja California Sur', x:40, y:95, w:80,h:55, a:1},
 {n:'Sinaloa', x:130,y:115, w:85,h:55, a:2},
 {n:'Durango', x:220,y:105, w:75,h:55, a:1},
 {n:'Zacatecas', x:300,y:100, w:75,h:55, a:1},
 {n:'San Luis Potosí', x:380,y:95, w:60,h:55, a:1},
 {n:'Nayarit', x:130,y:175, w:80,h:55, a:1},
 {n:'Jalisco', x:215,y:170, w:80,h:55, a:3},
 {n:'Aguascalientes', x:300,y:160, w:60,h:55, a:1},
 {n:'Guanajuato', x:365,y:155, w:65,h:55, a:2},
 {n:'Querétaro', x:435,y:155, w:55,h:55, a:2},
 {n:'Hidalgo', x:490,y:115, w:60,h:55, a:2},
 {n:'Colima', x:215,y:230, w:80,h:55, a:1},
 {n:'Michoacán', x:300,y:220, w:65,h:55, a:2},
 {n:'Estado de México', x:370,y:215, w:60,h:55, a:3},
 {n:'CDMX', x:435,y:215, w:55,h:55, a:3},
 {n:'Tlaxcala', x:495,y:175, w:60,h:55, a:1},
 {n:'Puebla', x:495,y:235, w:60,h:55, a:2},
 {n:'Veracruz Norte', x:555,y:155, w:65,h:60, a:2},
 {n:'Veracruz Sur', x:555,y:220, w:65,h:60, a:2},
 {n:'Guerrero', x:300,y:280, w:65,h:55, a:1},
 {n:'Morelos', x:370,y:275, w:60,h:55, a:1},
 {n:'Oaxaca', x:435,y:275, w:60,h:55, a:2},
 {n:'Chiapas', x:500,y:295, w:65,h:60, a:2},
 {n:'Tabasco', x:625,y:155, w:70,h:60, a:1},
 {n:'Campeche', x:625,y:220, w:70,h:60, a:1},
 {n:'Yucatán', x:700,y:155, w:60,h:55, a:1},
 {n:'Quintana Roo', x:700,y:215, w:60,h:55, a:1},
 ];
 g.innerHTML = states.map(s =>
 `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" ry="6"
 data-state="${s.n}" data-activity="0"
 data-students="0"
 tabindex="0" role="button" aria-label="${s.n}, sin datos aún"></rect>`
 ).join('');

 const tip = $('#mapTip');
 function _showTip(el, x, y){
 const cnt = +el.dataset.students || 0;
 tip.textContent = cnt
 ? `${el.dataset.state} — ${fmt(cnt)} usuario${cnt !== 1 ? 's' : ''} registrado${cnt !== 1 ? 's' : ''}`
 : `${el.dataset.state} — Sin usuarios registrados aún`;
 tip.style.left = x + 'px';
 tip.style.top = y + 'px';
 tip.classList.add('show');
 }
 g.addEventListener('mousemove', e => {
 if (e.target.tagName !== 'rect') return;
 _showTip(e.target, e.clientX + 12, e.clientY + 12);
 });
 g.addEventListener('mouseleave', () => tip.classList.remove('show'));
 g.addEventListener('focusin', e => {
 if (e.target.tagName !== 'rect') return;
 const r = e.target.getBoundingClientRect();
 _showTip(e.target, r.left + r.width/2, r.top - 8);
 });
 g.addEventListener('focusout', () => tip.classList.remove('show'));
}

/* ============================================================
 9. EQUIPO / TIMELINE / ROADMAP
 ============================================================ */
function renderTeam(){
 $('#teamGrid').innerHTML = TEAM.map(t => `
 <div class="team-card">
 <div class="team-avatar" aria-hidden="true">${t.initials}</div>
 <h4>${t.name}</h4>
 <div class="role">${t.role}</div>
 </div>`).join('');
}
function renderTimeline(){
 $('#timeline').innerHTML = TIMELINE.map((t,i) => `
 <div class="tl-item ${t.done?'done':''}">
 <div class="tl-dot" aria-hidden="true">${i+1}</div>
 <div class="tl-year">${t.year}</div>
 <h4>${t.title}</h4>
 <p>${t.desc}</p>
 </div>`).join('');
}
function renderRoadmap(){
 $('#roadmapGrid').innerHTML = ROADMAP.map(r => `
 <article class="roadmap-card ${r.tag}">
 <div class="icon-block" aria-hidden="true">${r.icon}</div>
 <span class="status ${r.tag}">${r.when}</span>
 <h3>${r.title}</h3>
 <p>${r.desc}</p>
 </article>`).join('');
}

/* ============================================================
 10. CÁMARA (WebRTC + mock de reconocimiento)
 ============================================================ */
const targets = ALPHABET.map(([g,d])=>({glyph:g, desc:d, label:'Letra '+g}));
// `targets` se vacía/llena cuando arranca una lección; al terminar se restaura al alfabeto.
let camStream = null, camIdx = 0, accInterval = null, accuracy = 0;

// Backend del LSM Teacher Web (lsm_teacher_web.py). Cambia esta URL si
// tu backend corre en otro host/puerto, o déjala vacía para usar solo mock.
const LSM_BACKEND = (window.LSM_BACKEND || 'http://127.0.0.1:5050').replace(/\/$/,'');
let backendOnline = false;

async function pingBackend(){
 if (!LSM_BACKEND) return false;
 try{
 const ctrl = new AbortController();
 const t = setTimeout(()=>ctrl.abort(), 1500);
 const r = await fetch(LSM_BACKEND + '/api/health', { signal: ctrl.signal });
 clearTimeout(t);
 if (!r.ok) return false;
 const j = await r.json();
 backendOnline = j && j.ok;
 if (backendOnline) console.log('%cOK LSM Teacher backend conectado','color:#16A34A;font-weight:700', j);
 return backendOnline;
 }catch(e){
 backendOnline = false;
 console.log('%cℹ Backend LSM no disponible — usando modo mock','color:#94A3B8');
 return false;
 }
}

function setTargetByIdx(i){
 if (activeLesson && i >= targets.length){ _completeActiveLesson(); return; }
 camIdx = (i + targets.length) % targets.length;
 const t = targets[camIdx];
 $('#targetGlyph').textContent = t.glyph;
 $('#targetLabel').textContent = (t.label || ('Letra ' + t.glyph)) + ' - ' + t.desc;
}

function _completeActiveLesson(){
 if (!activeLesson) return;
 const lesson = activeLesson;
 const isNew = !state.progress.completed.includes(lesson.id);
 if (isNew) state.progress.completed.push(lesson.id);
 state.minutes += Math.ceil(lesson.items.length * 0.5);
 saveAll(); renderLevels(); renderProfile();
 showToast(' ¡Lección "' + lesson.title + '" completada!','success');
 if (backendOnline && isNew){
 const userId = state.user?.id || 'anon';
 fetch(LSM_BACKEND + '/api/lesson/complete', {
 method:'POST', headers:{'Content-Type':'application/json'},
 body: JSON.stringify({ user_id:userId, lesson_id:lesson.id,
 duration_sec: Math.ceil(lesson.items.length * 0.5) * 60, precision: 1.0 })
 }).then(()=>{ fetchDashboard(); fetchFeed(); })
 .catch(err=>console.warn('[lesson/complete]', err));
 }
 // Buscar la siguiente lección del mismo nivel
 const lvl = lesson.level;
 const lvlLessons = LESSONS.filter(l => l.level === lvl);
 const curIdx = lvlLessons.findIndex(l => l.id === lesson.id);
 const nextInLevel = lvlLessons[curIdx + 1];
 // Si no hay más en este nivel, buscar primera del siguiente
 const nextLevelLessons = LESSONS.filter(l => l.level === lvl + 1);
 const nextLesson = nextInLevel || (nextLevelLessons.length ? nextLevelLessons[0] : null);
 activeLesson = null;
 if (nextLesson){
 setTimeout(() => {
 showToast('Siguiente: ' + nextLesson.icon + ' ' + nextLesson.title, '');
 startLesson(nextLesson);
 }, 1500);
 } else {
 // Ya no hay más lecciones — restaurar alfabeto
 targets.length = 0;
 ALPHABET.forEach(([g,d]) => targets.push({glyph:g, desc:d, label:'Letra '+g}));
 camIdx = 0; _resetHold();
 $('#targetGlyph').textContent = targets[0].glyph;
 $('#targetLabel').textContent = 'Letra ' + targets[0].glyph + ' - ' + targets[0].desc;
 showToast(' ¡Felicidades! Completaste todas las lecciones disponibles.','success');
 }
}
async function startCamera(){
 if (camStream){ stopCamera(); return; }
 try{
 // Preferimos 1280x720 si la cámara lo soporta (mejor precisión para
 // MediaPipe Hands, igual que el desktop). Fallback automático a 640x480.
 camStream = await navigator.mediaDevices.getUserMedia({
 video: {
 width: { ideal: 1280 },
 height: { ideal: 720 },
 facingMode: 'user',
 frameRate: { ideal: 30 },
 },
 audio: false,
 });
 const v = $('#camVideo'); v.srcObject = camStream;
 $('#cameraStage').classList.add('live');
 $('#camStatus').classList.add('live');
 $('#camStatusText').textContent = 'En vivo (local)';
 $('#camStartBtn').innerHTML = '⏹ Detener cámara';
 // Si el backend real está online, lanzamos el loop continuo (mejor
 // rendimiento y muestra los landmarks de la mano). Si no, mock.
 startRealLoop();
 const motorMsg = backendOnline
 ? 'Cámara activada - Motor LSM Teacher real OK'
 : 'Cámara activada - Conectando al backend…';
 showToast(motorMsg, backendOnline ? 'success' : '');
 }catch(err){
 showToast('No pudimos abrir tu cámara. Usa el modo quiz.','error');
 console.warn('camera error:', err);
 }
}
function stopCamera(){
 if (camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream=null; }
 $('#cameraStage').classList.remove('live');
 $('#camStatus').classList.remove('live');
 $('#camStatusText').textContent = 'Cámara apagada';
 $('#camStartBtn').innerHTML = ' Activar cámara';
 $('#camDetect').classList.remove('correct');
 stopRealLoop();
 if (accInterval){ clearInterval(accInterval); accInterval=null; }
 accuracy = 0;
 $('#accBar').firstElementChild.style.width = '0%';
 $('#accVal').textContent = '0%';
 $('#camDetect').textContent = '—';
}
/* ------------------------------------------------------------
 RECONOCIMIENTO REAL contra lsm_teacher_web.py
 - Captura continua, pero solo enviamos cuando el último request
 terminó (evitar saturar al backend ni acumular lag).
 - Dibujamos las 21 landmarks de MediaPipe Hands sobre un canvas
 overlay para que se vea igual que el lsm_teacher.py original.
 ------------------------------------------------------------ */

// =============================================================
// MediaPipe Hands — conexiones agrupadas por dedo, con los MISMOS
// colores que el estilo oficial "mp_drawing_styles" usado por
// lsm_teacher.py (cv2.draw_landmarks).
// =============================================================
const HAND_FINGERS = Object.freeze({
 palm: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[0,1],[0,5],[5,9],[9,13],[13,17],[0,17]]) }),
 thumb: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[1,2],[2,3],[3,4]]) }),
 index: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[5,6],[6,7],[7,8]]) }),
 middle: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[9,10],[10,11],[11,12]]) }),
 ring: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[13,14],[14,15],[15,16]]) }),
 pinky: Object.freeze({ color: '#3B82F6', width: 3, edges: Object.freeze([[17,18],[18,19],[19,20]]) }),
});
// Color por landmark (rojo: yemas / blanco: nudillos / azul: muñeca)
const LM_TIPS = new Set([4, 8, 12, 16, 20]); // puntas de los dedos
const LM_WRIST = 0;

// Captura del frame actual del video a un canvas oculto (reutilizado).
// 640x480 (igual que la camara del desktop) para que MediaPipe en el
// servidor reciba la misma calidad que recibe lsm_teacher.py local.
const _captureCanvas = document.createElement('canvas');
_captureCanvas.width = 640;
_captureCanvas.height = 480;
const _captureCtx = _captureCanvas.getContext('2d');

function _drawLandmarks(lms, matched){
 // lms: arreglo de {x, y, z} normalizados (0..1) que devuelve el backend.
 const cnv = $('#camOverlayCanvas');
 const v = $('#camVideo');
 if (!cnv || !v.videoWidth) return;
 // Igualar resolución del canvas al video real para nitidez
 if (cnv.width !== v.videoWidth || cnv.height !== v.videoHeight){
 cnv.width = v.videoWidth;
 cnv.height = v.videoHeight;
 }
 const ctx = cnv.getContext('2d');
 ctx.clearRect(0, 0, cnv.width, cnv.height);
 if (!lms || !lms.length) return;

 const W = cnv.width, H = cnv.height;
 const sx = W * 0.005; // escala segun ancho

 // 1) Aristas — colores oficiales por dedo
 ctx.lineCap = 'round';
 ctx.shadowColor = 'rgba(0,0,0,.55)';
 ctx.shadowBlur = 5;
 for (const fname in HAND_FINGERS){
 const f = HAND_FINGERS[fname];
 ctx.strokeStyle = f.color;
 ctx.lineWidth = Math.max(1.5, sx * f.width / 2);
 for (const [a,b] of f.edges){
 if (!lms[a] || !lms[b]) continue;
 ctx.beginPath();
 ctx.moveTo(lms[a].x * W, lms[a].y * H);
 ctx.lineTo(lms[b].x * W, lms[b].y * H);
 ctx.stroke();
 }
 }

 // 2) Nodos — TODOS los vértices blancos con borde azul.
 ctx.shadowBlur = 0;
 for (let i = 0; i < lms.length; i++){
 const p = lms[i];
 let r;
 if (i === LM_WRIST) r = Math.max(5, sx * 1.6);
 else if (LM_TIPS.has(i)) r = Math.max(4, sx * 1.3);
 else r = Math.max(3, sx * 1.0);
 ctx.fillStyle = '#FFFFFF';
 ctx.strokeStyle = '#1E40AF';
 ctx.lineWidth = Math.max(1, sx * 0.6);
 ctx.beginPath();
 ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
 ctx.fill();
 ctx.stroke();
 }

 // 3) Anillo de "matched" — cuando la seña está correcta, marco verde
 if (matched){
 ctx.strokeStyle = '#16A34A';
 ctx.lineWidth = Math.max(3, sx * 1.5);
 ctx.shadowColor = 'rgba(22,163,74,.6)';
 ctx.shadowBlur = 12;
 ctx.strokeRect(2, 2, W - 4, H - 4);
 ctx.shadowBlur = 0;
 }
}

// =============================================================
// Loop de reconocimiento — Réplica EXACTA del bucle de
// lsm_teacher.py:
// • thresholds idénticos (los aplica el backend)
// • hold-to-advance: la pose debe sostenerse HOLD_SECONDS = 1.4s
// • need_release: tras avanzar, la mano debe salir de la pose
// • dibujo de landmarks con estilo oficial MediaPipe
// =============================================================
let _realLoopActive = false;
let _lastSentAt = 0;
const _MIN_INTERVAL = 40; // ~25 fps de envio al backend
const HOLD_SECONDS = 1.4; // mismo valor que lsm_teacher.py

// Estado del hold-to-advance (paridad con desktop)
let _holdStartTs = null;
let _needRelease = false; // true -> esperar a que salga de la pose

function _resetHold(){
 _holdStartTs = null;
 _updateHoldUI(0);
}

function _updateHoldUI(pct){
 // pct ∈ [0,1]. Pintamos la barra de "MANTEN xx%" sobre la barra de acc.
 const bar = $('#accBar');
 if (!bar) return;
 const inner = bar.firstElementChild;
 if (!inner) return;
 if (pct > 0){
 // mientras hay hold, la barra se pinta verde
 inner.style.background = 'linear-gradient(90deg,#16A34A,#22C55E)';
 inner.style.width = Math.round(pct * 100) + '%';
 bar.setAttribute('aria-valuenow', Math.round(pct * 100));
 const v = $('#accVal');
 if (v) v.textContent = 'MANTÉN ' + Math.round(pct * 100) + '%';
 } else {
 inner.style.background = '';
 }
}

async function realRecognizeLoop(){
 if (!_realLoopActive || !camStream) return;
 const now = performance.now();
 const wait = Math.max(0, _MIN_INTERVAL - (now - _lastSentAt));
 if (wait > 0) await new Promise(r => setTimeout(r, wait));
 _lastSentAt = performance.now();

 try{
 const v = $('#camVideo');
 if (!v.videoWidth){ requestAnimationFrame(realRecognizeLoop); return; }

 // Dibujar el frame al canvas oculto SIN espejar (CSS hace el espejo
 // visual; el modelo necesita el frame "real" para inferencia correcta).
 _captureCtx.save();
 _captureCtx.setTransform(1, 0, 0, 1, 0, 0);
 _captureCtx.drawImage(v, 0, 0, _captureCanvas.width, _captureCanvas.height);
 _captureCtx.restore();
 const frame = _captureCanvas.toDataURL('image/jpeg', 0.7);

 const target = targets[camIdx].glyph;
 const user_id = state.user?.id || 'anon_' + (state.prefs.lang || 'es');

 const res = await fetch(LSM_BACKEND + '/api/recognize', {
 method: 'POST',
 headers: {'Content-Type':'application/json'},
 body: JSON.stringify({ frame, target, user_id })
 });
 if (!res.ok) throw new Error('HTTP ' + res.status);
 const j = await res.json();

 // ---- 1) Letra detectada y confianza
 const conf = Math.round((j.confidence || 0) * 100);
 const detEl = $('#camDetect');
 if (j.sign){
 detEl.textContent = j.sign;
 detEl.classList.toggle('correct', !!j.matched);
 } else {
 detEl.textContent = '—';
 detEl.classList.remove('correct');
 }

 // ---- 2) Hold-to-advance (idéntico a lsm_teacher.py)
 // Letras = matching estricto del backend.
 // Palabras/frases = requiere mano visible con confianza razonable
 // (el hold de 1.4s asegura que no pasa accidentalmente).
 const targetGlyph = (targets[camIdx] && targets[camIdx].glyph) || '';
 const isLetter = /^[A-ZÑ]$/.test(targetGlyph);
 const handVisible = Array.isArray(j.landmarks) && j.landmarks.length >= 21;
 const rawConf = j.confidence || 0;
 const isMatch = isLetter ? !!j.matched : (handVisible && rawConf >= 0.50);
 const tNow = performance.now() / 1000; // segundos

 if (_needRelease){
 // Tras avanzar, exigimos que la mano deje de hacer la pose
 // al menos un frame antes de poder volver a contar.
 if (!isMatch) _needRelease = false;
 _holdStartTs = null;
 _updateHoldUI(0);
 } else if (isMatch){
 if (_holdStartTs === null) _holdStartTs = tNow;
 const elapsed = tNow - _holdStartTs;
 const pct = Math.min(1, elapsed / HOLD_SECONDS);
 _updateHoldUI(pct);

 if (pct >= 1.0){
 // ¡Aprendida! — avanzamos a la siguiente letra
 _holdStartTs = null;
 _needRelease = true;
 const learned = j.sign || target;
 showToast('SI ¡' + learned + ' aprendida!', 'success');
 if (!state.progress.completed.includes('letter_' + learned)){
 state.progress.completed.push('letter_' + learned);
 saveAll();
 }
 setTimeout(() => {
 setTargetByIdx(camIdx + 1);
 _resetHold();
 }, 350);
 }
 } else {
 // No hay match -> reiniciar hold (igual que el desktop)
 _holdStartTs = null;
 // Mostrar la confianza actual (modo "barra de acc" normal)
 const inner = $('#accBar').firstElementChild;
 if (inner){
 inner.style.background = '';
 inner.style.width = conf + '%';
 }
 $('#accBar').setAttribute('aria-valuenow', conf);
 $('#accVal').textContent = conf + '%';
 }
 accuracy = conf;

 // ---- 3) Landmarks (estilo MediaPipe oficial)
 _drawLandmarks(j.landmarks, isMatch);

 // ---- 4) Status / coaching hint
 if (_needRelease){
 $('#camStatusText').textContent = 'Suelta la mano para la siguiente letra';
 } else if (isMatch){
 $('#camStatusText').textContent = 'Mantén la pose para confirmar…';
 } else if (j.hint){
 $('#camStatusText').textContent = j.hint;
 } else {
 $('#camStatusText').textContent = 'En vivo - ' + (j.latency_ms || '?') + ' ms';
 }
 }catch(err){
 console.warn('[LSM] backend error:', err);
 backendOnline = false;
 _drawLandmarks(null, false);
 if (_realLoopActive) requestAnimationFrame(realRecognizeLoop);
 return;
 }
 // Siguiente iteración
 if (_realLoopActive) requestAnimationFrame(realRecognizeLoop);
}

function startRealLoop(){
 if (_realLoopActive) return;
 _realLoopActive = true;
 _needRelease = false;
 _resetHold();
 realRecognizeLoop();
}
function stopRealLoop(){
 _realLoopActive = false;
 _resetHold();
 _needRelease = false;
 const cnv = $('#camOverlayCanvas');
 if (cnv) cnv.getContext('2d').clearRect(0,0,cnv.width,cnv.height);
}

function mockRecognize(){
 // En producción: enviar frame del canvas a POST /api/recognize
 // Aquí simulamos un sistema que mejora con el tiempo y a veces acierta
 const target = targets[camIdx].glyph;
 const drift = (Math.random() - 0.4) * 25;
 accuracy = Math.max(0, Math.min(100, accuracy + drift));
 $('#accBar').firstElementChild.style.width = accuracy + '%';
 $('#accBar').setAttribute('aria-valuenow', Math.round(accuracy));
 $('#accVal').textContent = Math.round(accuracy) + '%';
 if (accuracy > 75){
 $('#camDetect').textContent = target;
 $('#camDetect').classList.add('correct');
 if (accuracy > 92){
 showToast('¡Detectado: ' + target + '! Avanzando...', 'success');
 setTimeout(() => { setTargetByIdx(camIdx+1); accuracy = 20; }, 900);
 }
 } else {
 const wrongPool = targets.filter((_,i)=>i!==camIdx);
 const wrong = wrongPool[Math.floor(Math.random()*wrongPool.length)].glyph;
 $('#camDetect').textContent = Math.random() > .5 ? '?' : wrong;
 $('#camDetect').classList.remove('correct');
 }
}

$('#camStartBtn').addEventListener('click', startCamera);
$('#camNextBtn').addEventListener('click', () => { setTargetByIdx(camIdx+1); accuracy = 0; });
$('#quizMode').addEventListener('click', () => { stopCamera(); startLesson(LESSONS[0]); });

/* ============================================================
 11. REGISTRO
 ============================================================ */
function initSignup(){
 const sel = $('#reg-state');
 sel.innerHTML = '<option value="">Selecciona…</option>' + MX_STATES.map(s=>`<option value="${s}">${s}</option>`).join('');
 $('#reg-country').addEventListener('change', e => {
 sel.disabled = e.target.value !== 'MX';
 });

 $('#signupForm').addEventListener('submit', async e => {
 e.preventDefault();
 const name = $('#reg-name').value.trim();
 if (!name){ showToast('Escribe al menos tu nombre o apodo','error'); return; }

 const payload = {
 name,
 email: $('#reg-email').value.trim() || null,
 deaf: document.querySelector('input[name="deaf"]:checked')?.value || 'prefer',
 reason: $('#reg-reason').value,
 age_range:$('#reg-age').value,
 country: $('#reg-country').value,
 state: $('#reg-state').value,
 };

 let userId = null;
 if (backendOnline){
 try{
 const r = await fetch(LSM_BACKEND + '/api/register', {
 method: 'POST', headers: {'Content-Type':'application/json'},
 body: JSON.stringify(payload)
 });
 const j = await r.json();
 if (j.ok) userId = j.user_id;
 }catch(err){ console.warn('register error:', err); }
 }
 // Si el backend no está, generamos ID local (progreso solo en este dispositivo)
 const u = { ...payload, id: userId || ('local_' + Math.random().toString(36).slice(2,10)), created: new Date().toISOString() };
 state.user = u;
 saveAll();

 const via = userId ? 'sincronizado con el servidor' : '(guardado en este dispositivo)';
 showToast(`¡Bienvenido/a, ${name}! ${via}`, 'success');
 renderLevels(); renderProfile();
 // Refrescar dashboard con nuevos datos reales
 fetchDashboard(); fetchFeed();
 setTimeout(() => document.querySelector('#progreso').scrollIntoView({behavior:'smooth'}), 600);
 });
}

/* ============================================================
 12. EXPORTAR CSV (para Enactus) — solo datos reales del backend
 ============================================================ */
$('#exportBtn').addEventListener('click', async () => {
 let rows = [['metric','value','fuente','timestamp']];
 const ts = new Date().toISOString();

 if (backendOnline){
 try{
 const r = await fetch(LSM_BACKEND + '/api/dashboard');
 const d = await r.json();
 if (d.ok){
 rows = rows.concat([
 ['usuarios_registrados', d.total_users, 'backend_real', ts],
 ['lecciones_completadas', d.total_lessons, 'backend_real', ts],
 ['horas_de_practica', d.total_hours, 'backend_real', ts],
 ['reconocimientos_totales',d.total_recognitions, 'backend_real', ts],
 ['precision_promedio_pct', d.accuracy_pct, 'backend_real', ts],
 ['latencia_promedio_ms', d.avg_latency_ms, 'backend_real', ts],
 ]);
 if (d.top_letters){
 d.top_letters.forEach(t => rows.push(['seña_top_'+t.letter, t.count, 'backend_real', ts]));
 }
 // Datos locales del usuario actual
 rows.push(['mi_progreso_lecciones', state.progress.completed.length, 'local_storage', ts]);
 rows.push(['mi_racha_dias', state.streak.days, 'local_storage', ts]);
 rows.push(['mi_minutos_practica', state.minutes, 'local_storage', ts]);
 rows.push(['generado_en', d.generated_at, 'backend_real', ts]);
 rows.push(['nota', '"'+d.note+'"', 'backend_real', ts]);
 }
 }catch(err){
 showToast('Error al obtener datos del backend para CSV','error');
 return;
 }
 } else {
 // Sin backend: solo datos locales, con transparencia total
 rows = rows.concat([
 ['advertencia', '"Backend offline — solo datos locales de este dispositivo"', 'local_storage', ts],
 ['mi_progreso_lecciones', state.progress.completed.length, 'local_storage', ts],
 ['mi_racha_dias', state.streak.days, 'local_storage', ts],
 ['mi_minutos_practica', state.minutes, 'local_storage', ts],
 ]);
 }

 const csv = rows.map(r => r.join(',')).join('\n');
 const blob = new Blob([csv], {type:'text/csv'});
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = 'senas_a_voces_real_'+(new Date().toISOString().slice(0,10))+'.csv';
 a.click(); URL.revokeObjectURL(url);
 showToast(backendOnline ? 'CSV con datos reales descargado OK' : 'CSV local descargado (backend offline)', 'success');
});

/* ============================================================
 13. CONTROLES UI: tema, contraste, menú, idioma
 ============================================================ */
function applyPrefs(){
 if (state.prefs.theme) document.documentElement.setAttribute('data-theme', state.prefs.theme);
 if (state.prefs.contrast) document.documentElement.setAttribute('data-contrast', 'high');
 if (state.prefs.lang) $('#langSelect').value = state.prefs.lang;
}
$('#themeBtn').addEventListener('click', () => {
 const cur = state.prefs.theme;
 const next = cur === 'light' ? 'dark' : cur === 'dark' ? null : 'light';
 state.prefs.theme = next;
 if (next) document.documentElement.setAttribute('data-theme', next);
 else document.documentElement.removeAttribute('data-theme');
 saveAll();
});
$('#contrastBtn').addEventListener('click', () => {
 state.prefs.contrast = !state.prefs.contrast;
 if (state.prefs.contrast) document.documentElement.setAttribute('data-contrast', 'high');
 else document.documentElement.removeAttribute('data-contrast');
 saveAll();
 showToast(state.prefs.contrast?'Modo alto contraste activado':'Modo alto contraste desactivado','');
});
$('#menuToggle').addEventListener('click', () => {
 const open = $('#navMain').classList.toggle('open');
 $('#menuToggle').setAttribute('aria-expanded', open);
});
$('#navMain').addEventListener('click', e => {
 if (e.target.tagName === 'A') $('#navMain').classList.remove('open');
});
$('#langSelect').addEventListener('change', e => {
 state.prefs.lang = e.target.value;
 saveAll();
 showToast('Idioma actualizado a: '+e.target.value.toUpperCase()+' (traducción completa próximamente)','');
});

/* ============================================================
 14. RACHA DIARIA
 ============================================================ */
function updateStreak(){
 const today = new Date().toDateString();
 const last = state.streak.last;
 if (last === today) return;
 const yest = new Date(); yest.setDate(yest.getDate()-1);
 if (last === yest.toDateString()) state.streak.days += 1;
 else if (!last) state.streak.days = 1;
 else state.streak.days = 1;
 state.streak.last = today;
 saveAll();
}

/* ============================================================
 15. INIT
 ============================================================ */
function init(){
 applyPrefs();
 updateStreak();
 renderLevels();
 renderProfile();
 renderTeam();
 renderTimeline();
 renderRoadmap();
 initMap();
 initSignup();
 setTargetByIdx(0);
 // 1. Detectar backend -> luego cargar datos reales
 pingBackend().then(() => {
 fetchDashboard();
 fetchFeed();
 });

 // Polling cada 30 s (no spamear el servidor)
 setInterval(() => {
 if (backendOnline) { fetchDashboard(); fetchFeed(); }
 }, 30_000);

 console.log('%c Señas a Voces Academy','color:#1B4F9B;font-weight:900;font-size:16px');
 console.log('Enactus México 2026 - Hermosillo, Sonora');
 console.log('Licencia CC BY-NC-SA 4.0 - github.com/senasavoces');
}
document.addEventListener('DOMContentLoaded', init);

/* ============================================================
 API ENDPOINTS reales (lsm_teacher_web.py)
 ============================================================
 GET /api/health -> ping
 GET /api/dashboard -> datos reales del servidor
 GET /api/feed?limit=N -> actividad real de usuarios
 POST /api/recognize -> body: {frame, target, user_id}
 POST /api/lesson/complete -> body: {user_id, lesson_id, duration_sec, precision}
 POST /api/register -> body: {name, email, deaf, reason, age_range, country, state}
 GET /api/progress/:user_id -> progreso del usuario
 ============================================================ */

})();
