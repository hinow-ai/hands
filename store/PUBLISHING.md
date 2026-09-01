# Publicar na Chrome Web Store

Extensão do Chrome vai para a **Chrome Web Store**, não para a Google Play,
porque a Play distribui apps Android. O painel é
<https://chrome.google.com/webstore/devconsole>.

Tudo que a loja pede está nesta pasta. O que falta são três passos que só o
dono da conta pode dar, explicados no fim.

---

## O que já está pronto aqui

| Arquivo | Para quê |
|---|---|
| `hands-hinow-ai-0.1.1.zip` | O pacote a enviar (12,3 MB, sem source maps) |
| `listing-en.md` | Textos da ficha em inglês: nome, descrições, justificativa de cada permissão |
| `listing-pt-BR.md` | Tradução da ficha para português |
| `privacy-policy.md` | Política de privacidade, a publicar em `hands.hinow.ai/privacy` |
| `screenshots/*.png` | Quatro capturas 1280×800 |
| `promo-tile-440x280.png` | Bloco promocional pequeno |

Para regerar o pacote depois de mudar o código:

```bash
npm run build && npm run package
```

---

## Antes de enviar

**1. Publique a política de privacidade.** A loja exige uma URL acessível para
qualquer extensão que peça câmera, e recusa a submissão sem ela. Publique
`privacy-policy.md` em <https://hands.hinow.ai/privacy>.

**2. Confira o e-mail de contato do desenvolvedor.** Ele precisa estar
verificado no painel, e aparece publicamente na ficha.

---

## Passo a passo no painel

1. **New Item → Choose file** e envie `hands-hinow-ai-0.1.1.zip`.
2. **Store listing**: cole os campos de `listing-en.md`.
   - Categoria: **Accessibility**
   - Envie as quatro capturas de `screenshots/`
   - Envie `promo-tile-440x280.png` em *Small promo tile*
   - Em *Additional languages*, adicione **Português (Brasil)** e cole
     `listing-pt-BR.md`
3. **Privacy practices**: cole o propósito único e a justificativa de **cada**
   permissão (estão em `listing-en.md`). É aqui que a maioria das recusas
   acontece: uma permissão sem justificativa convincente reprova a submissão.
   - Marque **nenhuma** caixa de coleta de dados: a extensão não coleta nada
   - Marque as três declarações de conformidade
   - Cole a URL da política de privacidade
4. **Distribution**: público-alvo, países e visibilidade.
   - Sugestão para o beta: **Unlisted** primeiro, testar com um grupo, e depois
     mudar para **Public**. Uma extensão que pede câmera e `<all_urls>` costuma
     passar por revisão manual; começar sem listar evita estrear com problemas
     à vista de todos.
5. **Submit for review**.

A revisão de uma extensão com câmera e acesso a todos os sites costuma levar de
alguns dias a duas semanas. Recusa não é o fim: o painel diz o motivo, e a
correção normalmente é de texto na justificativa, não de código.

---

## Os três passos que dependem de você

Não faço nenhum destes, e são bloqueios reais:

**1. Entrar na conta Google.** O painel pediu reautenticação de
`paulo@teclia.com`. Digitar sua senha é coisa sua. Não faço login em nome de
ninguém.

**2. Pagar a taxa de desenvolvedor**, se a conta ainda não for registrada. São
**US$ 5**, uma vez só, por conta. Não faço pagamentos.

**3. Aceitar o Contrato de Distribuição para Desenvolvedores.** É um acordo
legal em nome da hinow.ai, e quem assume tem de ser você, não eu.

Depois desses três, se quiser, eu preencho a ficha com você: os textos estão
prontos para colar, e posso conferir campo a campo antes do envio.

---

## Detalhes técnicos da submissão

- **Manifest V3**, versão `0.1.0` (`version_name: 0.1.0-beta`)
- **Chrome mínimo**: 116
- **Idiomas**: inglês (padrão) e português do Brasil, via `_locales`
- **Nenhum código remoto**: o modelo de rastreamento e o runtime wasm viajam
  dentro do pacote, como o MV3 exige
- **Nenhuma requisição de rede** em tempo de execução
- **Permissões**: `offscreen`, `storage`, `tabs`, `activeTab`, `scripting`,
  `<all_urls>` e câmera em tempo de execução, todas justificadas em
  `listing-en.md`

### Subir uma versão nova

Aumente `version` em `public/manifest.json` (a loja recusa reenvio com a mesma
versão), rode `npm run build && npm run package` e envie o zip novo em
*Package → Upload new package*.
