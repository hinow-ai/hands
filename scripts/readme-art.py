"""Gera as imagens do README a partir da arte e do CSS reais do produto.

Nada aqui é desenhado à mão: o banner usa as mesmas máscaras de mão que a
extensão carrega, e a captura do overlay usa o CSS extraído de
`src/content/overlay.ts`. Se a interface mudar, basta rodar de novo e as
imagens acompanham, em vez de envelhecerem em silêncio.

As imagens saem com fundo escuro próprio de propósito: o GitHub tem tema claro
e tema escuro, e as máscaras são pretas sobre transparente, então sumiriam num
dos dois se fossem usadas cruas.

Uso:  python3 scripts/readme-art.py
Requer: google-chrome (modo headless).
"""

import base64
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
IMG = RAIZ / "public" / "img"
SAIDA = RAIZ / ".github"
SAIDA.mkdir(exist_ok=True)

CHROME = shutil.which("google-chrome") or shutil.which("chromium")
if not CHROME:
    raise SystemExit("google-chrome não encontrado")


def dados(nome: str) -> str:
    """PNG da pasta de arte como data URI, para o HTML não depender de arquivo."""
    b64 = base64.b64encode((IMG / nome).read_bytes()).decode()
    return f"data:image/png;base64,{b64}"


BASE = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.mask { display: block; background: currentColor;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain; }
"""

POSES = [
    ("hand-open.png", "Open hand"),
    ("hand-point.png", "Index finger up"),
    ("hand-side.png", "Index finger to the side"),
    ("hand-fist.png", "Closed fist"),
]


def renderiza(html: str, largura: int, altura: int, destino: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        pagina = Path(tmp) / "stage.html"
        pagina.write_text(html)
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             f"--window-size={largura},{altura}",
             f"--screenshot={destino}", "--virtual-time-budget=4000",
             f"file://{pagina}"],
            check=True, capture_output=True,
        )
    print(f"  {destino.relative_to(RAIZ)}  {largura}x{altura}  "
          f"{destino.stat().st_size / 1024:.0f} kB")


def banner() -> None:
    ladrilhos = "".join(
        f'<div class="tile"><span class="mask hand" style="'
        f"-webkit-mask-image:url('{dados(a)}');mask-image:url('{dados(a)}')\"></span></div>"
        for a, _ in POSES
    )
    html = f"""<!doctype html><meta charset=utf-8><style>{BASE}
body {{ width: 1280px; height: 440px; overflow: hidden; }}
.hero {{ width: 1280px; height: 440px; display: grid;
  grid-template-columns: 1fr 360px; align-items: center; gap: 56px;
  padding: 0 64px; color: #f2f4f7;
  background: linear-gradient(160deg, #1b2029 0%, #101218 100%); }}
.logo {{ width: 292px; height: 60px; color: #fff; }}
.badge {{ display: inline-block; margin: 24px 0 18px; padding: 7px 15px;
  border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
  background: rgba(255,255,255,.06); font-size: 13px; font-weight: 600;
  letter-spacing: .02em; color: #cfd6e0; }}
h1 {{ font-size: 44px; line-height: 1.1; letter-spacing: -.02em; max-width: 15ch; }}
p {{ margin-top: 16px; font-size: 17px; line-height: 1.6; color: #9aa3b2; max-width: 44ch; }}
.tiles {{ display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }}
.tile {{ aspect-ratio: 1; border-radius: 22px; padding: 25px;
  background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.12); }}
.hand {{ width: 100%; height: 100%; color: #f2f4f7; }}
</style>
<div class="hero">
  <div>
    <span class="mask logo" style="-webkit-mask-image:url('{dados('logo.png')}');
      mask-image:url('{dados('logo.png')}');-webkit-mask-position:left center;
      mask-position:left center"></span>
    <span class="badge">Beta &middot; Free &middot; Open source</span>
    <h1>Browse the web with your hands</h1>
    <p>Your webcam becomes the pointer. No mouse, no keyboard,
       nothing to hold and nothing to aim at.</p>
  </div>
  <div class="tiles">{ladrilhos}</div>
</div>"""
    renderiza(html, 1280, 440, SAIDA / "banner.png")


def poses() -> None:
    for arquivo, _ in POSES:
        html = f"""<!doctype html><meta charset=utf-8><style>{BASE}
body {{ width: 240px; height: 240px; overflow: hidden; }}
.tile {{ width: 240px; height: 240px; padding: 44px; background: #1b2029; }}
.hand {{ width: 100%; height: 100%; color: #f2f4f7; }}
</style>
<div class="tile"><span class="mask hand" style="
  -webkit-mask-image:url('{dados(arquivo)}');mask-image:url('{dados(arquivo)}')"></span></div>"""
        nome = arquivo.replace("hand-", "").replace(".png", "")
        renderiza(html, 240, 240, SAIDA / f"pose-{nome}.png")


def overlay() -> None:
    """Captura do overlay real, com o CSS que a extensão usa em produção."""
    fonte = (RAIZ / "src" / "content" / "overlay.ts").read_text()
    estilo = re.search(r"const STYLE = `([\s\S]*?)`\n", fonte).group(1)

    rolagem = [
        ("scroll_down", "hand-open.png", "Scroll down", "open hand", True),
        ("scroll_up", "hand-point.png", "Scroll up", "index finger up", False),
        ("next_link", "hand-side.png", "Next link", "index finger to the side", False),
        ("stop", "hand-fist.png", "Stop everything", "closed fist: locks all", False),
    ]
    acao = [
        ("next_link", "hand-open.png", "Next link", "open hand", True),
        ("prev_link", "hand-side.png", "Previous link", "index finger to the side", False),
        ("click", "hand-point.png", "Click the selected link", "index finger up, 2 s", False),
        ("rest", "hand-fist.png", "Stop everything", "closed fist: locks all", False),
    ]

    def painel(itens, lado, titulo):
        linhas = ""
        for cid, arte, acaotxt, dedos, aceso in itens:
            on = " on" if aceso else ""
            u = dados(arte)
            linhas += (
                f'<div class="grow cmd-{cid}{on}">'
                f"<span class=\"gi\" style=\"-webkit-mask-image:url('{u}');"
                f"mask-image:url('{u}')\"></span>"
                f'<span><span class="ga">{acaotxt}</span><br />'
                f'<span class="gf">{dedos}</span></span>'
                f'<span class="gnow">now</span></div>'
            )
        return (f'<div class="guide {lado} present">'
                f'<div class="ghead"><span class="gdot"></span>'
                f'<span class="gtitle">{titulo}</span></div>{linhas}</div>')

    artigo = """
<article>
  <h1>Making the web usable without a mouse</h1>
  <p class="meta">Accessibility &middot; 6 min read</p>
  <p>Pointing at a small target and holding still is the hardest thing an interface can ask
  of a person. For anyone living with tremor, reduced strength or limited reach, it is the
  single barrier that turns an ordinary page into a locked door.</p>
  <p>The usual answer is to make the target bigger. The better answer is to stop asking
  people to aim at all: let the selection <a href="#">step from link to link</a>, the way a
  keyboard does, and let a gesture confirm it.</p>
  <p>What follows is an account of building that, and of the twelve versions it took before
  a child could use it without being taught twice.</p>
</article>"""

    html = f"""<!doctype html><meta charset=utf-8><style>{BASE}
body {{ width: 1280px; height: 800px; overflow: hidden; }}
.stage {{ position: relative; width: 1280px; height: 800px; overflow: hidden; background: #fff; }}
.page {{ position: absolute; inset: 0; padding: 66px 110px; color: #1b1d22; }}
article {{ max-width: 660px; margin: 0 auto; }}
article h1 {{ font-size: 32px; line-height: 1.2; margin-bottom: 8px; letter-spacing: -.02em; }}
.meta {{ font-size: 13px; opacity: .55; margin-bottom: 22px; }}
article p {{ font-size: 15.5px; line-height: 1.75; margin-bottom: 16px; }}
article a {{ color: #1a73e8; }}
{estilo}</style>
<div class="stage">
  <div class="page">{artigo}</div>
  <div class="root light" style="position:absolute;inset:0">
    {painel(rolagem, 'left', 'Left hand: scrolls the page')}
    {painel(acao, 'right', 'Right hand: picks and clicks')}
    <div class="hud"><span class="state">Link selected</span><span class="sep">|</span>
      <span class="muted">Open: next &middot; finger to the side: back &middot;
      finger up 2 s: click</span></div>
  </div>
</div>"""
    renderiza(html, 1280, 800, SAIDA / "overlay.png")


if __name__ == "__main__":
    print("gerando arte do README em .github/")
    banner()
    poses()
    overlay()
