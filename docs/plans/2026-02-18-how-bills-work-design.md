# How Bills Work -- Interactive Legislative Process Modal

## Overview

An interactive, educational modal launched from the "Learn" section of the v2 frontend dashboard. Users explore the full legislative pipeline as a visual flowchart, adjust political environment variables (party control, sponsor affiliation, bill topic), and see how those changes affect bill passage probabilities at every stage. Real stats from the current Congress supplement a simple simulation rules engine.

## Layout

Full-screen modal (95vw x 90vh) using the existing `ModalComponent` at `size: full`. Three zones:

```
+================================================================+
|  How a Bill Becomes Law                              [X Close]  |
+================================================================+
|                                                                  |
|  ┌──────────────── THE PIPELINE MAP (~40%) ─────────────────┐   |
|  │                                                           │   |
|  │  [Intro] ──> [Committee] ──> [Floor] ──> [Other Chamber] │   |
|  │                  │              │              │           │   |
|  │              [Tabled]       [Failed]      [Conference]    │   |
|  │                                               │           │   |
|  │                              [President] ──> [Law]        │   |
|  │                                  │                        │   |
|  │                              [Vetoed] ──> [Override?]     │   |
|  └───────────────────────────────────────────────────────────┘   |
|                                                                  |
|  ┌── ENVIRONMENT CONTROLS ────┐  ┌── STAGE DETAIL ───────────┐  |
|  │  (~40% width, ~60% height) │  │  (~60% width, ~60% height)│  |
|  │                             │  │                            │  |
|  │  Sponsor Party: [D] [R] [I]│  │  Content for selected      │  |
|  │  House Majority: slider     │  │  stage appears here        │  |
|  │  Senate Majority: slider    │  │                            │  |
|  │  Bill Topic: dropdown       │  │                            │  |
|  │  Bill Type: toggle          │  │                            │  |
|  │                             │  │                            │  |
|  │  [This Congress] baseline   │  │                            │  |
|  └─────────────────────────────┘  └────────────────────────────┘  |
+==================================================================+
```

## Zone 1: The Pipeline Map

### Nodes

Each legislative stage is a rounded rectangle containing:

- **Stage name** (e.g., "Committee")
- **Probability badge** -- percentage likelihood a bill advances past this point (e.g., "6% advance")
- **Heat color fill** -- green (>30%), gold (10-30%), red (<10%)

### Connections

- **Solid arrows** between nodes on the main path: Introduction -> Committee -> Floor Vote -> Other Chamber -> President -> Law
- **Dashed arrows** to branching/terminal outcomes: Tabled, Failed, Vetoed, Conference, Override

### Stages in the map

| Node | Happy-path position | Branch outcomes |
|------|---------------------|-----------------|
| Introduction | 1st | -- |
| Committee | 2nd | Tabled (bill dies) |
| Floor Vote | 3rd | Failed (doesn't pass) |
| Other Chamber | 4th | Conference Committee (versions differ) |
| Conference | Branch from Other Chamber | -- |
| President | 5th | Vetoed |
| Vetoed | Branch from President | Override Attempt |
| Became Law | Terminal | -- |

### Interaction

- Clicking a node selects it (gold border + subtle glow), populates Stage Detail panel
- Probability badges animate on environment control changes (counter-style number roll, 300ms)
- Heat colors transition smoothly (400ms CSS)
- Selected node has scale(1.05) emphasis

## Zone 2: Environment Controls

### Controls

1. **Sponsor's Party** -- Three toggle buttons: D | R | I
2. **House Majority** -- Segmented slider: Strong D | Lean D | Even | Lean R | Strong R
3. **Senate Majority** -- Same segmented slider
4. **Bill Topic Area** -- Dropdown: Healthcare, Defense, Economy, Environment, Immigration, Infrastructure, Education, Other
5. **Bill Type** -- Toggle: Standard Bill | Budget/Appropriations

### Rules engine

A simple, deterministic rules engine (not statistical modeling) computes probability modifiers at each stage:

**Party alignment effects:**
- Same-party sponsor + majority = higher committee passage, faster floor scheduling
- Opposite-party sponsor vs. majority = higher committee burial, lower floor vote probability
- Independent sponsor = moderate baseline everywhere

**Margin effects:**
- Strong majority = more predictable outcomes (higher highs, lower lows)
- Even split = high uncertainty, conference stage more likely
- Lean = moderate effects

**Topic effects:**
- Bipartisan topics (infrastructure, defense) = reduced partisan penalty
- Partisan topics (healthcare, immigration) = amplified partisan effects

**Bill type effects:**
- Budget/Appropriations = bypass Senate filibuster, different committee routing, higher passage rates in reconciliation context

### Scenario summary

A generated sentence above the controls:
> "A Republican-sponsored healthcare bill in a Democratic-majority House faces steep odds..."

### "This Congress" baseline

Toggle or link that resets all controls to match the actual current political makeup and displays real database stats.

## Zone 3: Stage Detail Panel

### Content structure (consistent for all stages)

1. **Stage Title** -- e.g., "Committee Stage"
2. **What Happens** -- 2-3 plain-language sentences
3. **Key Players** -- Who holds power at this stage
4. **What Can Happen** -- Possible outcomes/branches, with icons:
   - ✓ Positive outcome (advances)
   - ✗ Negative outcome (dies/fails)
   - ↻ Lateral outcome (referred, amended)
5. **This Congress** (data box) -- Real stats from the database:
   - Count of bills at this stage
   - Passage/advancement rate
   - Average time at stage
6. **Simulation Insight** (dynamic) -- Generated sentence explaining how the current environment settings affect THIS specific stage

### Default state

When no stage is selected:
> "Click any stage on the map to learn what happens there. Adjust the controls on the left to see how political conditions change the odds."

### Transitions

- Stage content fades in (200ms) on stage change
- Simulation Insight updates in-place with fade on environment control change

## Visual Design

### Colors

- Gold accent from Learn section: `--color-gold` (#b8860b), `--color-gold-bg` (#faf8f0)
- Heat system: green (#2d6a4f / `--color-success`), gold (#b8860b), red (#9b2c2c / `--color-danger`)
- Selected node: gold border with subtle glow
- Connections: `--color-border-secondary` with probability-based opacity

### Typography

- Node stage names: `Source Sans 3`, semibold
- Panel section headings: `Source Sans 3`, uppercase, 0.15em letter-spacing (matching `module-title`)
- Probability badges: `JetBrains Mono` (monospace)
- Scenario summary: `Source Serif 4`, italic
- Body text: `Source Sans 3`, regular

### Animations

- Probability counter: 300ms ease-out number roll
- Heat color shift: 400ms CSS transition
- Stage detail content: 200ms fade-in
- Node selection: scale(1.05) + gold glow, 200ms

## Accessibility

- All map nodes are `<button>` elements with `aria-label` (e.g., "Committee stage, 6% advancement rate")
- Environment controls use native HTML inputs (`<input>`, `<select>`) with `<label>` elements
- Probability changes announced via `aria-live="polite"` region
- Focus trap within modal (existing `ModalComponent` behavior)
- ESC closes modal, Tab cycles through interactive elements
- Color is never the sole indicator -- text values supplement heat colors

## Data Requirements

### From the database (on modal open)

Stats for each legislative stage in the current Congress:
- Bills at each stage (count)
- Advancement rate (percentage)
- Average days at stage

These can be computed from existing `bills` table data using the `BillJourney` stage logic already in the codebase.

### Static content

Pre-written educational content for each stage (What Happens, Key Players, What Can Happen). This is baked into the component, not fetched from an API.

### Rules engine

Client-side JavaScript. No API calls needed for simulation -- all probability calculations happen in the browser based on the control settings and a predefined rules table.

## State on Modal Open

- Environment controls default to "This Congress" (current political reality from DB)
- No stage pre-selected (welcome message in detail panel)
- Map shows probabilities based on current Congress baseline
- "This Congress" data box populated from single API call

## Responsive Behavior

Optimized for desktop (this is a full-screen exploration tool). On smaller viewports:
- Map switches to vertical timeline layout
- Environment controls and stage detail stack vertically
- Controls collapse behind a toggle button
