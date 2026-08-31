# Hands

[hands.hinow.ai](https://hands.hinow.ai)

Controle a navegação de **qualquer site** com as mãos, pela webcam. Extensão Chrome (MV3).
Hoje o vocabulário é mínimo e deliberado: **um comando** — mão aberta rola a página para baixo,
punho fechado para. Os demais voltam um a um, e cada um só entra depois de ficar confiável.

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
ativação abre-se uma aba pedindo acesso à câmera: conceda ali, **uma vez para a extensão**, e
vale para todos os sites — não é por site visitado.

O pedido precisa dessa aba porque a câmera é aberta no documento offscreen, e um contexto sem
interface não pode exibir a caixa de permissão do Chrome: pedir de lá volta negado sem
perguntar nada. Como a permissão é gravada por origem, concedê-la numa página visível da
extensão libera o offscreen de vez. Se o acesso tiver sido bloqueado antes, remova o bloqueio
em `chrome://settings/content/camera` e ative de novo.

---

## Os gestos

Um comando, e o gesto que o encerra. É o vocabulário inteiro.

| Gesto | Ação |
|---|---|
| 🖐️ **Mão aberta** | Rola a página para baixo |
| ✊ **Punho fechado** | Para |

Qualquer mão serve — o rótulo esquerda/direita do rastreador erra com frequência, e com um só
comando não há ambiguidade que dependa dele. Tirar a mão do quadro também para: a falha, quando
houver, é para o lado de não executar nada.

**Por que este par.** Mão aberta e punho são as duas poses mais separáveis que o rastreador
produz. A aberta exige só 4 dos 5 dedos lidos como esticados — tolera um dedo mal rastreado —,
o punho exige zero, e entre as duas há uma zona morta larga onde um frame ruim não vira comando
nenhum. Nenhuma das duas depende de um dedo específico, de direção ou da outra mão. É o degrau
de ~100% de acerto sobre o qual os próximos comandos entram, um por vez.

> Rolar para cima, clique, arraste, zoom, histórico e a rolagem por dois dedos estão
> **desativados**. O motor que os reconhece continua no repositório, testado, para serem
> reintroduzidos um a um. O que não está no vocabulário acima não age na página.

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

## O que dá a precisão

> Esta seção descreve a mira fina para clicar em alvos pequenos. Com o clique desativado, o
> **clique armado** e o **magnetismo** estão fora do caminho ativo — ficam aqui porque voltam
> junto com o comando que servem. O ganho adaptativo e a estabilização da ponta continuam
> valendo: são eles que seguram o cursor firme enquanto a página rola.

Filtrar remove o tremor, não a amplificação. A área ativa amplia o quadro da câmera em cerca de
cinco vezes até a tela, então cada pixel de erro do rastreamento vira cinco na tela — e nenhum
filtro desfaz isso. Quatro mecanismos atacam a amplificação em si.

**Ganho adaptativo.** Movimento lento move o cursor a ~1/3 da distância da mão, que é de onde vem
a mira fina; movimento rápido volta ao mapeamento absoluto. A correspondência com a posição
absoluta é restaurada durante os movimentos amplos, quando a atenção não está na mira.

**Ponta do dedo estabilizada.** A ponta é o landmark mais ruidoso que o modelo produz — fica no
fim da cadeia cinemática e acumula o erro de todas as juntas. Como um dedo esticado é
aproximadamente reto, projetamos a ponta sobre o eixo definido por duas juntas internas, mais
estáveis. O ruído perpendicular, que é quase todo o tremor lateral, desaparece.

**Clique armado antes de fechar.** Unir os dedos desloca a mão inteira, então mirar e clicar na
mesma coordenada seria impossível. A posição é congelada quando a pinça *começa* a fechar, e é
ela que o clique usa.

**Magnetismo.** Dentro de ~26 px, o cursor é levado para dentro do alvo clicável. Aplicado apenas
à posição visível — o alvo interno do ponteiro continua livre, então sair é tão fácil quanto
entrar. Desliga sobre canvas, mapas e durante arrastes, onde a posição livre é o conteúdo.

Medido em `npm run measure`, para tela 1920×1080 e tremor de mão de ~2 px no quadro:

| | antes | depois |
|---|---|---|
| Oscilação do cursor parado | 14,8 px | **2,4 px** |
| Menor alvo confortável | ~30 px | **~5 px** |
| Ruído da ponta do dedo | 46,9 px | **11,7 px** (−75%) |

E em navegador real, sobre alvos a até 26 px do cursor: **0% de acerto sem magnetismo, 100% com**.

Os números do medidor usam um modelo de ruído; o rastreamento real traz outros erros, então
espere um resultado melhor que antes, não exatamente estes valores.

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
npm test              # 41 asserções sobre o motor
npm run test:legacy   # a comparação acima, reproduzível
npm run measure       # relatório de precisão em pixels
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
- **Guia de gestos**, **pontas dos dedos** e **painel de estado** — o que aparece na tela, abaixo.

---

## O que aparece na tela

Três camadas, todas desligáveis no popup para quem já não precisa delas.

**Guia de gestos.** Um painel no canto inferior direito. Cada linha traz o que o gesto faz e a
pose que o forma — a informação que falta quando alguém sabe que existe um gesto de rolar mas
não lembra como fazê-lo. A linha do comando em curso acende. Mão fora do quadro esmaece o painel
inteiro: é a resposta à pergunta "ele está me vendo?" sem precisar testar um gesto para
descobrir.

O destaque nunca é só a cor. A linha ativa muda de fundo, ganha uma barra à esquerda e escreve
`agora` — quem não distingue o verde continua sabendo qual está ativa. O `Parar` acende em
vermelho, não em verde: parar é o oposto de agir, e a cor precisa dizer isso sozinha.

**Pontas dos dedos.** Cinco bolinhas por mão, uma cor por dedo, mão esquerda em tons quentes e
direita em tons frios — a primeira pergunta de quem olha a tela é qual das duas é a sua mão
direita. O indicador leva um anel branco por ser o que comanda o cursor. Quando o rastreamento
perde um dedo, isso fica visível no mesmo instante, e a pessoa tem o que corrigir: a posição da
mão, a luz ou o enquadramento.

As pontas passam pela mesma conversão do cursor, e não pelo quadro inteiro da câmera. É o que faz
a bolinha do indicador cair sobre o cursor que ela comanda, em vez de andar num espaço próprio e
desmentir a relação entre a mão e o ponteiro.

**Painel de estado.** No rodapé, diz em palavras o que está acontecendo agora: `Procurando a
mão`, `Parado`, `Rolando para baixo`. O guia ensina o vocabulário; este diz em que ponto dele
você está.

Só as cinco pontas atravessam o IPC — dez números por mão, não os cento e trinta que os 21
landmarks custariam. É o suficiente para desenhar o rastreamento sem o peso que motivou deixar o
esqueleto inteiro fora do protocolo.

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
