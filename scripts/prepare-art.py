#!/usr/bin/env python3
"""
Prepara a arte da interface: recorta o fundo e gera máscaras tingíveis.

As imagens de origem são line-art preto sobre fundo branco — ótimas para
imprimir, inúteis para uma interface que troca de tema: num painel escuro, o
retângulo branco em volta da mão aparece inteiro. A saída aqui é o mesmo
desenho como MÁSCARA: cor preta com o alfa vindo da escuridão do traço.

Com máscara, a cor não está mais na imagem. O CSS pinta o desenho com
`mask-image` + `background: currentColor`, então o mesmo arquivo sai preto no
tema claro e branco no escuro, sem duplicar arte nem depender de filtros.

Três passos por imagem:

1. **Alfa a partir da luminância**, com esticamento. O fundo não é branco puro
   (fica em 253-254), e sem o esticamento sobraria um véu de alfa 1-2 sobre
   toda a tela — invisível no claro, sujeira visível no escuro.
2. **Apara as margens** até a caixa do desenho, com uma folga proporcional. O
   original tem margens generosas que, num ícone de 34px, comeriam metade do
   espaço e deixariam a mão minúscula.
3. **Reduz e otimiza.** 1254px de lado para um ícone de 34px é desperdício de
   700 kB por arquivo; 256px cobre telas retina com folga.

Rodar: python3 scripts/prepare-art.py
"""

from pathlib import Path
from PIL import Image

# A arte de origem fica FORA de public/: `public/` inteiro vai para dentro do
# pacote da extensão, e os PNGs originais somam ~3,6 MB que ninguém baixaria
# para nada — o que a extensão usa são as máscaras geradas aqui, de ~56 kB.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art"
OUT = ROOT / "public" / "img"

# Abaixo de LO o pixel é fundo; acima de HI é traço cheio. A faixa entre os
# dois preserva a suavização das bordas, que é o que evita o serrilhado.
LO, HI = 14, 190

# nome de saída, arquivo de origem, lado maior final, folga (fração do lado)
#
# A mão lateral aponta para a direita; a versão para a esquerda é a mesma arte
# espelhada no CSS. Guardar dois arquivos idênticos a menos de um espelho
# custaria manutenção em dobro toda vez que a arte mudasse.
JOBS = [
    ("logo", "logo_top.png", 720, 0.02),
    ("hand-open", "mao_aberta.png", 256, 0.06),
    ("hand-fist", "mao_fechada.png", 256, 0.06),
    ("hand-point", "indicador.png", 256, 0.06),
    ("hand-side", "mao_apontar_lateral.png", 256, 0.06),
]


def to_mask(path: Path) -> Image.Image:
    """Preto com alfa = escuridão do traço, já esticado."""
    gray = Image.open(path).convert("L")
    alpha = gray.point(
        lambda v: 0 if (255 - v) <= LO else (255 if (255 - v) >= HI else int((255 - v - LO) * 255 / (HI - LO)))
    )
    mask = Image.new("RGBA", gray.size, (0, 0, 0, 0))
    mask.putalpha(alpha)
    return mask


def trim(img: Image.Image, pad_ratio: float) -> Image.Image:
    box = img.getchannel("A").getbbox()
    if not box:
        return img
    cropped = img.crop(box)
    pad = int(max(cropped.size) * pad_ratio)
    if pad <= 0:
        return cropped
    padded = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), (0, 0, 0, 0))
    padded.paste(cropped, (pad, pad))
    return padded


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, source, longest, pad in JOBS:
        src = SRC / source
        if not src.exists():
            print(f"  ! {source} não encontrado, pulando")
            continue

        img = trim(to_mask(src), pad)
        scale = longest / max(img.size)
        if scale < 1:
            img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)

        dest = OUT / f"{name}.png"
        img.save(dest, optimize=True)
        before = src.stat().st_size / 1024
        after = dest.stat().st_size / 1024
        print(f"  {source} → img/{name}.png  {img.width}×{img.height}  {before:.0f} kB → {after:.0f} kB")


if __name__ == "__main__":
    main()
