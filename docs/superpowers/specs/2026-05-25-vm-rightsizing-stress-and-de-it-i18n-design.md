# Design — VM Right-sizing & Stress extract + app-wide de/it localization

- **Date:** 2026-05-25
- **Status:** Approved (brainstorm) — pending implementation plan (`writing-plans`)
- **Author:** brainstorming session (Claude + Frederic Jacquet)

## Summary

Add a new data extract to vatlas that surfaces, per VM:

1. **Oversized** — allocation ≫ utilization (CPU and/or memory)
2. **Undersized** — utilization ≈ allocation (CPU and/or memory)
3. **Stressed** — runtime pressure symptoms (memory ballooning/swapping, CPU ready)

Surfaced in a **dedicated "Right-sizing" web view** and a **new PPTX slide** (not the HTML
report). All thresholds are **user-customizable ratios** with sensible defaults.

This requires teaching the RVTools parser two new sheets (`vMemory`, `vCPU`), because the
signals for ballooning, memory utilization, and CPU utilization are not in the data vatlas
parses today.

The same spec **also** folds in an app-wide **German (`de`) + Italian (`it`)** localization of
the existing 16 i18n namespaces (Workstream B), per the product owner's explicit direction.
The right-sizing feature ships in all four locales (`en`, `fr`, `de`, `it`).

## Background — the data reality (verified)

RVTools is a **point-in-time** export: it reads vCenter quickStats / current values. There is
**no historical "max over time" column** per VM. "Max … never more than X%" is therefore
interpreted as the **maximum across the snapshots the user loads** (vatlas already holds N
monthly exports in memory for trends). A single export = that one sample.

What vatlas parses **today** (from `vInfo` only): configured `vcpu`, configured RAM
(`vramMib`), consumed RAM (`inUseMib` = "In Use"/"Consumed"), provisioned storage, and
`cpuReadinessPercent` ("Overall Cpu Readiness").

What it does **not** parse today, but RVTools provides:

| Signal           | RVTools sheet · column        | Notes                                      |
| ---------------- | ----------------------------- | ------------------------------------------ |
| Active memory    | `vMemory` · Active            | working-set estimate (MiB)                 |
| Consumed memory  | `vMemory` · Consumed          | host RAM backing the VM (≈ vInfo "In Use") |
| Ballooned memory | `vMemory` · Ballooned/Balloon | host reclaiming guest RAM (MiB)            |
| Swapped memory   | `vMemory` · Swapped           | (MiB)                                      |
| CPU usage        | `vCPU` · Overall CPU usage    | current usage (MHz)                        |

CPU utilization denominator uses `vcpu × host-core-MHz` (`VHostRow.speedMhz`, already parsed),
**not** any RVTools "Max CPU" column (whose semantics are ambiguous across versions).

Sources consulted:
- [Nutanix sizing workshop — Analyzing RVTools Data](https://sizing-workshop.readthedocs.io/en/latest/datacollection/rvtools/rvtools.html)
- [RVTools 3.7 column reference (PDF)](http://wiki.webperfect.ch/images/5/53/RVTools.pdf)
- [RVTools 4.4.1 documentation overview](https://www.scribd.com/document/630805505/RVTools)
- [Virtualization DOJO — Monitor VMs with RVTools](https://virtualizationdojo.com/vmware/monitor-vms-rvtools/)

## Decisions (settled during brainstorm)

| Decision        | Choice                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| Parser scope    | Parse **`vMemory` + `vCPU`**                                                    |
| Labeling        | **Neutral measurement** + editable thresholds (ADR-0012; no verdict adjectives) |
| Placement       | **Dedicated "Right-sizing" view + new PPTX slide**                              |
| Memory basis    | Show **Active% and Consumed%**; threshold on **Active**                         |
| Data model      | **Parallel `VmUsage` record** (config stays on `VInfoRow`)                      |
| "max" semantics | **Max across loaded snapshots**; single export = single reading                 |
| Powered state   | **Powered-on VMs only**                                                         |
| HTML report     | **Excluded** — web + PPTX only                                                  |
| de + it         | **Folded into this spec** (Workstream B); right-sizing ships in 4 locales       |

---

# Workstream A — VM Right-sizing & Stress extract

## A1. Categories & definitions

Each category is evaluated **per-resource** (CPU and/or memory, independently), on
**powered-on VMs only**, using the **max across all loaded snapshots**. All thresholds are
**user-customizable** (editable controls), with these defaults:

**① Oversized** — allocation ≫ utilization
- CPU: `cpuUsageMhz ÷ (vcpu × host-core-MHz)` ≤ **10 %** (default; editable)
- Memory: `activeMib ÷ vramMib` ≤ **20 %** (default; editable) — `consumedMib ÷ vramMib`
  shown beside it, not thresholded

**② Undersized** — utilization ≈ allocation
- CPU: `cpuUsageMhz ÷ (vcpu × host-core-MHz)` ≥ **90 %** (default; editable)
- Memory: `activeMib ÷ vramMib` ≥ **90 %** (default; editable)

**③ Stressed** — runtime pressure symptoms
- Memory: `balloonedMib > 0` **or** `swappedMib > 0` (default 0 MiB; editable)
- CPU: `cpuReadinessPercent > 5 %` — **reuses** `CONTENTION_THRESHOLDS.warning`; **no new
  constant**

**Conceptual split (never collapsed):** Oversized/Undersized measure _allocation vs
utilization_; Stressed measures _pressure symptoms_. A VM can be Undersized **and** Stressed —
both flags show.

**Binding caveats (ADR-0012 discipline):**
- A VM whose usage cell is **absent/blank** is _"not derivable"_ — excluded from every flag,
  **never** coerced to `0 %` (which would falsely mark it oversized). Same null discipline
  `parseReadinessCell` / `cpuReadinessPercent` already use.
- **Point-in-time honesty:** with a single snapshot the "max" is one sample; the view + slide
  state the sample basis plainly.

## A2. Data layer

### New RVTools sheet adapters (`vMemory`, `vCPU`)

- Added to `src/engines/parser/adapters/rvtools.ts` (worker-side; `xlsx` stays confined to
  `parser.worker.ts`).
- Both are **OPTIONAL** sheets — exactly like `vDatastore`/`vPartition`. Absent ⇒ collected
  warning + empty array; the feature degrades gracefully. **Never** a fatal `ParseError`.
- Column alias maps follow the existing convention: exact-normalized match, longest spelling
  first, MiB-suffix drift covered (`… MiB` before `… MB`), FR/DE drift aliases.
  - `vMemory`: `active`, `consumed`, `ballooned`/`balloon`, `swapped`, plus VM identity
    (`vm instance uuid`, `vm uuid`, `vm`).
  - `vCPU`: `overall cpu usage`/`cpu usage`/`usage mhz`, plus VM identity. (CPU **readiness**
    keeps coming from `vInfo` — untouched.)

### New `VmUsageRow`

Per snapshot, keyed by VM identity. New canonical type + `VmUsageRowSchema` (Zod, parser
boundary only):

```
vmName: string
vmInstanceUuid: string
vmBiosUuid: string
cluster: string
activeMib:     MiB  | null
consumedMib:   MiB  | null
balloonedMib:  MiB  | null
swappedMib:    MiB  | null
cpuUsageMhz:   MHz  | null
```

- A blank / sentinel / absent cell → `null` ("not derivable"), via a strict cell parser
  mirroring `parseReadinessCell` (never coerce to `0`).
- Branded `MiB` / `MHz` via the hand-rolled `.transform((n) => n as MiB)` pattern (not Zod
  `.brand()`), per the existing schema convention.

### `Snapshot` extension

`Snapshot` gains `vmUsage: VmUsageRow[]`. In-memory only, like every other row set
(no `localStorage`, privacy guard untouched, no network added). Propagates through the parse
worker boundary and `mergeSnapshotsToEstate`.

### Multi-snapshot max + identity join

- VM identity join key order: `vmInstanceUuid` → `vmBiosUuid` → `vmName+cluster` fallback
  (reusing the identity logic already in `snapshotMerge`/`trends`).
- `buildEstateView` already receives the `Snapshot[]` array. A helper reduces usage across
  snapshots to a per-identity **max** of each metric (powered-on samples only). Single
  snapshot ⇒ that one value.
- CPU-utilization denominator: join VM→host (`VInfoRow.host` → `VHostRow.speedMhz`). Note
  `speedMhz` is **per-core** MHz, so the VM ceiling is `vcpu × speedMhz` (the standard 1
  vCPU ≈ 1 core approximation; documented as such).

## A3. Sizing engine (pure functions)

New `src/engines/aggregation/sizing.ts`, mirroring `thresholdFlags.ts` + `contention.ts`.
Pure: no React/Zustand/Zod/DOM. Vitest-gated ≥ 75 %.

Two steps to stay pure:
1. `maxVmUsageAcrossSnapshots(snapshots)` → `Map<identity, MaxUsage>` (per-VM max of each
   metric over powered-on samples).
2. `computeSizing(maxUsage, vinfo, vhost, thresholds)` → per-VM `VmSizing[]` + counts.

`SizingThresholds` (the customizable ratios) + `DEFAULT_SIZING_THRESHOLDS` (single source of
truth, store re-exports — the `DEFAULT_THRESHOLDS` pattern):

```
cpuOversizePct:  10
memOversizePct:  20
cpuUndersizePct: 90
memUndersizePct: 90
balloonMib:       0
swapMib:          0
```
(CPU-ready stress reuses `CONTENTION_THRESHOLDS.warning = 5`.)

`VmSizing` per row:
```
vmName, cluster, host, vcpu, vramMib
cpuUtilPct:    number | null
memActivePct:  number | null
memConsumedPct:number | null
balloonedMib:  number | null
swappedMib:    number | null
cpuReadinessPercent: number | null
sampleBasis: 'single' | 'max-of-N'
flags: { cpuOversized, memOversized, cpuUndersized, memUndersized, memStressed, cpuStressed }
```

Invariants:
- Divide-by-zero guarded — `vcpu === 0` / `vramMib === 0` ⇒ util `null` (the `fsOver`
  precedent), never `Infinity`/`NaN`.
- Any `null` input ⇒ that resource's flags `false` + util `null`; the VM still appears with
  `—` for the non-derivable cell. Counts tally only derivable-and-flagged rows.
- Powered-on only.
- Exported predicate helpers (`cpuUtil(...)`, `memActivePct(...)`) for DRY, like `fsOver`.

Surfaced through `useEstateView` (the single `useMemo`) → consumed by the view **and** the
PPTX builder (via `buildExportView`), never by components reaching into engines directly.

## A4. Web surface — "Right-sizing" view

New top-level view + nav tab (alongside Dashboard / Inventory / Storage / DR / EOS / Network /
Trends / Planning). Built from existing primitives — no new table/toggle primitives invented.

```
┌─ Right-sizing ───────────────────────────────────────────────┐
│  [Oversized 42]   [Undersized 7]   [Stressed 13]   ← KPI tiles │
│  basis: max across 3 snapshots · powered-on only · — = n/a     │
├────────────────────────────────────────────────────────────── │
│  Thresholds (customizable, reset on refresh):                  │
│   CPU oversize ≤[10]%  Mem oversize ≤[20]%                      │
│   CPU undersize ≥[90]% Mem undersize ≥[90]%                     │
│   Balloon >[0]MiB  Swap >[0]MiB   CPU-ready >[5]%               │
├────────────────────────────────────────────────────────────── │
│  Filter: (•All) (Oversized) (Undersized) (Stressed)  [Export]  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ VM │Cluster│Host│vCPU│CPU%│vRAM│Act%│Cons%│Bln│Swp│Rdy%│⚑│ │
│  │ …virtualized rows… (flag chips per resource)             │ │
│  └──────────────────────────────────────────────────────────┘ │
│  [ counts bar chart — SVG via <Chart> ]                        │
└────────────────────────────────────────────────────────────────┘
```
> The words "Oversized/Undersized/Stressed" in this sketch are **shorthand** for
> the neutral visible strings defined below — they are not the literal UI labels.
- **VM table:** reuse `components/inventory/DataTable` + CSV export (`VmTable` pattern). New
  column `id`s require `inventory:col.<id>` keys in **every** locale (the DataTable header
  gotcha). `<thead>` matches the flex `<tbody>` layout.
- **Visible category labels are neutral** measured phrasings (e.g. _"Allocation ≫ usage"_,
  _"Usage near allocation"_, _"Ballooning / CPU-ready"_). `oversized/undersized/stressed` are
  code identifiers only.
- **Filter toggles:** the `ThemeToggle` `<fieldset role="group">` + `aria-pressed` idiom.
- **Threshold controls:** number inputs bound to the store threshold slice (in-memory; refresh
  → defaults). Recompute flows through `useEstateView`'s single `useMemo`.
- **Chart:** a small **counts bar** via `<Chart>` (mandated SVG renderer). Confirm the `bar`
  ECharts type is already registered in `<Chart>`; if not, register it (tree-shaken, within
  the 300 KB gate). No heavy per-VM scatter in v1 (avoids the >10k-point SVG concern; a later
  canvas escape-hatch overview is possible).
- **Empty / non-derivable:** `—` for non-derivable cells; an explicit empty-state when
  `vMemory`/`vCPU` were absent ("no usage data in this export").

## A5. PPTX — Right-sizing slide

New `slides/rightSizingSlide.ts`, registered in `builder.ts`, fed by `buildExportView` (same
`VmSizing` data — computed once, DRY).

- **Native pptxgenjs shapes + text only** (KPI cards via `kpiCard`, a native pptx **table**) —
  **not** a rasterized chart with labels (resvg-has-no-font trap: rasterized chart text
  vanishes).
- Layout: neutral title (e.g. "Right-sizing — configured vs used") → three `kpiCard`s
  (counts) → top-N table of flagged VMs (VM, Cluster, vCPU, CPU%, vRAM, Active%, flag chips) →
  caption stating **sample basis** (single vs max-of-N), **powered-on only**, and the
  **threshold values used** (deck is self-describing since thresholds are customizable).
- **Degrade gracefully:** if no usage data is derivable (both sheets absent), the slide is
  **omitted** — no empty deck page.
- Colors/theme via existing pptx `theme.ts` + `colors.ts`.

## A6. i18n (right-sizing strings)

- New `rightsizing` namespace, added to `NAMESPACES`, with JSON in **all four** locales
  (`en`, `fr`, `de`, `it`).
- New `inventory:col.<id>` keys for each new table column, in all four locales.
- Right-sizing slide strings in the `pptx` namespace, all four locales.
- No pre-formatted numbers in strings; neutral, non-verdict phrasing.

## A7. Testing (Workstream A)

- `sizing.test.ts` (≥ 75 % gate): util math, divide-by-zero→`null`, `null`-input→`false`
  flags, powered-on filter, multi-snapshot max reduce, `≤`/`≥` boundary semantics.
- Parser adapter tests: `vMemory`/`vCPU` alias + MiB-suffix drift, blank/sentinel→`null`,
  optional-sheet-absent→warning+empty.
- Schema tests: `VmUsageRowSchema`.
- Component test: render, filter toggles, empty-state, CSV export.
- PPTX: `rightSizingSlide` builder test + **visual verification** (soffice→PDF→Read; vsizer
  deck as reference).
- Update `buildExportView` test.
- **Fixtures:** extend the synthetic generator (`scripts/generate-inventory-10k.mjs` /
  `seed-fixtures.mjs`) to emit `vMemory`/`vCPU` sheets so tests have usage data.

## A8. Privacy / supply-chain

- No new dependencies. No network calls (privacy guard untouched).
- `VmUsage` rows are dataset rows — in-memory only, never `localStorage`.
- `check:supply-chain` unaffected; `check:bundle-size` unaffected (no new chart families
  beyond `bar`, which is tree-shaken).

---

# Workstream B — App-wide German + Italian localization

## B1. Scope

Add `de` and `it` locales across the **existing 16 namespaces** (`common`, `upload`,
`dashboard`, `inventory`, `mvc`, `str`, `alloc`, `dr`, `rci`, `eos`, `trends`, `storage`,
`alerts`, `network`, `report`, `pptx`) **plus** the new `rightsizing` namespace.

- ~17 namespaces × 2 new languages = **~34 new JSON files** under `locales/de/` and
  `locales/it/`.
- `src/i18n/index.ts` wiring: per-namespace imports for `de`/`it`, `resources` map entries,
  and `SUPPORTED_LANGUAGES = ['fr', 'en', 'de', 'it']`.
- Language switcher UI updated to offer all four locales.
- Detector chain unchanged (`?lang=` → `localStorage` → navigator → `fr` fallback); `de`/`it`
  now match navigator detection. `vatlas-lang` allowed values widened to the four codes (still
  a locale code, not dataset content — privacy invariant intact).
- Translations are **bundled at build time** — no runtime translation API (privacy/no-network
  invariant unaffected).

## B2. Translation approach & quality risk

- Draft `de`/`it` strings from the existing `en` (authoritative) keys, preserving all
  interpolation tokens and ICU plural forms exactly.
- **Risk:** technical VMware terminology in German/Italian benefits from native/technical
  review. Generated translations should be flagged for a speaker's review before release;
  this is called out as a known follow-up, not a blocker for wiring.
- Keep key parity across all four locales (no missing keys); a parity check (script or test)
  guards drift.

## B3. Testing (Workstream B)

- Key-parity test: every namespace has identical key sets across `en`/`fr`/`de`/`it`.
- i18n init/smoke test: app renders under each locale; switcher cycles all four.
- No editorial-number/pre-formatted-number regressions introduced.

---

## Non-goals / YAGNI

- No historical/time-series performance ingestion beyond the multi-snapshot max of loaded
  exports.
- No per-VM scatter chart in v1.
- No right-sizing section in the HTML report.
- No automated "recommended size" suggestion — the tool measures; the user decides.
- No new runtime dependencies.

## Risks & open questions

- RVTools `vMemory`/`vCPU` column spellings vary across versions; alias maps must cover the
  common drift (mitigated by optional-sheet + null-cell discipline and adapter tests).
- `Active` memory can read low for guests without VMware Tools / fresh boots — a snapshot-time
  artifact. Mitigated by the multi-snapshot max and powered-on filter; documented as a caveat.
- de/it translation quality requires native review (tracked as follow-up).

## Acceptance criteria

1. Loading an RVTools export **with** `vMemory`/`vCPU` populates the Right-sizing view and the
   PPTX slide; loading one **without** degrades gracefully (empty-state in web; slide omitted).
2. Oversized flags fire at CPU ≤ 10 % / mem Active ≤ 20 % (defaults), recompute live when the
   user edits any ratio, and reset to defaults on refresh.
3. Non-derivable usage shows `—` and is never counted as oversized.
4. With multiple snapshots loaded, values reflect the per-VM max across them; the basis is
   stated in the UI and slide.
5. The app runs and the switcher cycles through `en`, `fr`, `de`, `it`; all namespaces have
   key parity across the four locales.
6. `engines/` coverage stays ≥ 75 %; `check:supply-chain` and `check:bundle-size` pass; no
   network calls added.
