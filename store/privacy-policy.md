# Privacy Policy: hands.hinow.ai

**Last updated: 31 August 2026**

hands.hinow.ai is a Chrome extension that lets a person operate web pages with
hand gestures captured by their webcam, as an alternative to a mouse and
keyboard.

## The short version

**We collect nothing.** No account, no analytics, no telemetry, no crash
reports. The extension makes no network requests at all.

This is not only a promise. The extension declares `connect-src 'self'` in its
content security policy, so the browser itself blocks any outbound request from
its pages, including from third-party libraries bundled inside it. The
hand-tracking library we use ships with an optional logging client; that
restriction makes it inert, and you do not have to take our word for it.

## The camera

The extension asks for camera access because hand tracking is the whole point of
it. What happens to that video:

- Each frame is read into memory on your own computer, analysed by a hand-
  tracking model that ships inside the extension, and **discarded immediately**.
- **No frame is ever stored**: not on disk, not in the browser, not in memory
  beyond the instant it is being analysed.
- **No frame is ever transmitted.** No image, no video, and no derived data
  leaves your machine.
- What crosses between the parts of the extension is the recognized gesture
  (for example, "open hand") and a handful of coordinates, never the picture.
- The camera runs **only while the extension is switched on**. Turning it off
  releases the camera and the light on your webcam goes out.

The hand-tracking model is bundled in the extension package, so recognition
works with no internet connection.

## What is stored on your device

Your own settings, in the browser's local extension storage:

- Theme (light or dark)
- Left-handed mode
- Whether the on-screen instructions, the status bar and the fingertip markers
  are shown
- Reach area, cursor stability and scrolling speed

These never leave your device, and are removed when you uninstall the extension.

## Page access

To replace mouse and keyboard input, the extension needs to act inside whatever
page you are reading: draw the gesture panels, move the selection between links,
scroll, and click. It reads page structure for that purpose only: which
elements are links or buttons, and where they are on screen.

It does not read, collect or transmit the content of the pages you visit, your
browsing history, form data, passwords, or anything you type.

## Third parties

There are none. No advertising, no analytics providers, no cloud services, no
data sharing, no data sale.

## Children

The extension collects no data from anyone, including children.

## Changes

If this policy ever changes, the new version will be published at this address
with an updated date. Because the extension collects nothing, we do not expect
material changes.

## Contact

Questions about this policy: open an issue at
https://github.com/hinow-ai/hands/issues or write to the address listed at
https://hands.hinow.ai
