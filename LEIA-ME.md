# RIGBY2D_ESTUDIO — Estado e como usar

## O que está instalado (confirmado por execução)

| Item | Caminho | Estado |
| --- | --- | --- |
| Rigby2D (branch `develop`, v0.5.1) | `rigby2d/` | ZIP oficial (Git não instalado), 306 testes ✓ 0 ✗ |
| Raiz do MCP | `projetos/` | MCP do OpenCode ligado (`opencode mcp list` → ✓ connected) |
| Config MCP | `../opencode.json` | `mcp.servers.rigby2d`, type local, `node …/src/mcp/server.js --root …/projetos` |
| Personagem demo | `projetos/demo_nila.rigby` | Cópia de `branding/nila/nila.rigby` (original intacto) |
| Editor web | `npm.cmd run web:dev` em `rigby2d/` | http://localhost:1420 |
| Viewer-ponte (atualização automática) | `viewer/servidor.mjs` | http://localhost:8620 |

## Animação de teste (5 s) — `levantar_braco` em demo_nila.rigby

Chaves FK nos ossos `upperarm_r`/`forearm_r` (mesmo padrão da animação `wave` oficial):

| Tempo | Evento | upperarm_r (local) | forearm_r (local) |
| --- | --- | --- | --- |
| 0.0 | neutro | 0 | 0 |
| 0.6 | antecipação leve do ombro | −8° | 0 |
| 1.6 | braço erguido, cotovelo flexionado | −114° (mundo ≈120°) | −55.5° |
| 2.2 | pausa (valores iguais, sem tremor) | −114° | −55.5° |
| 3.4 | início do regresso | −114° | −55.5° |
| 5.0 | neutro estável (= setup) | 0 | 0 |

Verificações feitas: `sample_pose` a 0 / 0.6 / 1.6 / 2.2 / 4.2 / 5.0 — distância
cotovelo→mão constante = 263.8 (comprimento do antebraço): a mão nunca se separa;
`validate_project` → valid=true; export JSON 4.3 contém as 12 chaves com curvas.

## Como ver

1. **Editor (edição e esqueleto/keyframes):** http://localhost:1420 → *File ▸ Open* →
   escolher `RIGBY2D_ESTUDIO\projetos\demo_nila.rigby` (Chrome/Edge dão acesso à pasta).
   Mostrar ossos/eixos: painel Rig/View; abrir `levantar_braco` no dopesheet.
2. **Viewer com atualização automática:** http://localhost:8620 — escolhe o projeto e a
   animação; quando o MCP altera o `.rigby`, o viewer recarrega sozinho (polling de mtime
   a cada 0,7 s). Usa o runtime+renderer oficiais (PixiJS) e um export gerado pelo código
   oficial (`loadProject` + `writeSkeletonJson`). Nunca altera o `.rigby`: escreve apenas
   em `viewer_cache/`.

## Arrancar os serviços (PowerShell)

```powershell
# editor web
cd "C:\Users\marti\Documents\Projeto Padrão\RIGBY2D_ESTUDIO\rigby2d"; npm.cmd run web:dev
# viewer-ponte
cd "C:\Users\marti\Documents\Projeto Padrão\RIGBY2D_ESTUDIO\viewer"; node servidor.mjs
```

## Ainda por testar / limitações

- O editor web não deteta ficheiros alterados externamente: depois de edições MCP,
  reabrir o ficheiro no editor (File ▸ Open de novo) — o viewer a :8620 é que tem reload automático.
- Render MP4 só na aprovação (File ▸ Render animation, no editor; o MCP não renderiza vídeo).
- Segundo teste (barra fixa) fica para depois da aprovação deste.
