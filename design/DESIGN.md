---
name: Vaultline
colors:
  surface: '#f6fafd'
  surface-dim: '#d6dbdd'
  surface-bright: '#f6fafd'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4f7'
  surface-container: '#eaeef1'
  surface-container-high: '#e5e9ec'
  surface-container-highest: '#dfe3e6'
  on-surface: '#171c1f'
  on-surface-variant: '#3d4946'
  inverse-surface: '#2c3134'
  inverse-on-surface: '#edf1f4'
  outline: '#6d7a76'
  outline-variant: '#bcc9c4'
  surface-tint: '#006b5b'
  primary: '#006859'
  on-primary: '#ffffff'
  primary-container: '#008471'
  on-primary-container: '#f4fffa'
  inverse-primary: '#6ed9c2'
  secondary: '#516071'
  on-secondary: '#ffffff'
  secondary-container: '#d2e1f6'
  on-secondary-container: '#556476'
  tertiary: '#8d4b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#b15f00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#8bf5de'
  primary-fixed-dim: '#6ed9c2'
  on-primary-fixed: '#00201a'
  on-primary-fixed-variant: '#005144'
  secondary-fixed: '#d5e4f9'
  secondary-fixed-dim: '#b9c8dc'
  on-secondary-fixed: '#0e1d2c'
  on-secondary-fixed-variant: '#3a4859'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#f6fafd'
  on-background: '#171c1f'
  surface-variant: '#dfe3e6'
typography:
  display-lg:
    fontFamily: Sora
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Sora
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-xl:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-xl-mobile:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Sora
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Sora
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: IBM Plex Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  numeric-balance:
    fontFamily: Sora
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  numeric-table:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The brand personality conveys institutional durability, cryptographic precision, and operational clarity. It serves high-net-worth operators, treasury leads, and modern banking customers who require transparent control over capital flows without visual noise or consumer gimmicks.

The visual style is **Corporate Modern with Tactile Precision**. It pairs institutional authority with fine-tuned software ergonomics:
- Deep navy ink anchors structural hierarchy, replacing stark black with high-density oceanic neutrality.
- Pure white container surfaces float over a cool, architectural mist canvas.
- Razor-sharp 1px border lines and calibrated ambient drop shadows establish physical presence.
- Sentence-case microcopy maintains an unhurried, expert demeanor across all transaction interfaces.

## Colors

The palette balances fiscal authority with instantaneous state recognition:

- **Primary Accent (`#0B8F7B`):** Applied exclusively to confirmed paths, positive yield states, verification signals, and key conversion paths. Hover shifts deeper to `#087363`.
- **Deep Navy Ink (`#0C1B2A`):** The structural spine of the interface. Governs brand presence, primary typography, and persistent navigational anchors. Elevated dark panels use Surface Dark (`#112233`).
- **Cool Mist Base (`#EEF2F5`):** The ambient canvas background, preventing screen glare during intensive analytical workflows.
- **Card Surface (`#FFFFFF`):** High-clarity focal areas for data modules and forms, partitioned by structural borders (`#E2E8F0` / `#D5DFE7`).
- **Muted Text (`#52657A`):** Supports visual hierarchy without dropping below WCAG AA legibility thresholds for metadata, timestamps, and column descriptors.
- **System States:**
  - Warning/Alert: `#D97706` text/stroke with `#FEF3C7` background tint.
  - Fraud/Debit Red: `#DC2626` text/stroke (active hover `#B91C1C`) with `#FEE2E2` backdrop.

## Typography

Typographic structure balances geometric authority with dense technical legibility:

- **Sora** anchors high-impact focal points: account balances, card headers, and critical modal confirmations. It is deployed in weights 600 and 700.
- **IBM Plex Sans** drives operational density across lists, forms, audit logs, and transaction tables. It handles high-density data parsing cleanly across weights 400, 500, and 600.
- **Tabular Figures Rule:** All numerical assets—ledgers, balances, timestamps, exchange rates, and transaction IDs—must declare `font-variant-numeric: tabular-nums` to maintain vertical decimal alignment across multi-row feeds.
- **Casing Protocol:** Use sentence-case exclusively across badges, column titles, button triggers, and tab markers. Never employ all-caps styling.

## Layout & Spacing

The interface employs a fixed fluid-hybrid grid engineered for mission-critical oversight:

- **Desktop (1200px+):** 12-column grid, max width 1440px centered, with `2rem` outer canvas margins and `1.5rem` gutters. Layout reserves a persistent 280px left rail for primary entity management and account navigation.
- **Tablet (768px - 1199px):** 8-column layout with `1.5rem` margins and `1rem` gutters. The left rail condenses to a fixed icon-only dock (72px), while data tables enable horizontal touch-panning.
- **Mobile (<768px):** 4-column fluid stack with `1rem` margins and `1rem` gutters. High-level net worth modules collapse vertically, and secondary navigation migrates to a pinned bottom bar.
- **Grid Discipline:** Component paddings strictly align with `space-md` (`1rem`) and `space-lg` (`1.5rem`), establishing rhythmic card interiors and balanced separation between financial rows.

## Elevation & Depth

Visual hierarchy uses crisp boundary delineation paired with shallow, ink-tinted ambient shadows rather than blurry, saturated glows:

- **Base Layer (Level 0):** Canvas at `#EEF2F5`. Flush data displays and input wells utilize a recessed `#E2E8F0` hairline border without elevation.
- **Card Layer (Level 1):** Main dashboard modules, data tables, and summary cards rest on `#FFFFFF` surfaces with a 1px border (`#E2E8F0`) and an ambient anchor shadow:
  `box-shadow: 0 1px 3px rgba(12, 27, 42, 0.06), 0 8px 24px rgba(12, 27, 42, 0.04);`
- **Elevated Overlay Layer (Level 2):** Context menus, quick-action sheets, and popovers maintain `#FFFFFF` backgrounds with an accented border (`#D5DFE7`) and an expanded depth shadow:
  `box-shadow: 0 4px 6px -1px rgba(12, 27, 42, 0.08), 0 16px 32px -4px rgba(12, 27, 42, 0.08);`
- **Modal Barrier (Level 3):** Verification drawers and transaction signing dialogs float above a scrim tinted `#0C1B2A` at 40% opacity with a 4px backdrop blur (`backdrop-filter: blur(4px)`).

## Shapes

The design system maintains consistent geometry:

- **Cards, Panels, and Drawers:** Use uniform `12px` to `14px` border-radii (`rounded-xl`), balancing architectural structure with modern software ergonomics.
- **Interactive Controls:** Form inputs, action triggers, segmented pills, and status tags adhere to `8px` (`rounded-md`) to `12px` curves.
- **Micro-Indicators:** Inline status pips and circular counter badges retain full circular roundness (`rounded-full`).

## Components

### Buttons & Interactive Targets
- **Physical Envelope:** All buttons, touch targets, and inputs enforce a strict minimum touch boundary of `46px` (e.g., `h-[46px]`, `min-h-[46px]`).
- **Primary Action:** Solid teal fill (`#0B8F7B`) with white text (`#FFFFFF`), `font-weight: 500`. Hover state: `#087363`. Focus indicator: `ring-2 ring-[#0B8F7B] ring-offset-2`.
- **Secondary Action:** Ghost white fill with Deep Navy text (`#0C1B2A`) and a 1px border (`#D5DFE7`). Hover state: background `#F8FAFC`.
- **Destructive Action:** White surface with `#DC2626` text and border `#FEE2E2`. Hover shifts to `#FEE2E2` fill.

### Input Fields & Controls
- **Form Wells:** Background `#FFFFFF`, 1px stroke `#D5DFE7`, height fixed at `48px`, horizontal interior padding `16px`.
- **Focus Mechanism:** Crisp `ring-2 ring-[#0B8F7B] ring-offset-1` with border transition to `#0B8F7B`.
- **Selection Controls:** Checkboxes and radio buttons enforce an `18px` geometric base inside a `46px` touch target wrapper. Active fills use `#0B8F7B` with white iconography.

### Status Chips & Badges
- **Clearance Tags:** Padding `4px 10px`, radius `6px`. Font size `12px`, weight `500`, sentence-case only.
- **Positive / Cleared:** `#0B8F7B` text over a 10% alpha teal wash.
- **Pending / Warning:** `#B45309` text over `#FEF3C7` background.
- **Failed / Flagged:** `#B91C1C` text over `#FEE2E2` background.

### Cards & Ledger Tables
- **Container Structure:** `#FFFFFF` background, 1px perimeter border (`#E2E8F0`), `14px` radius. Interior padding defaults to `24px` (`space-lg`).
- **Table Data Rows:** Row height standard `56px`. Alternating rows preserve `#FFFFFF` with a bottom divider `#EEF2F5`. Hover row triggers a subtle transition to `#F8FAFC`.
- **Ledger Alignment:** Text strings align left; dates and ledger types center; transaction values, currency conversions, and balances align right with tabular figures enabled.

### Verification Dialogs (Vaultline Security)
- Dedicated modal structures reserved for step-up multi-factor authorization and wire confirmation. Includes a prominent navy header bar, cryptographic hash/reference display in a monospaced block, and side-by-side balanced actions with primary verification right-aligned.