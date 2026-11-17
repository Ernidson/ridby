// SPDX-License-Identifier: MIT
// Troca images/barra_fixa.png dentro de treinador_trabalho.rigby usando o zip.js oficial.
// Backup antes; escrita atómica (tmp -> rename).
import fs from "node:fs";
import path from "node:path";
import { unzip, zip } from "../rigby2d/src/editor/zip.js";

const EST = "C:/Users/marti/Documents/Projeto Padrão/RIGBY2D_ESTUDIO";
const RIGBY = path.join(EST, "projetos", "treinador_trabalho.rigby");
const NOVA = "C:/Users/marti/AppData/Local/Temp/opencode/barra_fixa_nova.png";
const BACKUP = path.join(EST, "projetos", "_backups", "treinador_trabalho_pre_barra.rigby");

fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
if (!fs.existsSync(BACKUP)) fs.copyFileSync(RIGBY, BACKUP);
console.log("backup:", BACKUP, fs.existsSync(BACKUP) ? "ok" : "FALHOU");

const bytes = new Uint8Array(fs.readFileSync(RIGBY));
const nova = new Uint8Array(fs.readFileSync(NOVA));
const entries = [...unzip(bytes)].map(([p, b]) => ({ path: p, bytes: b }));
const alvo = entries.find((e) => e.path === "images/barra_fixa.png");
if (!alvo) throw new Error("images/barra_fixa.png não encontrada no .rigby");
console.log("antes:", alvo.bytes.length, "bytes | nova:", nova.length, "bytes");
alvo.bytes = nova;

const empacotado = zip(entries.map((e) => ({ path: e.path, bytes: e.bytes })));
const tmp = RIGBY + ".tmp";
fs.writeFileSync(tmp, empacotado);
fs.renameSync(tmp, RIGBY);
console.log("gravado:", RIGBY, fs.statSync(RIGBY).size, "bytes");

// verificação: reler e confirmar
const conf = [...unzip(new Uint8Array(fs.readFileSync(RIGBY)))].find(([p]) => p === "images/barra_fixa.png");
console.log("confirmado:", conf[1].length === nova.length ? "nova imagem no ficheiro ✓" : "ERRO tamanho");
