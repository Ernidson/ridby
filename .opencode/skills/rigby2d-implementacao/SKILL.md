---
name: Implementação e testes Rigby2D
description: Corrigir bugs e implementar melhorias pequenas no código Rigby2D com alterações mínimas, testes reais e controlo de regressões
---

# Implementação cirúrgica

1. Reproduzir ou localizar a falha antes de propor alterações. Evitar refatorações não pedidas.
2. Verificar `git status --short` e proteger ficheiros existentes. Não sobrescrever alterações do utilizador. Se não existir Git, guardar backup dos ficheiros antes de editar.
3. Tocar no mínimo de ficheiros; preservar contratos de dados `.rigby`, rigs, keyframes, sprites, constraints IK e animações existentes.
4. Para um bug em `viewer/`, validar inicialização PixiJS, caminhos dos recursos e estados visíveis; não inventar resultados visuais.
5. Executar apenas os testes/compilação pertinentes, confirmados nos scripts do projeto. Se um teste não estiver disponível, declarar a limitação.
6. Entregar resumo curto com causa, alterações por caminho, comandos e resultado real. Não declarar sucesso sem evidência.
7. Proibido fazer push, apagar ficheiros ou alterar binários `.rigby` sem aprovação explícita, mesmo que o Shell esteja tecnicamente autorizado.
