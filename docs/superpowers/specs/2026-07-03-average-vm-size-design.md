# vatlas → Average VM Size (vCPU / vRAM / storage) in Web + PPTX

- **Date:** 2026-07-03
- **Status:** Approved (design); pending implementation plan
- **Scope:** Surface the estate's **average VM size** across three axes — **vCPU**, **vRAM**, **storage** — as **mean / median / max**, on the **web dashboard** and in the **PPTX deck**. Extraction + aggregation of data already parsed; no new data source.

## Goal

A user reading a vatlas report can see, at a glance, how big a "typical" VM in
the estate is: mean, median, and max for vCPU, vRAM, and storage. Mean answers
"what's the average footprint"; median answers "what's the typical VM" (robust
to a handful of monster VMs); max answers "how large does it get on each axis".

The values are pure roll-ups of the already-parsed `vInfo` rows — this is an
**aggregation + display** feature, not a new data source.

Non-goals: the HTML report (web + PPTX only, consistent with the
right-sizing / monster-VM precedent — the report is deliberately narrower);
per-cluster or per-host average breakdowns (estate-wide only in v1);
percentiles beyond median; any "too big / too small" verdict (factual only —
the right-sizing view already owns that lens with user-editable thresholds).

## Decisions (locked with the user)

1. **Surfaces:** web dashboard + PPTX deck. **Not** the HTML report.
2. **Statistics:** mean, median, and max per axis.
3. **Storage basis:** **in-use / committed** (`vInfo.inUseMib`).
4. **VM population:** **all VMs** (powered-on, off, suspended, templates),
   **mode-independent**. The average is a physical inventory fact and does
   NOT shift with the accounting toggle. `vmSize.vmCount` is the raw VM count
   — it equals `globals.vmCount` only under `configured` mode (other modes
   filter to powered-on, so `globals.vmCount` is lower). Resolved 2026-07-03
   after the mode-dependence contradiction surfaced in implementation.

## Constraints (binding)

- **Mixed basis is intentional.** vCPU and vRAM are *configured* allocation
  (`vm.vcpu`, `vm.vramMib`); storage is *in-use / committed* (`vm.inUseMib`).
  The storage column MUST be labelled to make its basis explicit (e.g.
  "Storage (in-use)") so it is never misread as provisioned. This is the user's
  deliberate choice, not an oversight.
- **`max` is per-axis, not one VM.** The largest-vCPU VM may differ from the
  largest-storage VM; each axis reports its own maximum independently. This is
  distinct from the Monster VM view, which ranks whole VMs by configured
  vCPU/vRAM. The overlap is understood and intentional — different question,
  different answer.
- **Factual, brand-free:** plain numbers, no editorial verbs, no verdict colors.
- **Privacy invariant (ADR-0001/0004):** all inputs come from the in-memory
  parsed workbook; no persistence, no network call. Inert w.r.t. the runtime
  network guard.
- **Engineering principles (KISS/DRY/functional):** one new pure engine; no new
  `useMemo` (the single `useEstateView` memo is untouched — the engine runs
  inside the existing `buildEstateView` pass); the PPTX table is a pure sync
  function; the dashboard card is presentational (props only).
- **Branded units (ADR-0010):** branded inputs (`Cores`/`MiB` on `VInfoRow`)
  are unwrapped at the boundary via `as number`; `AxisStats` averages are
  plain numbers with units documented in comments; no raw `* 1.048576`.
- **i18n parity gate:** every new key lands in **en / fr / de / it** or
  `keyParity.test.ts` fails the build. DE/IT remain pending native review
  (existing project risk); new technical terms inherit that caveat. No
  pre-formatted numbers in strings.
- **Coverage gate (engines/ ≥ 75 %):** the new engine gets unit tests.

## Data model

New pure engine `src/engines/aggregation/avgVmSize.ts`:

```ts
export interface AxisStats {
  mean: number   // arithmetic mean over all VMs
  median: number // 50th percentile (average of the two middles on even N)
  max: number    // per-axis maximum
}

export interface VmSizeStats {
  vmCount: number
  vcpu: AxisStats        // cores (configured)
  vramMib: AxisStats     // plain numbers; unit is MiB (configured)
  storageMib: AxisStats  // plain numbers; unit is MiB (in-use / committed)
}
```

`avgVmSize(vinfo: readonly VInfoRow[]): VmSizeStats`:

- One traversal collects three numeric arrays (`vcpu`, `vramMib`, `inUseMib`),
  one entry per VM, over **all** rows (no power-state filter).
- Per axis: `mean = sum / n`; `median` from a sorted copy (odd N → middle
  element; even N → mean of the two middle elements); `max = Math.max(...)`.
- Empty estate (`n === 0`) → `EMPTY_VM_SIZE`, a frozen all-zeros constant
  (same idiom as `emptySummary` / `EMPTY_SIZING`). Guards divide-by-zero and
  `Math.max()` of an empty list.
- `AxisStats` carries plain `number`s (not branded): averages are display-only
  and every consumer (card, PPTX table) takes a bare number. Branded inputs are
  unwrapped at the boundary via `as number`; units are documented in the
  `VmSizeStats` field comments (satisfies ADR-0010 — no raw `* 1.048576`).

The extra O(n) pass + three O(n log n) sorts are negligible at vatlas
cardinality (VM counts in the low thousands) and keep the engine isolated and
independently testable rather than folded into an unrelated accumulator.

## Wiring

- `src/types/estate.ts`: add `EstateView.vmSize: VmSizeStats` and export
  `VmSizeStats` / `AxisStats` / `EMPTY_VM_SIZE`.
- `src/engines/aggregation/estateView.ts`: call `avgVmSize(merged.vinfo)` inside
  the existing single `buildEstateView` pass; attach as `vmSize`. Set
  `EMPTY_VIEW.vmSize = EMPTY_VM_SIZE`.
- `src/engines/aggregation/index.ts`: re-export `avgVmSize` if the barrel
  pattern is followed by siblings.

No change to the `useEstateView` memo shape beyond the new field it carries
through.

## Web dashboard surface

New presentational component
`src/components/dashboard/AverageVmSizeCard.tsx`, consuming `view.vmSize`
(threaded from `useEstateView`), mounted beside `GlobalSummaryCard` on the
dashboard.

- Rendered as a compact 3×3 table: **rows** = vCPU / vRAM / Storage (in-use);
  **columns** = Mean / Median / Max.
- Formatting: mean vCPU to **1 decimal** (`fmtInt` would hide the fractional
  "typical" size); median/max vCPU as integers; vRAM/storage via `fmtMemMb`.
- Kept as a **separate card** so `GlobalSummaryCard` stays focused on estate
  totals (the two answer different questions: totals vs per-VM shape).
- Section carries an `aria-label` for the smoke test, mirroring the existing
  dashboard card idiom.

## PPTX surface

`src/engines/export/pptx/slides/overviewSlide.ts`: add a **native pptxgenjs
table** (3 data rows × 4 columns: axis label + mean/median/max) below the
existing KPI rows.

- Native shapes/text only — **not** rasterized (the resvg-wasm renderer has no
  bundled font; rasterized text vanishes — established project constraint).
- `OverviewData` gains `vmSize: VmSizeStats`; the builder threads it from the
  export view.
- Numbers formatted via the existing `pptxNumber` / `pptxMemMib` helpers with
  the export locale (no pre-formatted strings).
- Verified **visually** (soffice → PDF → Read), not by text/tests alone.

## i18n

New keys, all four locales (`en` / `fr` / `de` / `it`):

- `dashboard` namespace: card title, column headers (mean / median / max), row
  labels (vCPU / vRAM / storage-in-use), and the section `aria-label`.
- `export`/PPTX strings: the table title + the same axis/stat labels used by the
  slide.

`keyParity.test.ts` enforces identical key paths across locales. DE/IT strings
land as best-effort, flagged under the standing native-review risk.

## Testing

- `avgVmSize.test.ts` (engine, feeds the ≥75 % gate): empty → `EMPTY_VM_SIZE`;
  single VM (mean = median = max = that VM); **odd** N median = middle element;
  **even** N median = mean of two middles; per-axis max picks the right value
  independently across axes; storage axis reads `inUseMib` (not provisioned).
- `estateView` test extension: `view.vmSize` is populated and matches a hand
  computation on a small fixture; `EMPTY_VIEW.vmSize === EMPTY_VM_SIZE`.
- `AverageVmSizeCard` render test: 3×3 grid renders, storage row carries its
  in-use label, mean vCPU shows a decimal.
- i18n parity covered automatically by `keyParity.test.ts`.
- PPTX overview slide verified visually per the deck-verification discipline.

## Out of scope / future

- Per-cluster and per-host average breakdowns (estate-wide only in v1).
- Percentiles beyond median (p90/p95).
- Provisioned or guest-used storage basis toggles (in-use fixed in v1).
- Any presence on the HTML report.
