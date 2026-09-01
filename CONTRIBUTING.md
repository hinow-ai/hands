# Contributing

Thank you for looking. This project exists so that people who cannot use a mouse can use the
web, so the bar for a change is simple: does it make the extension work for more people, or
work more reliably for the people it already serves?

## Reporting what broke

The most useful report says three things: **what was not recognised**, **what was recognised
when you did not mean it**, and **which site it got stuck on**. Camera model, lighting and
whether you were backlit help more than they sound like they would.

## Running it

```bash
npm install
npm run fetch:model     # downloads the hand landmark model, once
npm run build           # then load dist/ as an unpacked extension
npm test                # the gesture engine
npm run demo            # a page with targets of decreasing size
```

`npm run test:legacy` compares against the detector this project replaced. That detector lives
outside this repository, so the test skips unless you point `LEGACY_DETECTOR` at a copy of it.

## A gesture is not merged until it is reliable

Half-working commands are worse than missing ones. Someone who cannot use a mouse has no
fallback when a gesture misfires, and a command that works four times out of five teaches them
not to trust the whole product. A new gesture needs to survive a bad camera, uneven light and a
hand that shakes before it goes in.

## Translations

Translations live in `public/_locales/<lang>/messages.json` and are very welcome.

**One security rule, and it matters.** Most of those strings are inserted as text, but a few
keys marked `data-i18n-html` are inserted as HTML, because they carry a link. A translation is
code as far as those keys are concerned: a string like `<img src=x onerror=...>` in one of them
would execute inside the extension's own pages, which have access to the `chrome.*` APIs.

So: never add HTML to a key that did not already have it, and expect the `data-i18n-html` keys
to be reviewed by hand. If your language needs markup somewhere new, say so in the pull request
instead of adding it quietly.

## Style

Comments explain **why**, not what. The code is commented in Portuguese, and that is fine to
continue; the user-facing strings are the ones that must exist in both languages.

One thing that is not style: **no em dashes in user-facing text**, in either language. Use a
colon, a comma or a full stop.
