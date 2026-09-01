<div align="center">

<a href="https://hands.hinow.ai">
  <img src=".github/banner.png" alt="hands.hinow.ai: browse the web with your hands" width="100%">
</a>

<p>
  <b>English</b>
  &nbsp;&middot;&nbsp;
  <a href="README.pt-BR.md">Português</a>
</p>

<p>
  <a href="https://hands.hinow.ai"><strong>hands.hinow.ai</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="https://hands.hinow.ai/beta/">Install the test build</a>
  &nbsp;&middot;&nbsp;
  <a href="https://www.hinow.ai/privacy">Privacy</a>
</p>

<p>
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-116%2B-1a73e8">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.1--beta-6f42c1">
  <img alt="Licence: attribution required" src="https://img.shields.io/badge/license-attribution-0f9d58">
  <img alt="Video stays local" src="https://img.shields.io/badge/video-never%20leaves%20your%20machine-111">
</p>

</div>

Control **any website** with your hands, through the webcam. A Chrome extension (MV3) that
turns the camera into a pointer, so that browsing stops depending on carrying a cursor to a
small target and holding it there.

**Who it is for.** First, for anyone who cannot comfortably use a mouse: limited hand
mobility, tremor, low strength or short reach. And, as a consequence, for anyone whose hands
are busy or far from the desk: a speaker driving slides from across the stage, a teacher at
the whiteboard, a pair of hands covered in flour with the recipe on screen.

**Privacy.** The video never leaves the machine. Camera and model run locally, and what
travels between processes is only the recognised gestures. Nothing is recorded and nothing is
sent.

---

## The four poses

One role per hand. This is the entire vocabulary.

<table>
<tr>
<td align="center" width="25%"><img src=".github/pose-open.png" width="96" alt="Open hand"></td>
<td align="center" width="25%"><img src=".github/pose-point.png" width="96" alt="Index finger up"></td>
<td align="center" width="25%"><img src=".github/pose-side.png" width="96" alt="Index finger to the side"></td>
<td align="center" width="25%"><img src=".github/pose-fist.png" width="96" alt="Closed fist"></td>
</tr>
<tr>
<td align="center"><b>Open hand</b><br><sub>scrolls the page, or moves to the next link</sub></td>
<td align="center"><b>Index finger up</b><br><sub>scrolls up, or clicks if you hold it two seconds</sub></td>
<td align="center"><b>Index finger to the side</b><br><sub>steps from one link to the next</sub></td>
<td align="center"><b>Closed fist</b><br><sub>locks everything, on either hand</sub></td>
</tr>
</table>

The same pose means one thing on the hand that scrolls and another on the hand that picks, so
the full mapping is:

| Hand | Pose | Action |
|---|---|---|
| Scrolling hand | Open hand | Scroll the page down |
| Scrolling hand | Index finger up | Scroll the page up |
| Scrolling hand | Index finger to the side | Select the next link |
| Scrolling hand | Closed fist | Stop everything |
| Picking hand | Open hand | Select the next link |
| Picking hand | Index finger to the side | Go back to the previous link |
| Picking hand | Index finger up, held 2 s | Click the selected link |
| Picking hand | Closed fist | Stop everything |
| Both hands | Open hand + finger pointing right | Next page |
| Both hands | Open hand + finger pointing left | Previous page |

Which hand does what is yours to choose in the popup, and there is a **left-handed mode**.

**The fist is the emergency brake, on both hands.** A closed fist on either hand cancels the
other hand's gestures: nothing scrolls, nothing steps, nothing clicks, nothing changes page,
and the status strip reads `Paused`. The easiest pose to form interrupts whatever is running,
and the selection stays where it was: the fist pauses, it does not clear. `next_link` exists
on both hands deliberately, because moving forward is the most frequent action, and two motor
paths to the same command is redundancy in favour of anyone with limited control of one hand.

Scrolling up needs the finger's direction on top of the pose (pointing down does not scroll
up) and only starts after the pose holds for a quarter of a second: closing an open hand
passes through a transient "point", since the index is the last finger to fold, and without
the wait, stopping a scroll would hiccup in the opposite direction.

Taking your hands out of frame stops everything. When it fails, it fails towards doing
nothing.

**Which hand is which: position decides, not the model's label.** The tracker gets the
left/right label wrong often, and with fixed roles a swapped label inverts every command. So
the role comes from body geometry: facing the camera, your left hand appears on the left side
of the mirrored image, as in a mirror. With two hands in frame, position settles it; a hand
left alone keeps the role it had, which is what lets the picking hand cross the centre to
reach a link on the far side without "becoming" the other hand; only a brand new hand, with no
history, uses the model's label. The same step eliminates the ghost hand: the same hand
detected twice by MediaPipe.

**Why these poses.** Open hand and fist are the two most separable shapes the tracker
produces. Open requires only 4 of 5 fingers read as extended, which tolerates one badly
tracked finger; the fist requires zero; and between them lies a wide dead band where a bad
frame becomes no command at all. In the pointing pose only the index state matters: middle and
ring count in favour even when half bent. The ring finger shares a tendon with the middle one
and rarely folds completely, and it was exactly that requirement that made the natural
pointing pose fail to register.

**The picking hand chooses, it does not aim.** Carrying a cursor to a target and keeping it
there is the hardest motor task an interface can ask for: tremor, drift and a poor camera all
conspire against it. This vocabulary removes it. The selection steps **from link to link, in
reading order**. Opening the hand moves forward; laying the index finger to the side goes back
(either side, because the intent is "back", not a geometric direction); holding the pose keeps
stepping, about 0.6 s per link. The fist **stops**, on both hands: there is a single resting
pose in the whole vocabulary. A blue rectangle and the cursor dot show what is selected, and
links covered by banners are skipped automatically. At the edges of the screen the selection
stays put: it is the scrolling hand that reveals more links.

**Clicking is holding the index finger up for 2 seconds**, with a progress arc filling around
the selected link. Up clicks and sideways goes back, and between the two there is a wide dead
band on the diagonal: a finger halfway does neither, on purpose. Going back still requires a
quarter second of holding, because raising the finger to vertical passes through "sideways",
and that journey must not step back a link by accident. Keeping the finger up produces a new
click every 2 seconds: if the person is still there, it is because the page did not respond,
and insisting is what they would do with a mouse. A brief stutter in reading the pose does not
reset the count; opening the hand or closing the fist, which are clear intent, reset it
immediately.

**Lowering your hand does not lose the selection.** Anyone who gets tired rests their arm, and
the link stays selected waiting for the click. For this project's audience, children and
people with reduced mobility, holding an arm in the air is the real cost of using the
interface, and the whole vocabulary was designed to minimise it.

**Changing pages needs both hands, deliberately.** The picking hand lying to the side gives
the direction (left for the previous page, right for the next, the browser's own arrows) and
the open hand confirms, holding for about a second with an amber arc in the centre of the
screen. It is the only action in the vocabulary that replaces the entire screen, so it is the
only one that asks for two simultaneous poses: a combination like that does not happen by
accident. It is one page per gesture: to go back twice, release and do it again. And while the
combination holds, scrolling and stepping back are suspended, because it takes precedence.

> Drag, zoom, pinch click, history, two-finger scroll and free cursor aiming are **disabled**.
> The engine that recognises them is still in the repository, tested, to be reintroduced one
> at a time. What is not in the vocabulary above does not act on the page.

---

## What it looks like on screen

<div align="center">
  <img src=".github/overlay.png" alt="The extension running over an article, with a gesture panel in each bottom corner and the status strip in the middle" width="100%">
</div>

Three layers, all of which can be switched off in the popup once you no longer need them.

**Gesture guide, one panel per hand.** Bottom left for the hand that scrolls, bottom right for
the one that clicks. Each line shows what the gesture does and the pose that forms it, which
is the information people lack when they know a scroll gesture exists but cannot remember how
to make it. The line for the command in progress lights up. A hand out of frame fades the
whole panel: it answers "is it seeing me?" without having to try a gesture to find out.

The highlight is never colour alone. The active line changes background, gains a bar on the
left and writes `now`, so anyone who does not distinguish green still knows which one is
active. `Stop` lights up red, not green, because stopping is the opposite of acting and the
colour has to say so on its own.

**Fingertips.** Five dots per hand, one colour per finger, warm tones on the left hand and
cool tones on the right, because the first question anyone asks looking at the screen is which
of the two is their right hand. The index gets a white ring, since it is the one driving the
cursor. When tracking loses a finger, that becomes visible instantly, and the person has
something to correct: hand position, lighting or framing.

The fingertips go through the same mapping as the cursor, not through the whole camera frame.
That is what makes the index dot land on the cursor it commands, instead of moving in a space
of its own and contradicting the relationship between hand and pointer.

**Status strip.** At the bottom, it says in words what is happening now: `Looking for your
hands`, `Link selected`, `Scrolling down`, `Clicking`. The guide teaches the vocabulary; this
says where in it you are.

Only the five fingertips cross the IPC boundary: ten numbers per hand, not the hundred and
thirty that all 21 landmarks would cost. It is enough to draw the tracking without the weight
that kept the full skeleton out of the protocol.

---

## Install

The published extension will be on the Chrome Web Store. Until then, there is a
[test build with step by step instructions](https://hands.hinow.ai/beta/).

From source:

```bash
npm install
npm run fetch:model     # downloads hand_landmarker.task (~7.5 MB), once
npm run build
```

Then, in `chrome://extensions`: turn on **Developer mode**, click **Load unpacked** and choose
the `dist/` folder.

Turn it on from the extension icon or with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>. On
first activation a tab opens asking for camera access: grant it there, **once for the
extension**, and it counts for every site rather than per site visited.

That request needs its own tab because the camera is opened in the offscreen document, and a
context with no interface cannot show Chrome's permission prompt: asking from there comes back
denied without asking anything. Since the permission is stored per origin, granting it on a
visible page of the extension unlocks the offscreen document for good. If access was blocked
before, remove the block in `chrome://settings/content/camera` and turn it on again.

---

## How it works

Three processes, each with one responsibility.

```
  ┌───────────────────────┐  gestures   ┌──────────────────┐  gestures  ┌───────────────────┐
  │  offscreen document   │ ──────────► │  service worker  │ ─────────► │  content script   │
  │  camera + model +     │             │  routes to the   │            │  cursor, HUD,     │
  │  recognition          │             │  active tab      │            │  page actions     │
  └───────────────────────┘             └──────────────────┘            └─────────┬─────────┘
                                                                                  │ postMessage
                                                                        ┌─────────▼─────────┐
                                                                        │  content script   │
                                                                        │  inside the frame │
                                                                        └───────────────────┘
```

**Why an offscreen document.** Its origin is the extension itself, so the camera permission
counts for every site at once. And there is a single instance of the camera and the model for
the whole browser, because one per tab would be impossible, since the webcam is exclusive.

**How the site is operated.** Synthetic events fire a page's JavaScript handlers, but not the
browser's native behaviours: a synthetic `wheel` scrolls nothing by itself. A map, on the other
hand, listens for `wheel` in JavaScript and does its own zoom.

The way out is a two-layer strategy. We dispatch the real event first; if the site calls
`preventDefault()`, it has taken control and we stop there. If nobody cancels, we apply the
equivalent native effect ourselves. The same gesture scrolls a news page and zooms Google Maps,
without the code needing to know which of the two it is on.

**Tabs that were already open.** Content scripts declared in the manifest only enter pages
loaded after installation. For "any site" to be true from the first moment, the service worker
injects the script retroactively into existing tabs on install, and pings a tab before
activating it, injecting if there is no answer. A marker on the content script side stops the
double entry from creating two cursors.

**Cross-origin iframes.** The content script is injected into every frame, so each iframe has
its own copy running inside it, with full access to its DOM. The top frame detects that the
cursor is over an `<iframe>`, converts the coordinate into that frame's local system and sends
the command by `postMessage`, the only bridge that crosses origins. That is why it works on
Maps with no API key and no cooperation from the site.

---

## What makes it feel fluid

This is not decoration: it is most of the engineering.

**One Euro Filter.** Tracking has a few pixels of noise per frame even with a still hand. A
fixed filter removes the shake but adds lag, and lag kills the sense of direct control. One
Euro adapts its cutoff frequency to speed: a still hand filters hard and the cursor sits
nailed down, which is what allows hitting a small link; a wide movement barely filters and the
cursor keeps up.

**Interpolation at 60 fps.** The model delivers about 30 samples per second. The cursor is
interpolated on every animation frame, otherwise the movement is visibly stepped.

**Reduced active area.** Only the central region of the frame maps to the whole screen, so the
corners are reachable without stretching your arm to the edge of the field of view, where
tracking degrades.

**Hysteresis and a short confirmation.** Each gesture turns on at one threshold and off at
another, with a dead band between them. Without that, a value oscillating around the threshold
produces dozens of clicks per second. Confirmation requires 3 consecutive frames, about 100 ms,
fast enough to feel instant.

**Scroll inertia.** A quick movement covers a good stretch of page, as touch scrolling does.

---

## What makes it precise

> This section describes fine aiming at small targets. With sequential selection, free cursor
> aiming left the active path, and with it the magnetism, the adaptive gain and the armed
> click, which stay here because they come back together with drag. Fingertip stabilisation
> still applies to the pointing direction of the scrolling hand.

Filtering removes the shake, not the amplification. The active area magnifies the camera frame
about five times up to the screen, so every pixel of tracking error becomes five on screen, and
no filter undoes that. Four mechanisms attack the amplification itself.

**Adaptive gain.** Slow movement moves the cursor about a third of the hand's distance, which
is where fine aiming comes from; fast movement returns to absolute mapping. Correspondence
with the absolute position is restored during wide movements, when attention is not on aiming.

**Stabilised fingertip.** The tip is the noisiest landmark the model produces, because it sits
at the end of the kinematic chain and accumulates the error of every joint. Since an extended
finger is approximately straight, we project the tip onto the axis defined by two inner joints,
which are more stable. The perpendicular noise, which is almost all of the lateral shake,
disappears.

**Click armed before closing.** Bringing the fingers together displaces the whole hand, so
aiming and clicking at the same coordinate would be impossible. The position is frozen when the
pinch *starts* to close, and that is the one the click uses.

**Magnetism.** Within about 26 px, the cursor is pulled inside the clickable target. Applied
only to the visible position: the pointer's internal target stays free, so leaving is as easy
as entering. It switches off over canvas, maps and during drags, where the free position is the
content.

Measured with `npm run measure`, for a 1920×1080 screen and hand tremor of about 2 px in frame:

| | before | after |
|---|---|---|
| Cursor wobble while still | 14.8 px | **2.4 px** |
| Smallest comfortable target | ~30 px | **~5 px** |
| Fingertip noise | 46.9 px | **11.7 px** (−75%) |

And in a real browser, over targets within 26 px of the cursor: **0% hit rate without
magnetism, 100% with it**.

The meter's numbers use a noise model; real tracking brings other errors, so expect a better
result than before, not exactly these values.

---

## Invariant detection

The detector measures **joint angles**, which are invariant to rotation and scale, and
normalises every distance by the size of the palm itself, which makes it independent of the
distance to the camera.

The naive approach ("the fingertip has a smaller Y than the joint, therefore it is extended")
only works with the hand vertical and facing forward. Measured comparison over the same
synthetic inputs:

| | naive detector | this one |
|---|---|---|
| Under hand rotation | 45% correct | **100%** |
| Under scale variation | 64% correct | **100%** |

The worst case of the naive approach: with the hand at 180°, a fist reads as an open hand.
Those are gestures with opposite actions.

```bash
npm test              # assertions over the engine
npm run test:legacy   # the comparison above, reproducible
npm run measure       # precision report, in pixels
```

---

## Test field

```bash
npm run demo      # http://localhost:5599
```

It exercises click targets of decreasing size, scrolling in a nested container, drag, image
zoom and a canvas that cancels its own events, like a map does.

To test a cross-origin iframe, start a second instance and open `/iframe-test.html`:

```bash
PORT=5600 npm run demo
```

---

## Settings

In the extension popup:

- **Panel appearance**: light or dark.
- **On-screen instructions**: the two gesture panels in the corners, with light or dark
  appearance independent of the panel's own: the page being read may be dark while the
  settings panel is light.
- **Status strip** and **fingertips** (diagnostic): what shows most over the page.
- **Reach area**: how much of the frame maps to the screen. Smaller asks for less arm movement.
- **Cursor stability**: the filter's minimum cutoff. Lower is steadier, with slightly more lag.
- **Scroll speed**: how much the hand movement is amplified.

---

## The art

The hand drawings and the logo live in `art/`, outside the package, as black line art on a
white background. `npm run art` converts them into **masks**, where the drawing becomes the
alpha channel and the colour leaves the image, which CSS then paints with `currentColor`. That
is what lets the same file serve both themes without a second inverted artwork, and what brings
3.6 MB of PNG down to 56 kB inside the extension. Replacing a drawing means replacing the file
in `art/` and running the script again.

`npm run art:readme` regenerates the images in `.github/` from that same art and from the
overlay's own CSS, so the pictures in this file cannot drift away from the product.

---

## Known limitations

- Chrome's internal pages (`chrome://`, the Web Store) do not accept content scripts. Nothing
  works there, and nothing can.
- PDFs in the native viewer and DRM-protected video do not expose their content to the DOM: the
  cursor appears, but there is no element to click.
- Typing text is not implemented: the keyboard is still needed for input fields.
- Only the active tab receives gestures, by design: one camera, one tab.
- Recognition degrades with very low light or strong backlight.

---

## Structure

```
src/core/        browser-independent engine
  filters.ts       One Euro, hysteresis, stabilisation
  handModel.ts     hand geometry, invariance
  gestures.ts      vocabulary and recognition
  pointer.ts       hand to screen mapping, clutch, inertia
  handedness.ts    which hand is which, from body position
  spatial.ts       target choice by direction
  wire.ts          format exchanged between processes
src/content/     what acts inside the page
  synth.ts         event synthesis, two layers
  controller.ts    state machine
  overlay.ts       cursor and highlight (Shadow DOM)
  targets.ts       link collection from the page
  imageZoom.ts     image viewer
  frames.ts        bridge to iframes
  frameAgent.ts    executor inside an iframe
src/offscreen/   camera, model, recognition
src/background/  lifecycle and routing
src/popup/       control panel
art/             source art (outside the package) → npm run art
public/_locales/ translations; the language follows the browser
store/           Chrome Web Store listing material
```

---

## Third party

The published package embeds Google's MediaPipe WebAssembly runtime and the hand landmark
model, both of which carry their own terms. They are named, with the attribution their licences
require, in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and the build copies that file
into `dist/` so it travels inside the extension.

Everything in `src/` is original work.

---

## License

Do what you want with this code (use it, change it, redistribute it, sell it), with **one
condition**: keep a visible link to [hands.hinow.ai](https://hands.hinow.ai) in any copy or
derivative. "Visible" means reachable by someone using the software without opening the code:
an about screen, a footer, the store page. The full terms are in [LICENSE](LICENSE).

The project is free and open source because accessibility should not come with a toll.
