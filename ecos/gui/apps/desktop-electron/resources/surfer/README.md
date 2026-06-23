# Bundled Surfer Web Assets

These files are vendored from the Surfer web viewer so ECOS Studio can open
waveforms without runtime network access.

- Source: `https://app.surfer-project.org/`
- Upstream project: `https://gitlab.com/surfer-project/surfer`
- License: EUPL-1.2, see `LICENSE-EUPL-1.2.txt`

The Electron `ecos-surfer://viewer/` protocol serves this directory directly.
Do not reintroduce runtime fetches to `app.surfer-project.org`; waveform viewing
must work offline.
