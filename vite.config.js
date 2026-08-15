import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAINING_DIR = path.resolve(__dirname, "public", "training_data");
const MANIFEST = path.join(TRAINING_DIR, "manifest.json");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

// Guarda los ejemplos entrenados en public/training_data/<categoria>/<SEÑA>_<n>.json
// numerando de forma acumulativa, y agrega la seña al manifest.json.
function trainSignPlugin() {
  return {
    name: "train-sign-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/training-data", (req, res) => {
        const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
        const requested = pathname.replace(/^\/+/, "");
        const relative = requested === "manifest" ? "manifest.json" : requested;
        const filePath = path.resolve(TRAINING_DIR, relative);
        const isJson = filePath.endsWith(".json");
        const isNpy = filePath.endsWith(".npy");
        if (!relative || !filePath.startsWith(`${TRAINING_DIR}${path.sep}`) || (!isJson && !isNpy)) {
          sendJson(res, 400, { ok: false, error: "Ruta de entrenamiento inválida" });
          return;
        }
        try {
          if (isJson) {
            sendJson(res, 200, JSON.parse(fs.readFileSync(filePath, "utf8")));
          } else {
            // Servir .npy como binario
            const buf = fs.readFileSync(filePath);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", buf.length);
            res.end(buf);
          }
        } catch (e) {
          sendJson(res, e.code === "ENOENT" ? 404 : 500, { ok: false, error: e.message });
        }
      });

      server.middlewares.use("/api/train-sign", async (req, res) => {
        if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "Method Not Allowed" }); return; }
        try {
          const { signName, category = "palabras", examples } = JSON.parse(await readBody(req));
          if (!signName || !Array.isArray(examples) || examples.length === 0) {
            sendJson(res, 400, { ok: false, error: "signName y examples son requeridos" });
            return;
          }
          const sign = String(signName).trim().toUpperCase();
          const catDir = path.join(TRAINING_DIR, category);
          fs.mkdirSync(catDir, { recursive: true });

          // Continuar numeracion desde ejemplos existentes (acumula)
          let startN = 0;
          for (const f of fs.readdirSync(catDir)) {
            const m = f.match(new RegExp("^" + sign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "_(\\d+)\\.(npy|json)$"));
            if (m) startN = Math.max(startN, parseInt(m[1], 10));
          }

          const files = [];
          examples.forEach((frames, i) => {
            const n = startN + i + 1;
            // Guardar como .npy (binario)
            const npyFile = path.join(catDir, `${sign}_${n}.npy`);
            const numFrames = frames.length;
            const arr = Buffer.alloc(numFrames * 42 * 3 * 4); // float32
            for (let f = 0; f < numFrames; f++) {
              const fr = frames[f];
              const lr = fr.landmarksRight || [];
              const ll = fr.landmarksLeft || [];
              for (let l = 0; l < 21; l++) {
                const r = lr[l] || { x: 0, y: 0, z: 0 };
                const li = ll[l] || { x: 0, y: 0, z: 0 };
                const baseR = (f * 42 + l) * 3 * 4;
                arr.writeFloatLE(r.x, baseR);
                arr.writeFloatLE(r.y, baseR + 4);
                arr.writeFloatLE(r.z || 0, baseR + 8);
                const baseL = (f * 42 + 21 + l) * 3 * 4;
                arr.writeFloatLE(li.x, baseL);
                arr.writeFloatLE(li.y, baseL + 4);
                arr.writeFloatLE(li.z || 0, baseL + 8);
              }
            }
            // Escribir header .npy + datos
            const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${numFrames}, 42, 3), }`;
            const headerBuf = Buffer.alloc(10 + header.length + 1);
            headerBuf.writeUInt8(0x93, 0); // magic
            headerBuf.write("NUMPY", 1);
            headerBuf.writeUInt8(1, 6); // major
            headerBuf.writeUInt8(0, 7); // minor
            headerBuf.writeUInt16LE(header.length + 1, 8); // header len (incluye \n)
            headerBuf.write(header, 10);
            headerBuf.writeUInt8(0x0a, 10 + header.length); // \n
            fs.writeFileSync(npyFile, Buffer.concat([headerBuf, arr]));
            files.push(`${category}/${sign}_${n}.npy`);
          });

          // Actualizar manifest.json
          let manifest = {};
          try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { manifest = {}; }
          if (!Array.isArray(manifest[category])) manifest[category] = [];
          if (!manifest[category].includes(sign)) manifest[category].push(sign);
          fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");

          console.log(`[TRAIN] ${sign} (${category}): +${files.length} ejemplo(s)`, files);
          sendJson(res, 200, { ok: true, sign, category, saved: files.length, files });
        } catch (e) {
          console.error("[TRAIN] error:", e);
          sendJson(res, 500, { ok: false, error: e.message });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), trainSignPlugin()],
  assetsInclude: ["**/*.onnx", "**/*.wasm"],
});
