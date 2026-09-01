#!/usr/bin/env python3
"""
Gera os blocos promocionais da Chrome Web Store.

Duas peças: o letreiro de 1400×560, que aparece nas seções em destaque, e o
bloco pequeno de 440×280, usado nas listas. As duas saem da mesma arte da
extensão — logo e desenhos de mão como máscaras — para que a peça de
divulgação não descole do produto quando a arte mudar.

Fundo escuro de propósito: a loja é clara e as capturas do produto também, de
modo que uma peça escura separa a marca do resto da página em vez de sumir
nela.

Tudo é desenhado com o dobro do tamanho e reduzido no fim (SUPERSAMPLE): as
bordas arredondadas e o texto do Pillow são serrilhados no tamanho final, e
reduzir uma imagem grande é o jeito barato de conseguir suavização.

Rodar: npm run tiles
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public" / "img"
OUT = ROOT / "store"

FONT_DIR = Path("/usr/share/fonts/opentype/inter")
FONT_SEMI = FONT_DIR / "InterDisplay-SemiBold.otf"
FONT_MED = FONT_DIR / "InterDisplay-Medium.otf"

SUPERSAMPLE = 2

BG_TOP = (17, 19, 25)
BG_BOTTOM = (28, 33, 42)
WHITE = (255, 255, 255)
ACCENT = (53, 211, 138)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size * SUPERSAMPLE)


def tinted(name: str, width: int, color=WHITE, opacity: int = 255) -> Image.Image:
    """Uma das artes da extensão, pintada e redimensionada pela largura."""
    mask = Image.open(ART / f"{name}.png").convert("RGBA")
    w = width * SUPERSAMPLE
    mask = mask.resize((w, round(mask.height * w / mask.width)), Image.LANCZOS)
    solid = Image.new("RGBA", mask.size, color + (255,))
    alpha = mask.getchannel("A")
    if opacity < 255:
        alpha = alpha.point(lambda v: v * opacity // 255)
    solid.putalpha(alpha)
    return solid


def background(w: int, h: int) -> Image.Image:
    """Degradê vertical suave, na família do tema escuro do painel."""
    img = Image.new("RGB", (w * SUPERSAMPLE, h * SUPERSAMPLE))
    draw = ImageDraw.Draw(img)
    height = h * SUPERSAMPLE
    for y in range(height):
        t = y / (height - 1)
        draw.line(
            [(0, y), (w * SUPERSAMPLE, y)],
            fill=tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)),
        )
    return img.convert("RGBA")


def s(v: int) -> int:
    return v * SUPERSAMPLE


def layer(base: Image.Image) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """
    Camada transparente para desenhar tudo que usa alfa.

    `ImageDraw` SUBSTITUI o pixel, alfa incluído, em vez de compor: um branco a
    6% desenhado direto no fundo vira um branco a 6% de opacidade sobre o nada,
    e ao converter para RGB no fim ele reaparece opaco. Desenhar numa camada à
    parte e compor com `alpha_composite` é o que faz a transparência valer.
    """
    over = Image.new("RGBA", base.size, (0, 0, 0, 0))
    return over, ImageDraw.Draw(over)


def finish(img: Image.Image, w: int, h: int, name: str) -> None:
    out = img.convert("RGB").resize((w, h), Image.LANCZOS)
    dest = OUT / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, optimize=True)
    print(f"  {name}  {w}×{h}  {dest.stat().st_size/1024:.0f} kB")


# ------------------------------------------------------------ letreiro


def marquee() -> None:
    W, H = 1400, 560
    img = background(W, H)
    over, draw = layer(img)

    # Coluna da esquerda: marca, promessa, e a linha que responde "quanto custa
    # e para onde vai o vídeo" — as duas perguntas de quem vê isso pela
    # primeira vez.
    draw.text(
        (s(84), s(292)),
        "Browse the web with your hands",
        font=font(FONT_SEMI, 41),
        fill=WHITE + (255,),
    )

    dot_y = s(375)
    draw.ellipse([s(86), dot_y, s(86) + s(9), dot_y + s(9)], fill=ACCENT + (255,))
    draw.text(
        (s(107), s(366)),
        "Free and open source · Nothing leaves your computer",
        font=font(FONT_MED, 20),
        fill=WHITE + (150,),
    )

    # Coluna da direita: o vocabulário como quatro cartões, o mesmo formato que
    # a extensão usa na tela — quem instalar reconhece o que já viu aqui.
    card, gap, art_w = 152, 20, 84
    grid_x, grid_y = W - 84 - (card * 2 + gap), (H - (card * 2 + gap)) // 2
    poses = ["hand-open", "hand-point", "hand-side", "hand-fist"]

    for i in range(len(poses)):
        cx = grid_x + (i % 2) * (card + gap)
        cy = grid_y + (i // 2) * (card + gap)
        draw.rounded_rectangle(
            [s(cx), s(cy), s(cx + card), s(cy + card)],
            radius=s(26),
            fill=WHITE + (18,),
            outline=WHITE + (38,),
            width=max(1, s(1)),
        )

    img = Image.alpha_composite(img, over)

    # A arte vai depois da composição: dentro dos cartões, não por baixo.
    for i, pose in enumerate(poses):
        cx = grid_x + (i % 2) * (card + gap)
        cy = grid_y + (i // 2) * (card + gap)
        art = tinted(pose, art_w, opacity=240)
        img.paste(
            art,
            (s(cx) + (s(card) - art.width) // 2, s(cy) + (s(card) - art.height) // 2),
            art,
        )

    logo = tinted("logo", 430)
    img.paste(logo, (s(84), s(168)), logo)

    finish(img, W, H, "promo-marquee-1400x560.png")


# ------------------------------------------------------------ bloco pequeno


def small() -> None:
    W, H = 440, 280
    img = background(W, H)
    over, draw = layer(img)

    # Num bloco desse tamanho tudo compete por espaço: fica a marca, uma linha
    # de promessa e a fileira de gestos. Qualquer coisa a mais vira ruído.
    tagline = "Browse the web with your hands"
    f = font(FONT_MED, 16)
    tw = draw.textlength(tagline, font=f)
    draw.text(((s(W) - tw) / 2, s(142)), tagline, font=f, fill=WHITE + (165,))

    img = Image.alpha_composite(img, over)

    logo = tinted("logo", 268)
    img.paste(logo, ((s(W) - logo.width) // 2, s(76)), logo)

    poses = ["hand-open", "hand-point", "hand-side", "hand-fist"]
    art_w, gap = 40, 32
    arts = [tinted(p, art_w, opacity=225) for p in poses]
    total = sum(a.width for a in arts) + s(gap) * (len(arts) - 1)
    x = (s(W) - total) // 2
    row_h = max(a.height for a in arts)
    for a in arts:
        img.paste(a, (x, s(192) + (row_h - a.height) // 2), a)
        x += a.width + s(gap)

    finish(img, W, H, "promo-tile-440x280.png")


if __name__ == "__main__":
    print("\nBlocos promocionais:")
    marquee()
    small()
    print()
