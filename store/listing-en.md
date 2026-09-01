# Chrome Web Store listing: English (default)

Copy each block into the matching field of the Web Store listing form.

---

## Name (max 75)

```
hands.hinow.ai: Browse with hand gestures
```

## Short description (max 132)

```
Scroll, pick links and click with hand gestures through your webcam. Built for people who cannot use a mouse. Runs offline.
```

*(122 characters)*

## Category

**Accessibility**: this is the honest fit and the audience the extension is
built for. "Productivity" would reach more people and describe it worse.

## Language

English (the listing), with the extension itself localized to English and
Portuguese (Brazil).

---

## Detailed description

```
Browse the web with your hands.

hands.hinow.ai turns your webcam into the pointer. Scroll a page, step through
its links and click them using a few plain hand poses. No mouse, no keyboard,
no touchscreen. There is nothing to hold and nothing to aim at.

WHO IT IS FOR

It is built first for people who cannot comfortably use a mouse: limited hand
mobility, tremor, reduced strength or reach. Pointing at a small target and
holding still is the hardest thing an interface can ask for, and this extension
removes that task entirely: the selection steps from link to link instead.

It turns out to serve anyone whose hands are busy or far from the desk as well:
a speaker driving slides from across the stage, a teacher at the whiteboard,
someone cooking with the recipe on screen.

HOW IT WORKS

One hand scrolls the page:
• Open hand: scroll down
• Index finger up: scroll up
• Index finger to the side: next link
• Closed fist: stop everything

The other hand picks and clicks, without aiming:
• Open hand: select the next link
• Index finger to the side: go back to the previous link
• Index finger up, held 2 seconds: click the selected link
• Closed fist: stop everything

Both hands together change page: hold one hand open and point the other to the
left or right for one second.

A closed fist on either hand freezes everything: the easiest pose to make is
the one that stops the system.

There is a left-handed mode, so the hand that picks and clicks is your dominant
one. On-screen panels show every gesture and light up the one being recognized,
so you always know whether the camera understood you. Light and dark themes.

PRIVACY

Everything runs on your own machine. The camera image is read locally and
thrown away frame by frame: no video is recorded, uploaded or sent anywhere,
and the extension makes no network requests at all. The hand-tracking model
ships inside the extension, so it works with no internet connection.

The camera only runs while the extension is switched on.

FREE AND OPEN SOURCE

Source code: https://github.com/hinow-ai/hands
Website: https://hands.hinow.ai

This is a beta. Gestures are being added one at a time, and each one only ships
after it works reliably.
```

---

## Privacy practices tab

### Single purpose

```
Let people operate web pages with hand gestures captured by the webcam, as an
alternative to a mouse and keyboard.
```

### Permission justifications

**host_permissions `<all_urls>`**
```
The extension replaces mouse and keyboard input on whatever page the user is
reading. It must draw the gesture overlay and dispatch scrolling, link selection
and clicks into that page. There is no way to know in advance which sites a
person who cannot use a mouse will need, so the permission cannot be narrowed to
a list of domains without breaking the accessibility purpose.
```

**`tabs`**
```
Gestures are delivered only to the tab the user is actually looking at. The
extension needs to know which tab is active in order to route recognized gestures
to it, and to stop sending them when the user switches away.
```

**`activeTab`**
```
Used together with scripting to reach the page the user is on when the extension
is switched on.
```

**`scripting`**
```
Content scripts declared in the manifest only load into pages opened after
installation. This permission injects the script into tabs that were already
open, so that gesture control works immediately instead of requiring the user,
who may not be able to use a mouse, to reload every tab.
```

**`storage`**
```
Stores the user's own settings: theme, left-handed mode, reach area, cursor
stability and scrolling speed. Nothing else is stored, and nothing leaves the
device.
```

**`offscreen`**
```
The camera and the hand-tracking model run in a single offscreen document. A
webcam is an exclusive resource, so one instance must serve the whole browser
instead of one per tab; and because the offscreen document has the extension's
own origin, the camera permission is granted once for the extension rather than
again on every site the user visits.
```

**Camera (requested at runtime)**
```
Hand tracking. Video frames are analysed on the user's machine and discarded
immediately; no image is stored or transmitted. The camera is only active while
the extension is switched on.
```

### Data usage disclosures

Tick **nothing**. The extension collects no user data of any kind:

- No personally identifiable information
- No health information
- No financial information
- No authentication information
- No personal communications
- No location
- No web history
- No user activity
- No website content

Then tick the three certification checkboxes:

- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://hands.hinow.ai/privacy
```

Publish `store/privacy-policy.md` at that address before submitting, because the
Web Store requires a reachable privacy policy for any extension that requests
the camera.
