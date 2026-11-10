---
name: design-review
description: "Use for every UI change in this repo, before committing anything under frontend/src that affects what the reader sees: pages, components, styles, tokens, motion, images, copy. Chains impeccable -> taste-skill (installed as design-taste-frontend) -> ui-ux-pro-max, then runs the project checklist (hierarchy, spacing, type scale, WCAG AA contrast, focus, reduced motion, states, 375 px and 1440 px, keyboard, no generic AI look) and requires a before/after note in the commit body."
---

# Design review

Every UI change passes this review before it is committed. The goal is a
cozy, sophisticated interface that feels like reading a real book: calm,
warm, typographic, never flashy.

## What decides the design

When sources disagree, the higher one wins:

1. **The Claude Design handoff in `design/`**, where one exists for the
   screen. Match it. If it looks wrong, ask the user; do not redesign it.
2. **The project's tokens** (colour, type, spacing, motion) in
   `frontend/src`.
3. **This checklist.**
4. **The three design skills.** They inform and critique. They do not
   override 1–3.

`design/` does not exist yet. Until a handoff lands, the existing look
described in `README.md` (warm ink tones, Playfair Display headings, Lora
body, DM Sans UI) is the reference.

## The chain

Run the three skills in this order. Each has a different job; do not skip
one because an earlier one passed.

### 1. `impeccable`: direction and craft

Load `impeccable` and follow its Setup. ReadFocus screens are its **Operate**
mode (library, dashboard, test, results) or **Read** mode (the reading
session). Use the command that fits the change:

- new or reworked screen: `shape`, then build;
- finished change: `critique` for the design, `audit` for accessibility,
  performance and responsiveness;
- last pass before commit: `polish`.

### 2. `taste-skill`: anti-slop pass

The skill is installed as `design-taste-frontend`; load it by that name. It
is written for marketing websites, so use it here as a critic, not a
blueprint:

- **Apply**: its checklist and "Never" list for generic, templated or
  AI-looking output, plain copy, equal edges, real content instead of filler.
- **Do not apply**: its page plans and house rules for landing pages (one
  section per screen, hero entrances, dealt moments, shader scenes, stock
  photography quotas). A reading app is not a landing page.

### 3. `ui-ux-pro-max`: rules check

Load `ui-ux-pro-max` and check the change against its priority rules:
accessibility and touch/interaction first, then performance, layout and
responsive, typography and colour, animation. Use its search for the specific
component or pattern being changed. Do not let it generate a new design
system or palette; the project's tokens stand.

If a skill is missing on this machine, say so, continue with the others and
the checklist, and record the gap in the commit's `Notes`.

## Checklist

Every item is checked in a running browser, not by reading the code.

**Layout and type**

- [ ] **Hierarchy**: one clear primary element per screen; the eye knows
  where to start.
- [ ] **Spacing rhythm**: all gaps come from the spacing scale; no one-off
  pixel values.
- [ ] **Type scale**: sizes, weights and line heights come from the type
  tokens; body text has a comfortable measure for long reading.

**Accessibility**

- [ ] **WCAG AA contrast**: 4.5:1 for body text, 3:1 for large text and for
  UI components and focus indicators. Measure it; do not judge by eye.
- [ ] **Visible focus states** on every interactive element, never removed
  without a replacement.
- [ ] **Keyboard navigation**: the whole flow works with Tab, Shift+Tab,
  Enter, Space and Escape; focus order follows reading order; modals trap
  and restore focus.
- [ ] **`prefers-reduced-motion`** is honoured: non-essential motion is
  removed or reduced.

**Motion**

- [ ] Animate **only `transform` and `opacity`**. No animating layout
  properties, and no `transition: all`.
- [ ] **Durations and easings come from the motion tokens**, not literals.

**Content and states**

- [ ] **Matches the handoff** in `design/` where one exists; differences are
  listed and justified.
- [ ] **Images** have explicit width and height (or aspect ratio), are
  lazy-loaded below the fold, are sized for their slot, and each one's
  source and licence is logged.
- [ ] **Empty, loading and error states** are designed for every view that
  loads data.

**Viewports**

- [ ] Checked at **375 px** wide: no horizontal scroll, touch targets large
  enough, text readable.
- [ ] Checked at **1440 px** wide: content does not stretch into
  unreadable line lengths.

**No generic "AI look"**

- [ ] No purple or blue-to-purple gradients.
- [ ] No glassmorphism (frosted, blurred translucent panels).
- [ ] No emoji used as icons.
- [ ] No centred-everything hero.

### Known gaps in the current frontend

Found when this skill was written (C1.6). They are existing debt, not
regressions, but new work must not add to them, and a change that touches
one of these files should fix it there:

- There are no motion tokens yet; durations are literals such as
  `150ms ease-out`.
- `transition: all` is used in several stylesheets.
- No stylesheet contains a `prefers-reduced-motion` rule.
- There is no licence log for images yet. The first chunk that adds an image
  creates it; ask the user where it should live.

## Before/after note in the commit

Every UI commit body carries a short before/after note under `What` or
`Notes`:

```
Before/after:
- Before: the test timer sat inside the question card and scrolled away.
- After: the timer is fixed at the top right on 1440 px and under the
  header on 375 px.
- Checked: 375 and 1440, keyboard, AA contrast 7.2:1 (timer text),
  reduced motion.
```

State what the reader saw before, what they see now, and which checklist
items were verified and how. Only list checks that were run. A change that
was not viewed in a browser says so.

## Stop and ask

- The handoff and the checklist conflict.
- Passing the review needs a new dependency, font or image source.
- The change would remove or hide a user-facing feature.
