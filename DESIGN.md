# DESIGN.md: Apotek OS design system ("Klinik Tenang")

The one visual language for every surface: landing page, demo, POS counter,
prescription queue, inventory, back office. Chosen 6 Oct 2026 from four prototyped
directions (option A). Tokens and primitives live in `packages/ui` (`@apotek/ui`);
this file explains them. If code and this file disagree, fix one of them in the same
change.

## Character

Calm and clinical. A pharmacy is a place of trust and precision, so the interface is
quiet: cool neutrals, one deep pharmacy green, real numbers set in a monospace, and
colour that only ever means something.

1. **Colour is state, not decoration.** Green is the action and "what happens next".
   Amber is "attention soon" (near expiry, waiting to sync). Red is "blocked or
   wrong" (expired, prescription-only at the till). Nothing else is coloured.
2. **Numbers are data.** Batch numbers, quantities, prices, sale numbers and dates
   that are compared are set in Geist Mono with tabular figures.
3. **Show the real thing.** A stock card computed from the domain beats an
   illustration of one. No fake screenshots, no invented metrics.
4. **Borders before shadows.** Surfaces are separated by 1px lines. A shadow means the
   thing floats over something else.
5. **Quiet motion.** Motion confirms a change of state. It never decorates.

## Using it in an app

```css
/* the app's Tailwind v4 entry stylesheet */
@import "tailwindcss";
@import "@apotek/ui/tokens.css";
@source "<relative path>/packages/ui/src";
```

Add `@apotek/ui` to the app's dependencies (and to `transpilePackages` in Next.js),
load Geist and Geist Mono so `--font-geist-sans` / `--font-geist-mono` exist (the
`geist` package does this), then import primitives:

```tsx
import { Button, Chip, Panel, Segmented, Stepper, Switch, Tabs, Wordmark } from "@apotek/ui";
```

## Colour

Every colour token holds a light and a dark value (`light-dark(light, dark)` in
`tokens.css`). `packages/ui/test/tokens.test.ts` fails the build if one is missing or
if a text pair below drops under WCAG AA (4.5:1) in either theme.

### Theme

| Surface | Theme | How |
|---|---|---|
| Frontstore: landing page, demo | **Always light** (decided 6 Oct 2026) | No `data-theme` on `<html>`; viewport `colorScheme: "light"` |
| App: POS, admin, back office | Light and dark | `data-theme` on `<html>`: `system` follows the device, `dark` / `light` from a user toggle |

Tailwind's `dark:` variant follows the same attribute, so `dark:` utilities do nothing
on the frontstore. Prefer tokens over `dark:` overrides; reach for `dark:` only for
things tokens can't express (for example dimming photos in the app).

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f4f6f5` | `#0c100e` | Page background |
| `surface` | `#fbfcfb` | `#131916` | Panels, inputs, raised cards |
| `sunk` | `#eaeeec` | `#0f1412` | Wells: segmented tracks, table headers, empty slots |
| `ink` | `#121715` | `#e6ece9` | Text |
| `muted` | `#56615c` | `#98a59f` | Secondary text, labels |
| `line` | `#d6ddd9` | `#26302b` | Borders and rules |
| `accent` | `#0b6e52` | `#4cc39b` | Primary action, "next", focus ring |
| `accent-hover` | `#095c45` | `#63d0ab` | Primary hover |
| `accent-ink` | `#f1faf6` | `#062419` | Text on `accent` |
| `accent-soft` | `#dcefe7` | `#15372b` | Tinted rows and cells (the batch that sells next, hints) |
| `accent-soft-ink` | `#0b6e52` | `#8fe0c2` | Text on `accent-soft` |
| `warn` / `warn-soft` | `#8a4b00` / `#f8ead3` | `#f0b45c` / `#3a2a12` | Near expiry, waiting to sync, offline |
| `danger` / `danger-soft` | `#a3241a` / `#f8dfdb` | `#f08a7e` / `#3d1a16` | Expired, blocked, errors, prescription-only at the till |

Never introduce another hue. Never use pure `#000` or `#fff`.

## Type

- **Geist** for everything, **Geist Mono** (`font-mono tabular-nums`) for data.
- Body 17px on desktop, 16px on phones, line-height 1.6.
- Marketing scale (landing and demo only): `text-display` (hero, max 2 lines),
  `text-title` (section headings, `text-balance`), `text-lead` (intro paragraphs,
  `text-muted`, max ~58ch).
- Operational screens use Tailwind's default sizes; labels are `text-[0.82rem]
  font-medium text-muted`, never uppercase.
- The small uppercase "eyebrow" label is marketing-only, and at most one per three
  sections.
- Negative quantities use the minus sign `−` (U+2212), not a hyphen.

## Shape

| Thing | Radius | Class |
|---|---|---|
| Controls: buttons, inputs, segmented controls, tabs, rows inside panels | 8px | `rounded-control` |
| Panels: cards, tables, photos, dialogs, the demo | 16px | `rounded-panel` |
| Status chips, switches, progress pips | full | `rounded-full` |

Elevation: `border border-line` by default. `shadow-panel` only for something that
floats (the hero stock card, the demo, a dialog, the mobile tour dock).
`shadow-control` is the selected state inside a segmented control or tab list.

## Layout

- Content width 1200px with 40px gutters (28px tablet, 20px phone).
- Marketing sections breathe (`py-20` to `py-28`). Operational screens are denser and
  phone-first: verify at 390px, touch targets at least 44px on the POS.
- Every multi-column layout states its single-column fallback under 768px.

## Primitives (`@apotek/ui`)

| Primitive | Rules |
|---|---|
| `Button` / `buttonClass()` | `primary` once per view (the main action), `secondary` for the alternative, `ghost` for low-stakes controls such as reset. Sizes `md` (48px) and `sm` (38px). Labels stay on one line. Pressed state moves 1px. Use `buttonClass()` on links. |
| `Chip` | Tones carry meaning: `next`, `ok`, `warn`, `danger`; `neutral` and `outline` for plain labels. |
| `Panel` / `panelClass()` | Bordered surface. `raised` adds the panel shadow. |
| `Segmented` | One choice from a few (units, modes). Native radios, so keyboard and screen readers work. |
| `Switch` | On/off with its state label beside the track (`Online` / `Offline`). |
| `Tabs` + `tabPanelProps()` | Roving focus: arrow keys, Home, End. Counts as small mono badges; `warn` tone for things waiting. |
| `Stepper` | Minus, value, plus. Value is display-only. |
| `Wordmark` | Pill glyph on an accent tile, then the product name. |

## Domain patterns

These recur on every surface; keep them identical.

- **Stock card.** One row per batch, sorted by expiry. Expired or blocked batches
  stay visible, batch number struck through in `danger`, with a `danger` chip. The
  batch that sells next gets an `accent-soft` row and a `next` chip (or a 3px accent
  inset bar in tables). Quantities as a unit breakdown (`1 strip + 4 tablet`).
- **FEFO preview.** Before a sale, list the batches it will take. Blocked batches that
  still hold stock are listed first, struck through, with the reason ("kedaluwarsa,
  dilewati"). That is the line people need to see.
- **Ledger rows.** Append-only. Event, reference number, product and batch, signed
  quantity (positive in `accent`). Rows waiting to sync have a dashed `warn` border and
  say so. New rows flash `accent-soft` once (`.fresh`).
- **Sync log.** One line per send attempt with an outcome chip: accepted `ok`,
  duplicate ignored `neutral`, conflict `danger`.

## Icons

Phosphor only, regular weight by default (`bold` inside small controls). Server
components import from `@phosphor-icons/react/ssr`. Icons are `aria-hidden` next to
text. No hand-drawn SVG icons, no emoji.

## Motion

- Transitions 150 to 300ms on colour, transform and opacity only.
- Marketing: one hero load-in (`.enter`) and scroll-driven reveals (`.reveal`, CSS
  `animation-timeline: view()`), never hiding content that waits for JavaScript.
- Operational: only state changes (a row appended, a notice appearing, a tab
  switching).
- Everything stops under `prefers-reduced-motion: reduce`.

## Copy

- Indonesian first; English must match it key for key (`copy.ts` type-checks this).
- No em or en dashes in visible text.
- No regulatory or compliance claims without a dated source (see `CLAUDE.md`).
- Plain functional labels over clever ones.

## Photography

Real pharmacy scenes, `object-cover`, explicit aspect ratio. In app screens with dark
on, dim photos slightly (`dark:brightness-[0.86] dark:saturate-[0.92]`). Current photos are Unsplash stand-ins from non-Indonesian pharmacies
(`apps/web/src/assets/photos/CREDITS.md`); replace them with photos of a real apotek
before launch.

## Who uses which skill

The tokens and primitives are shared. Landing and demo work goes through the `taste`
skill; admin, POS and back-office screens go through `impeccable`, which must treat
this file as the source of truth for tokens and components.
