// SPDX-License-Identifier: MIT
// Troca images/mao_esquerda.png e images/mao_direita.png (limpas) no treinador_trabalho.rigby.
import fs from "node:fs";
import path from "node:path";
import { unzip, zip } from "../rigby2d/src/editor/zip.js";

const EST = "C:/Users/marti/Documents/Projeto Padrão/RIGBY2D_ESTUDIO";
const RIGBY = path.join(EST, "projetos", "treinador_trabalho.rigby");
const TEMP = "C:/Users/marti/AppData/Local/Temp/opencode";
const TROCAR = ["images/mao_esquerda.png", "images/mao_direita.png"];

const bytes = new Uint8Array(fs.readFileSync(RIGBY));
const entries = [...unzip(bytes)].map(([p, b]) => ({ path: p, bytes: b }));
for (const alvo of TROCAR) {
  const e = entries.find((x) => x.path === alvo);
  if (!e) throw new Error(alvo + " não encontrada");
  const nova = new Uint8Array(fs.readFileSync(path.join(TEMP, path.basename(alvo))));
  console.log(alvo, ":", e.bytes.length, "->", nova.length, "bytes");
  e.bytes = nova;
}
const empacotado = zip(entries.map((e) => ({ path: e.path, bytes: e.bytes })));
const tmp = RIGBY + ".tmp";
fs.writeFileSync(tmp, empacotado);
fs.renameSync(tmp, RIGBY);
console.log("gravado:", RIGBY, fs.statSync(RIGBY).size, "bytes");
