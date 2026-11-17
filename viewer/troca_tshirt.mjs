// Troca images/tronco_tshirt.png por um PNG dado (argv-like via constante abaixo).
import fs from "node:fs";
import path from "node:path";
import { unzip, zip } from "../rigby2d/src/editor/zip.js";

const EST = "C:/Users/marti/Documents/Projeto Padrão/RIGBY2D_ESTUDIO";
const RIGBY = path.join(EST, "projetos", "treinador_trabalho.rigby");
const NOVA = "C:/Users/marti/AppData/Local/Temp/opencode/tronco_tshirt_limpa.png";

const bytes = new Uint8Array(fs.readFileSync(RIGBY));
const entries = [...unzip(bytes)].map(([p, b]) => ({ path: p, bytes: b }));
const e = entries.find((x) => x.path === "images/tronco_tshirt.png");
if (!e) throw new Error("tronco_tshirt não encontrada");
const nova = new Uint8Array(fs.readFileSync(NOVA));
console.log("troca:", e.bytes.length, "->", nova.length, "bytes");
e.bytes = nova;
const empacotado = zip(entries.map((x) => ({ path: x.path, bytes: x.bytes })));
const tmp = RIGBY + ".tmp";
fs.writeFileSync(tmp, empacotado);
fs.renameSync(tmp, RIGBY);
console.log("gravado:", fs.statSync(RIGBY).size, "bytes");
