// SPDX-License-Identifier: MIT
// Servidor-ponte do estúdio: lê .rigby com o código oficial do Rigby2D (src/mcp/tools.js)
// e serve um viewer com o runtime oficial PixiJS. NUNCA altera o .rigby: escreve só na
// pasta viewer_cache/ (fora da raiz do MCP). Atualização automática: o viewer consulta
// /api/stat e recarrega quando o mtime muda.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../rigby2d/src/mcp/tools.js";
import { writeSkeletonJson } from "../rigby2d/src/core/interop.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESTUDIO = path.dirname(AQUI);
const REPO = path.join(ESTUDIO, "rigby2d");
const PROJETOS = path.join(ESTUDIO, "projetos");
const CACHE = path.join(ESTUDIO, "viewer_cache");
const PORTA = 8620;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".atlas": "text/plain; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css",
};

const pngDims = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const seguro = (n) => n.replaceAll("/", "__").replaceAll("\\", "__");

// /api/sync?file=X.rigby — converte para a cache (skeleton JSON 4.3 + atlas + PNGs)
// /api/sync?file=X.json — verifica se a cena já existe na cache (JSON + atlas já prontos)
async function sincronizar(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".rigby")) {
    const origem = path.join(PROJETOS, file);
    const stem = path.basename(file, ".rigby");
    const pasta = path.join(CACHE, stem);
    await fs.mkdir(pasta, { recursive: true });
    const p = await loadProject(origem);
    
    // Extract scene data directly from project.json in the ZIP (loadProject doesn't parse it)
    let scene = null;
    const projectJsonBytes = p.entries.get("project.json");
    if (projectJsonBytes) {
      try {
        const projectJson = JSON.parse(Buffer.from(projectJsonBytes).toString("utf8"));
        scene = projectJson.scene ?? null;
      } catch (e) {
        console.warn("Could not parse project.json for scene:", e);
      }
    }
    
    const { json, warnings: avisosConv } = writeSkeletonJson(p.doc, { version: "4.3" });
    await fs.writeFile(path.join(pasta, `${stem}.json`), JSON.stringify(json, null, 2), "utf8");
    // atlas: uma página por imagem (a página é o próprio PNG, região = página inteira)
    let atlas = "", avisos = [], n = 0;
    for (const [entrada, bytes] of p.entries) {
      if (!entrada.startsWith("images/") || !entrada.endsWith(".png")) continue;
      const nome = entrada.slice(7, -4);
      const ficheiro = `${seguro(nome)}.png`;
      await fs.writeFile(path.join(pasta, ficheiro), bytes);
      const { w, h } = pngDims(Buffer.from(bytes));
      atlas += `${ficheiro}\nsize: ${w},${h}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\n${nome}\nbounds: 0,0,${w},${h}\n\n`;
      n++;
    }
    await fs.writeFile(path.join(pasta, `${stem}.atlas`), atlas, "utf8");
    const animacoes = (p.doc.animations ?? []).map((a) => ({ name: a.name, duration: a.duration ?? 0 }));
    // Include scene data (actors, depth) for the viewer to load actors
    return { ok: true, file: stem, imagens: n, animacoes, avisos: [...avisos, ...(avisosConv ?? [])], scene };
  } else if (lower.endsWith(".json")) {
    // Cena JSON/atlas já pronta na cache
    const stem = path.basename(file, ".json");
    const pasta = path.join(CACHE, stem);
    try {
      await fs.access(path.join(pasta, `${stem}.json`));
      await fs.access(path.join(pasta, `${stem}.atlas`));
      const animacoesData = JSON.parse(await fs.readFile(path.join(pasta, `${stem}.json`), "utf8"));
      const animacoes = (animacoesData.animations ?? []).map((a) => ({ name: a.name, duration: a.duration ?? 0 }));
      // Contar imagens no atlas
      const atlasText = await fs.readFile(path.join(pasta, `${stem}.atlas`), "utf8");
      const n = (atlasText.match(/^size:/gm) || []).length;
      // Try to read scene from the cached JSON
      const scene = animacoesData.scene ?? null;
      return { ok: true, file: stem, imagens: n, animacoes, avisos: [], scene };
    } catch {
      throw new Error(`Cena ${stem} não encontrada na cache`);
    }
  } else {
    throw new Error("só .rigby ou .json");
  }
}

async function responder(res, corpo, tipo = "application/json") {
  res.writeHead(200, { "content-type": tipo, "cache-control": "no-store" });
  res.end(corpo);
}

const server = (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORTA}`);
  const p = decodeURIComponent(u.pathname);
  (async () => {
    if (p === "/" || p === "/viewer") {
      return responder(res, await fs.readFile(path.join(AQUI, "viewer.html")), MIME[".html"]);
    }
    if (p === "/api/list") {
      const nomes = (await fs.readdir(PROJETOS)).filter((n) => n.toLowerCase().endsWith(".rigby")).sort();
      return responder(res, JSON.stringify({ projetos: nomes }));
    }
    if (p === "/api/stat") {
      try {
        const s = await fs.stat(path.join(PROJETOS, u.searchParams.get("file")));
        return responder(res, JSON.stringify({ mtimeMs: s.mtimeMs, size: s.size }));
      } catch {
        return responder(res, JSON.stringify({ mtimeMs: 0 }));
      }
    }
    if (p === "/api/sync") {
      try {
        return responder(res, JSON.stringify(await sincronizar(u.searchParams.get("file"))));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ erro: String(e.message ?? e) }));
      }
    }
    if (p === "/api/raw") {
      try {
        const file = u.searchParams.get("file");
        const innerPath = u.searchParams.get("path") || "project.json";
        const origem = path.join(PROJETOS, file);
        const { loadProject } = await import("../rigby2d/src/mcp/tools.js");
        const p = await loadProject(origem);
        const entry = `project.json`; // For now, just project.json
        if (!p.entries.has(entry)) {
          throw new Error(`Entry ${entry} not found in ${file}`);
        }
        const bytes = p.entries.get(entry);
        return responder(res, bytes, "application/json");
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ erro: String(e.message ?? e) }));
      }
    }
    // estáticos: /cache/<stem>/<f>, /repo/<caminho no repo>, /vendor/pixi.min.mjs
    let disco = null;
    if (p.startsWith("/cache/")) disco = path.join(CACHE, p.slice(7));
    else if (p.startsWith("/repo/")) disco = path.join(REPO, p.slice(6));
    else if (p === "/vendor/pixi.min.mjs") disco = path.join(REPO, "node_modules", "pixi.js", "dist", "pixi.min.mjs");
    if (!disco) { res.writeHead(404); return res.end(); }
    disco = path.normalize(disco);
    if (!disco.startsWith(path.normalize(REPO)) && !disco.startsWith(path.normalize(CACHE))) { res.writeHead(403); return res.end(); }
    try {
      const b = await fs.readFile(disco);
      return responder(res, b, MIME[path.extname(disco).toLowerCase()] ?? "application/octet-stream");
    } catch {
      res.writeHead(404); return res.end();
    }
  })().catch((e) => { res.writeHead(500); res.end(String(e)); });
};

http.createServer(server).listen(PORTA, () => console.log(`viewer em http://localhost:${PORTA} (cache: ${CACHE})`));
