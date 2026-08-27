# Gesture Nav

Controle a navegação de **qualquer site** com as mãos, pela webcam. Extensão Chrome (MV3).
Mover o cursor, clicar, rolar, arrastar, dar zoom em imagens e navegar num mapa — sem tocar
em mouse ou teclado.

O vídeo nunca sai da máquina: câmera e modelo rodam localmente, e o que trafega entre os
processos são só os gestos já reconhecidos.

---

## Instalação

```bash
npm install
npm run fetch:model     # baixa hand_landmarker.task (~7,5 MB), uma vez só
npm run build
```

Depois, em `chrome://extensions`: ative o **modo desenvolvedor**, clique em
**Carregar sem compactação** e escolha a pasta `dist/`.

Ative pelo ícone da extensão ou por <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>. Na primeira
ativação o Chrome pede permissão de câmera — concedida **uma vez para a extensão**, não por
site visitado.

---

## Os gestos

Cada um reaproveita algo que a mão já sabe fazer em trackpad ou celular, e todos são separáveis
pela contagem de dedos esticados, o que os torna difíceis de confundir entre si.

| Gesto | Ação |
|---|---|
| ☝️ **Apontar** (só o indicador) | Move o cursor |
| 🤏 **Pinça** | Clica. Mantendo fechada e movendo, arrasta |
| ✌️ **Dois dedos** | Rola a página, com inércia ao soltar |
| ✊ **Punho** | Trava o cursor para reposicionar o braço |
| 🖐️ **Mão aberta** | Repouso — nada acontece |
| 🤏🤏 **Duas pinças** | Zoom pela distância entre as mãos |
| 👈 **Polegar ao lado** | Voltar / avançar no histórico |

O **punho** merece destaque: é o equivalente a levantar o mouse da mesa. Quando a mão chega ao
limite do alcance confortável, feche o punho, traga o braço de volta e reabra — o cursor não se
move nesse intervalo.

A mão direita comanda o cursor; se só a esquerda estiver no quadro, ela assume.

---

## Como funciona

Três processos, cada um com uma responsabilidade.

```
  ┌───────────────────────┐   gestos    ┌──────────────────┐   gestos   ┌───────────────────┐
  │  documento offscreen  │ ──────────► │  service worker  │ ─────────► │  content script   │
  │  câmera + modelo +    │             │  roteia p/ a     │            │  cursor, HUD,     │
  │  reconhecimento       │             │  aba ativa       │            │  ações na página  │
  └───────────────────────┘             └──────────────────┘            └─────────┬─────────┘
                                                                                  │ postMessage
                                                                        ┌─────────▼─────────┐
                                                                        │  content script   │
                                                                        │  dentro do iframe │
                                                                        └───────────────────┘
```

**Por que um documento offscreen.** A origem dele é a própria extensão, então a permissão de
câmera vale para todos os sites de uma vez. E existe uma única instância da câmera e do modelo
para o navegador inteiro — uma por aba seria inviável, já que a webcam é exclusiva.

**Como o site é operado.** Eventos sintéticos disparam os handlers de JavaScript de uma página,
mas não os comportamentos nativos do navegador: um `wheel` sintético não rola nada por conta
própria. Já um mapa escuta `wheel` em JS e faz o próprio zoom.

A saída é uma estratégia de duas camadas. Despachamos o evento real primeiro; se o site chamar
`preventDefault()`, ele assumiu o controle e paramos por aí. Se ninguém cancelar, aplicamos nós
mesmos o efeito nativo equivalente. O mesmo gesto rola uma página de notícias e dá zoom no
Google Maps, sem que o código precise saber em qual dos dois está.

**Abas que já estavam abertas.** Content scripts declarados no manifest só entram em páginas
carregadas depois da instalação. Para que "qualquer site" seja verdade desde o primeiro instante,
o service worker injeta o script retroativamente nas abas existentes ao instalar, e sonda a aba
com um ping antes de ativá-la, injetando se não houver resposta. Uma marca no lado do content
script impede que a dupla entrada crie dois cursores.

**Iframes de outra origem.** O content script é injetado em todos os frames, então cada iframe
tem a própria cópia rodando lá dentro, com acesso pleno ao seu DOM. O frame de cima detecta que
o cursor está sobre um `<iframe>`, converte a coordenada para o sistema local daquele frame e
manda o comando por `postMessage` — a única ponte que atravessa origens. É por isso que
funciona no Maps sem chave de API e sem nenhuma cooperação do site.

---

## O que dá a fluidez

Não é acessório: é a maior parte da engenharia.

**One Euro Filter.** O rastreamento tem ruído de alguns pixels por frame mesmo com a mão parada.
Um filtro fixo remove o tremor mas adiciona lag, e lag mata a sensação de controle direto. O One
Euro adapta a frequência de corte à velocidade: mão parada filtra forte e o cursor fica cravado
(é o que permite acertar um link pequeno); movimento amplo quase não filtra e o cursor acompanha.

**Interpolação a 60 fps.** O modelo entrega ~30 amostras por segundo. O cursor é interpolado a
cada frame de animação, senão o movimento fica visivelmente escalonado.

**Área ativa reduzida.** Só a região central do quadro mapeia para a tela inteira, então os
cantos ficam alcançáveis sem esticar o braço até a borda do campo de visão, onde o rastreamento
degrada.

**Histerese e confirmação curta.** Cada gesto liga num limiar e desliga em outro, com uma banda
morta entre eles — sem isso, um valor oscilando em torno do limiar gera dezenas de cliques por
segundo. A confirmação exige 3 frames consecutivos (~100 ms), rápido o bastante para parecer
instantâneo.

**Inércia na rolagem.** Um movimento rápido percorre bastante página, como no scroll por toque.

---

## Detecção invariante

O detector mede **ângulos de articulação** — invariantes a rotação e escala — e normaliza toda
distância pelo tamanho da própria palma, o que a torna independente da distância à câmera.

A abordagem ingênua ("a ponta do dedo tem Y menor que a junta, logo está esticado") só funciona
com a mão vertical e de frente. Comparação medida sobre as mesmas entradas sintéticas:

| | detector ingênuo | este |
|---|---|---|
| Sob rotação da mão | 45% correto | **100%** |
| Sob variação de escala | 64% correto | **100%** |

O caso mais grave da abordagem ingênua: com a mão a 180°, um punho é lido como mão aberta —
gestos de ações opostas.

```bash
npm test          # 34 asserções sobre o motor
npm run test:legacy   # a comparação acima, reproduzível
```

---

## Campo de teste

```bash
npm run demo      # http://localhost:5599
```

Exercita alvos de clique de tamanhos decrescentes, rolagem em container aninhado, arraste,
zoom em imagem e um canvas que cancela os próprios eventos (como um mapa).

Para testar iframe de outra origem, suba uma segunda instância e abra `/iframe-test.html`:

```bash
PORT=5600 npm run demo
```

---

## Ajustes

No popup da extensão:

- **Área de alcance** — quanto do quadro mapeia para a tela. Menor exige menos movimento de braço.
- **Estabilidade do cursor** — corte mínimo do filtro. Menor deixa mais firme, com um pouco mais de lag.
- **Velocidade da rolagem** — quanto o movimento da mão é ampliado.

---

## Limitações conhecidas

- Páginas internas do Chrome (`chrome://`, a Web Store) não aceitam content scripts. Nada funciona
  nelas, e nem pode.
- PDFs no visualizador nativo e vídeo protegido por DRM não expõem o conteúdo ao DOM: o cursor
  aparece, mas não há elemento para clicar.
- Digitar texto não está implementado — o teclado continua necessário para campos de entrada.
- Só a aba ativa recebe gestos, por decisão de projeto: uma câmera, uma aba.
- O reconhecimento cai de qualidade com iluminação muito fraca ou contraluz forte.

---

## Estrutura

```
src/core/        motor independente de navegador
  filters.ts       One Euro, histerese, estabilização
  handModel.ts     geometria da mão, invariância
  gestures.ts      vocabulário e reconhecimento
  pointer.ts       mapeamento mão→tela, clutch, inércia
  wire.ts          formato trocado entre processos
src/content/     o que age dentro da página
  synth.ts         síntese de eventos, duas camadas
  controller.ts    máquina de estados
  overlay.ts       cursor e realce (Shadow DOM)
  imageZoom.ts     visualizador de imagem
  frames.ts        ponte para iframes
  frameAgent.ts    executor dentro de um iframe
src/offscreen/   câmera, modelo, reconhecimento
src/background/  ciclo de vida e roteamento
src/popup/       painel de controle
```
