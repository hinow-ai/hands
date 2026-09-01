# Third-party notices

The extension package that ships to users (`dist/`, and the `.zip` uploaded to the Chrome Web
Store) embeds third-party software. This file names it and preserves the attribution those
licences require. It is copied into the build so that it travels inside the published package,
not only inside this repository.

Nothing listed here changes where the video goes: everything below runs locally, on the user's
own machine, and none of it makes a network request at runtime.

---

## MediaPipe Tasks Vision

- **Package**: [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- **Copyright**: © Google LLC
- **Licence**: Apache License 2.0
- **What we ship**: the WebAssembly runtime, copied into `dist/wasm/` by `build.mjs`.
- **Why**: it runs the hand-tracking model in the browser, offline.

Licensed under the Apache License, Version 2.0. You may obtain a copy of the licence at
<http://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software distributed under the
Licence is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
either express or implied. See the Licence for the specific language governing permissions and
limitations under the Licence.

---

## MediaPipe Hand Landmarker model

- **File**: `hand_landmarker.task`
- **Copyright**: © Google LLC
- **Source**: downloaded at build time by `npm run fetch:model` from Google's model storage.
- **Terms**: see the
  [Hand landmarks detection model card](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker),
  which covers intended use and limitations.
- **What we ship**: the model file, copied into `dist/models/`.
- **Why**: it turns a camera frame into 21 hand landmarks. The model is bundled rather than
  fetched at runtime so that recognition works with no network at all.

The model is not versioned in this repository. `scripts/fetch-model.mjs` downloads it on demand,
and `models/` is in `.gitignore`.

---

## Everything else

The gesture vocabulary, the filters, the hand geometry, the pointer mapping, the overlay and the
event synthesis in `src/` are original work, licensed under the terms in [LICENSE](LICENSE).
