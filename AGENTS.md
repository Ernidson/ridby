# Rigby2D — instruções permanentes (curtas)

Projeto: editor/engine 2D articulado em `rigby2d/`; visualizador PixiJS em `viewer/`; projetos `.rigby` em `projetos/`; `viewer_cache/` contém ficheiros gerados. Consultar `LEIA-ME.md` apenas quando necessário para descobrir comandos/arquitetura. Preservar sempre rigs, assets, hierarquias, keyframes, IK e animações existentes.

## Como trabalhar
- Localizar os ficheiros relevantes antes de os abrir; pesquisar nomes/símbolos e ler apenas trechos úteis. Excluir `node_modules/`, caches, imagens, ZIPs e ficheiros gerados de pesquisas gerais.
- Usar ferramentas reais. Nunca inventar leitura, compilação, testes ou comportamento no navegador.
- Fazer alterações pequenas, com impacto mínimo. Não refazer a arquitetura nem instalar dependências sem necessidade demonstrada.
- Antes de alterar ficheiros existentes, verificar `git status --short`; preservar alterações do utilizador. Se não existir Git, guardar cópia dos ficheiros alvo.
- Não apagar projetos/assets nem reescrever `.rigby` binários sem instrução específica e cópia de segurança.
- Para bugs visuais, distinguir análise estática de execução real no navegador; usar Console/Network quando possível.
- Depois de alterar código, executar os testes pertinentes e apresentar resultados reais.
- Não fazer `git push`, operações Git destrutivas nem alterar ficheiros de credenciais sem autorização explícita.

## Resposta eficiente
Resumir em: **Causa**, **Ficheiros alterados**, **Teste executado e resultado**, **Pendente**. Evitar despejos de código, logs ou inventários extensos. Trabalhar em português.
