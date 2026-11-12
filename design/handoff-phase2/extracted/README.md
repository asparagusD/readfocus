# Extracted sources

Two pages decoded from `../design_phase_2.html`, byte for byte, so they can
be read without opening the bundle. The bundle stores each board as a
gzipped, base64 page in its `__bundler/manifest` script; the phase-2
boards are pages with their own nested manifest.

- `Study.dc.html`: the phase-2 Design Component behind the prototype and
  the four phase-2 screen boards (its `stage` prop picks one of 18
  screens). In the bundle it is the nested manifest entry the screen
  boards import as `./Study.dc.html`; all four copies are identical.
- `PhaseTwoComponents.dc.html`: the "Phase 2 components — paper &
  lamplight" board's page template. Its font and script references are
  the bundle's internal ids and do not resolve outside it.

Like the phase-1 handoff, these are reference mockups: replicate their
values, do not copy their markup. Neither renders on its own (they need
the dc-runtime that the bundle carries); open `../design_phase_2.html` in
a browser to see the boards.
