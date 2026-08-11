// npy_parser.js
// Parser ligero para archivos .npy de NumPy en el navegador y Node.js.
// Soporta arrays float32/float64 con cualquier shape.

/**
 * Parsea un ArrayBuffer .npy y retorna { data: Float32Array, shape: number[], dtype: string }
 */
export function parseNpy(buffer) {
  const view = new DataView(buffer);

  // Magic: \x93NUMPY
  const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  for (let i = 0; i < magic.length; i++) {
    if (view.getUint8(i) !== magic[i]) throw new Error("No es archivo .npy válido");
  }

  let offset = 6;
  const major = view.getUint8(offset++);
  const minor = view.getUint8(offset++);

  // Header length
  let headerLen;
  if (major === 1) {
    headerLen = view.getUint16(offset, true);
    offset += 2;
  } else if (major === 2) {
    headerLen = view.getUint32(offset, true);
    offset += 4;
  } else {
    throw new Error(`Versión .npy no soportada: ${major}.${minor}`);
  }

  // Leer header como string (Latin1)
  let headerStr = "";
  for (let i = 0; i < headerLen; i++) {
    headerStr += String.fromCharCode(view.getUint8(offset + i));
  }
  offset += headerLen;

  // Parsear header: "{'descr': '<f4', 'fortran_order': False, 'shape': (21, 3), }"
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  const fortranMatch = headerStr.match(/'fortran_order':\s*(\w+)/);

  if (!descrMatch || !shapeMatch) throw new Error("Header .npy inválido: " + headerStr);

  const descr = descrMatch[1];
  const fortranOrder = fortranMatch ? fortranMatch[2] === "True" : false;

  const shape = shapeMatch[1]
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(Number);

  // Determinar dtype y bytes por elemento
  let dtype, bytesPerElement;
  const littleEndian = descr[0] === "<" || descr[0] === "|";
  if (descr.includes("f4") || descr.includes("f8")) {
    dtype = descr.includes("f4") ? "float32" : "float64";
    bytesPerElement = descr.includes("f4") ? 4 : 8;
  } else if (descr.includes("i4") || descr.includes("i8")) {
    dtype = descr.includes("i4") ? "int32" : "int64";
    bytesPerElement = descr.includes("i4") ? 4 : 8;
  } else {
    throw new Error("Dtype no soportado: " + descr);
  }

  // Calcular total de elementos
  const totalElements = shape.reduce((a, b) => a * b, 1);
  const totalBytes = totalElements * bytesPerElement;

  // Leer datos
  let data;
  if (dtype === "float32") {
    data = new Float32Array(totalElements);
    for (let i = 0; i < totalElements; i++) {
      data[i] = view.getFloat32(offset + i * bytesPerElement, littleEndian);
    }
  } else if (dtype === "float64") {
    data = new Float64Array(totalElements);
    for (let i = 0; i < totalElements; i++) {
      data[i] = view.getFloat64(offset + i * bytesPerElement, littleEndian);
    }
  } else if (dtype === "int32") {
    data = new Int32Array(totalElements);
    for (let i = 0; i < totalElements; i++) {
      data[i] = view.getInt32(offset + i * bytesPerElement, littleEndian);
    }
  } else {
    data = new Float64Array(totalElements);
    for (let i = 0; i < totalElements; i++) {
      data[i] = view.getFloat64(offset + i * bytesPerElement, littleEndian);
    }
  }

  return { data, shape, dtype, fortranOrder };
}

/**
 * Convierte un array .npy de landmarks a frames del detector.
 * Shapes soportados:
 *   [21, 3]   — estático, 1 frame, 1 mano (right)
 *   [N, 21, 3] — dinámico, N frames, 1 mano (right)
 *   [N, 42, 3] — dinámico, N frames, 2 manos (21 right + 21 left)
 * Retorna: [{ landmarksRight: [{x,y,z}, ...21], landmarksLeft: [{x,y,z}, ...21] | null }, ...]
 */
export function npyToFrames(parsed) {
  const { data, shape } = parsed;
  const frames = [];

  let numFrames, lmCount, dims;
  if (shape.length === 2) {
    numFrames = 1;
    lmCount = shape[0];
    dims = shape[1];
  } else if (shape.length === 3) {
    numFrames = shape[0];
    lmCount = shape[1];
    dims = shape[2];
  } else {
    throw new Error("Shape no soportado para landmarks: " + shape);
  }

  const isTwoHanded = lmCount === 42;
  const half = 21;

  // Una mano en ceros significa "no detectada". Debe viajar como null: si se
  // pasa como 21 puntos en el origen, hand_scale() vale ~0 y las velocidades
  // normalizadas explotan, produciendo distancias DTW astronomicas.
  const readHand = (f, offset) => {
    const hand = [];
    let present = false;
    for (let l = 0; l < half; l++) {
      const idx = (f * lmCount + offset + l) * dims;
      const x = data[idx];
      const y = data[idx + 1];
      const z = dims >= 3 ? data[idx + 2] : 0;
      if (x !== 0 || y !== 0) present = true;
      hand.push({ x, y, z });
    }
    return present ? hand : null;
  };

  for (let f = 0; f < numFrames; f++) {
    frames.push({
      landmarksRight: readHand(f, 0),
      landmarksLeft: isTwoHanded ? readHand(f, half) : null,
    });
  }

  return frames;
}
