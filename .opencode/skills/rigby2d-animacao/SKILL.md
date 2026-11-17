---
name: Animação articulada Rigby2D
description: Trabalhar em rigs 2D, hierarquias de ossos, pivôs, IK, camadas, acessórios, keyframes e movimentos de calistenia no Rigby2D
---

# Qualidade de animação 2D

1. Confirmar o formato do projeto e a estrutura real de bones/slots/skins/animações antes de editar.
2. Preservar a identidade visual, os PNGs, as conexões, a ordem das camadas e as poses preexistentes.
3. Respeitar a cadeia tronco-ombro-cotovelo-punho e anca-joelho-tornozelo; mãos fixas na barra durante uma elevação, pés livres quando suspensos, pivôs e pesos visualmente coerentes.
4. Preferir poucos keyframes corretos com interpolação suave a centenas de chaves artificiais. Evitar objetos que flutuem ou partes que se descolem.
5. Para barra fixa: pose inicial suspensa, subida controlada, topo, descida controlada; tempo total de 5 s quando pedido.
6. Validar movimento em diferentes instantes, não apenas no fotograma 0. Testar visualmente no navegador quando disponível.
7. Não reescrever `.rigby` nem substituir sprites originais sem backup e pedido específico.
