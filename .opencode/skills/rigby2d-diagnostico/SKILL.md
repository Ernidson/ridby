---
name: Diagnóstico Rigby2D
description: Investigar ecrã preto, falhas de texturas, canvas, PixiJS e carregamento de projetos Rigby2D com evidências, sem alterar ficheiros
---

# Diagnóstico económico e verificável

1. Ler primeiro apenas o ponto relevante de `LEIA-ME.md` e localizar `viewer/servidor.mjs`, `viewer/viewer.html` e o runtime PixiJS, conforme a falha.
2. Priorizar observação: verificar comandos de arranque e estado dos serviços, endpoints `/api/list`, `/api/sync`, `/api/stat`, URLs das texturas e erros reais de consola/rede se houver browser disponível.
3. Usar pesquisa pontual (`rg`, grep, lista de ficheiros) antes de abrir módulos inteiros. Não ler PNGs/ZIPs, `node_modules` ou `viewer_cache` em massa.
4. Separar **confirmado por execução**, **inferido do código** e **a testar**; mencionar caminhos/linhas apenas se efetivamente consultados.
5. Não editar nada durante a fase de diagnóstico. Produzir no máximo três hipóteses priorizadas e um teste discriminante por hipótese.
6. Se não houver acesso ao browser, não declarar o ecrã preto resolvido nem atribuir a causa a uma suposição.
