# Average VM Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the estate's average VM size (vCPU / vRAM / storage) as mean / median / max on the web dashboard and the PPTX overview slide.

**Architecture:** One new pure aggregation engine (`avgVmSize`) runs inside the existing single `buildEstateView` pass and attaches a `VmSizeStats` to `EstateView`. A presentational dashboard card and a native PPTX table read it. No new `useMemo`; no HTML-report surface.

**Tech Stack:** React 19 · TypeScript (strict, `noUncheckedIndexedAccess`) · Zustand 5 · react-i18next · pptxgenjs 4 · Vitest + @testing-library/react · Biome.

## Global Constraints

- **Storage basis = in-use / committed** (`VInfoRow.inUseMib`). vCPU/vRAM = configured (`vcpu`, `vramMib`). This mixed basis is deliberate; the storage row/column MUST be labelled "Storage (in-use)" (localized) so it is not read as provisioned.
- **`max` is per-axis** — each axis reports its own maximum; the largest-vCPU VM may differ from the largest-storage VM. Not a single "biggest VM" row.
- **VM population = all VMs** (powered-on, off, suspended, templates), **mode-independent** — `avgVmSize(merged.vinfo)` with NO power-state or accounting-mode filter. The average is a physical inventory fact and must not shift when the accounting toggle changes. `vmSize.vmCount` = raw VM count (equals `globals.vmCount` only under `configured`; other modes filter to powered-on). (Corrected 2026-07-03; the earlier "matches globals.vmCount" wording was a contradiction.)
- **Median convention:** odd N → middle element of the sorted axis; even N → mean of the two middle elements.
- **Surfaces:** web dashboard + PPTX deck only. **No HTML report.**
- **Factual, brand-free:** plain numbers; no editorial verbs (`recommend/should/good/bad/healthy`); no verdict colors.
- **Privacy invariant (ADR-0001/0004):** inputs are the in-memory parsed workbook; no persistence, no network call.
- **Engines are pure:** no React/DOM/Zustand/Zod in `src/engines/**`. One traversal + sorts; `EMPTY_VM_SIZE` frozen constant for the empty estate.
- **Branded units (ADR-0010):** unwrap brands at the boundary (`vm.vcpu as number`); never a raw `* 1.048576`. `AxisStats` carries plain `number`s (averages are display-only; every consumer takes bare numbers) — units are documented in `VmSizeStats` field comments.
- **i18n parity gate:** every new key lands in **en / fr / de / it** or `src/i18n/keyParity.test.ts` fails the build. No pre-formatted numbers in strings. DE/IT are best-effort under the standing native-review risk.
- **Coverage gate:** `src/engines/**` gated ≥ 75 % — the new engine gets unit tests.
- **Lint/typecheck:** `npx @biomejs/biome check .` (NOT `npm run lint`); `npm run typecheck` (app + test projects — `rtk tsc` alone misses test-file type errors).
- **Commits:** prefix `feat: …` / `test: …`; signed commits required (never `--no-gpg-sign`).

---

### Task 1: `avgVmSize` pure engine + types

**Files:**
- Create: `src/engines/aggregation/avgVmSize.ts`
- Create: `src/engines/aggregation/avgVmSize.test.ts`
- Modify: `src/engines/aggregation/index.ts` (barrel export)

**Interfaces:**
- Consumes: `VInfoRow` from `@/types/vinfo` (fields `vcpu: Cores`, `vramMib: MiB`, `inUseMib: MiB`).
- Produces:
  - `interface AxisStats { mean: number; median: number; max: number }`
  - `interface VmSizeStats { vmCount: number; vcpu: AxisStats; vramMib: AxisStats; storageMib: AxisStats }`
  - `const EMPTY_VM_SIZE: VmSizeStats` (frozen, all zeros)
  - `avgVmSize(vinfo: readonly VInfoRow[]): VmSizeStats`

- [ ] **Step 1: Write the failing test**

Create `src/engines/aggregation/avgVmSize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cores, mib } from '@/engines/units'
import type { VInfoRow } from '@/types/vinfo'
import { avgVmSize, EMPTY_VM_SIZE } from './avgVmSize'

/** Minimal VInfoRow builder — only the three size fields matter here. */
const vm = (vcpu: number, vramMib: number, inUseMib: number): VInfoRow => ({
  vmName: 'vm',
  cluster: 'C1',
  host: 'h1',
  vcpu: cores(vcpu),
  vramMib: mib(vramMib),
  cpuReadinessPercent: null,
  powerState: 'poweredOn',
  template: false,
  poweredOn: true,
  osConfig: '',
  osTools: '',
  vmBiosUuid: '',
  vmInstanceUuid: '',
  viSdkUuid: '',
  viSdkServer: '',
  provisionedMib: mib(0),
  inUseMib: mib(inUseMib),
  path: '',
})

describe('avgVmSize', () => {
  it('returns EMPTY_VM_SIZE for an empty estate', () => {
    expect(avgVmSize([])).toBe(EMPTY_VM_SIZE)
    expect(EMPTY_VM_SIZE.vmCount).toBe(0)
    expect(EMPTY_VM_SIZE.vcpu).toEqual({ mean: 0, median: 0, max: 0 })
  })

  it('for a single VM, mean = median = max = that VM on every axis', () => {
    const r = avgVmSize([vm(4, 8192, 20480)])
    expect(r.vmCount).toBe(1)
    expect(r.vcpu).toEqual({ mean: 4, median: 4, max: 4 })
    expect(r.vramMib).toEqual({ mean: 8192, median: 8192, max: 8192 })
    expect(r.storageMib).toEqual({ mean: 20480, median: 20480, max: 20480 })
  })

  it('odd N: median is the middle sorted element (order-independent)', () => {
    // vcpu values 8, 2, 4 → sorted 2,4,8 → median 4, mean 14/3, max 8
    const r = avgVmSize([vm(8, 0, 0), vm(2, 0, 0), vm(4, 0, 0)])
    expect(r.vcpu.median).toBe(4)
    expect(r.vcpu.mean).toBeCloseTo(14 / 3, 10)
    expect(r.vcpu.max).toBe(8)
  })

  it('even N: median is the mean of the two middle sorted elements', () => {
    // vcpu values 2, 8, 4, 6 → sorted 2,4,6,8 → median (4+6)/2 = 5
    const r = avgVmSize([vm(2, 0, 0), vm(8, 0, 0), vm(4, 0, 0), vm(6, 0, 0)])
    expect(r.vcpu.median).toBe(5)
    expect(r.vcpu.mean).toBe(5)
    expect(r.vcpu.max).toBe(8)
  })

  it('computes each axis max independently (per-axis, not one VM)', () => {
    // VM A has the biggest vCPU; VM B has the biggest storage.
    const r = avgVmSize([vm(16, 4096, 1000), vm(2, 4096, 99999)])
    expect(r.vcpu.max).toBe(16)
    expect(r.storageMib.max).toBe(99999)
  })

  it('storage uses inUseMib, not provisioned', () => {
    const r = avgVmSize([vm(1, 0, 500), vm(1, 0, 1500)])
    expect(r.storageMib.mean).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk vitest run src/engines/aggregation/avgVmSize.test.ts`
Expected: FAIL — `Cannot find module './avgVmSize'` (or `avgVmSize is not defined`).

- [ ] **Step 3: Write minimal implementation**

Create `src/engines/aggregation/avgVmSize.ts`:

```ts
import type { VInfoRow } from '@/types/vinfo'

/**
 * Mean / median / max for one size axis. Plain numbers, NOT branded: these
 * are display-only averages and every consumer (card, PPTX table) takes a
 * bare number. Units are documented per-field on `VmSizeStats`.
 */
export interface AxisStats {
  mean: number
  median: number
  max: number
}

/**
 * Estate-wide average VM size. `vcpu`/`vramMib` are CONFIGURED allocation;
 * `storageMib` is IN-USE / committed (`VInfoRow.inUseMib`) — a deliberate
 * mixed basis. `max` is per-axis (the largest-vCPU VM may differ from the
 * largest-storage VM). Population = ALL VMs (no power-state or accounting-
 * mode filter), mode-independent. `vmCount` is the raw VM count; it equals
 * `GlobalSummary.vmCount` only under `configured` mode.
 */
export interface VmSizeStats {
  vmCount: number
  /** cores (configured) */
  vcpu: AxisStats
  /** MiB (configured) */
  vramMib: AxisStats
  /** MiB (in-use / committed) */
  storageMib: AxisStats
}

const ZERO_AXIS: AxisStats = Object.freeze({ mean: 0, median: 0, max: 0 })

/** Frozen empty projection — mirrors `emptySummary` / `EMPTY_SIZING`. */
export const EMPTY_VM_SIZE: VmSizeStats = Object.freeze({
  vmCount: 0,
  vcpu: ZERO_AXIS,
  vramMib: ZERO_AXIS,
  storageMib: ZERO_AXIS,
})

/**
 * mean/median/max over a NON-EMPTY array of raw numbers. Median: odd length
 * → middle sorted element; even length → mean of the two middles. The `?? 0`
 * guards satisfy `noUncheckedIndexedAccess`; they never fire (caller ensures
 * length ≥ 1).
 */
const axisStats = (xs: readonly number[]): AxisStats => {
  const n = xs.length
  let sum = 0
  let max = xs[0] ?? 0
  for (const x of xs) {
    sum += x
    if (x > max) max = x
  }
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  const hi = sorted[mid] ?? 0
  const lo = sorted[mid - 1] ?? 0
  const median = n % 2 === 0 ? (lo + hi) / 2 : hi
  return { mean: sum / n, median, max }
}

/** Estate-wide average VM size across all VMs (see `VmSizeStats`). */
export const avgVmSize = (vinfo: readonly VInfoRow[]): VmSizeStats => {
  if (vinfo.length === 0) return EMPTY_VM_SIZE
  const vcpu: number[] = []
  const vram: number[] = []
  const storage: number[] = []
  for (const v of vinfo) {
    vcpu.push(v.vcpu as number)
    vram.push(v.vramMib as number)
    storage.push(v.inUseMib as number)
  }
  return {
    vmCount: vinfo.length,
    vcpu: axisStats(vcpu),
    vramMib: axisStats(vram),
    storageMib: axisStats(storage),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk vitest run src/engines/aggregation/avgVmSize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the barrel export**

In `src/engines/aggregation/index.ts`, add this export (keep the file's alphabetical-ish grouping — place near the other `type`-carrying exports):

```ts
export { type AxisStats, avgVmSize, EMPTY_VM_SIZE, type VmSizeStats } from './avgVmSize'
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx @biomejs/biome check src/engines/aggregation/avgVmSize.ts src/engines/aggregation/avgVmSize.test.ts src/engines/aggregation/index.ts`
Expected: no errors (Biome may auto-organize the barrel import order — accept it).

- [ ] **Step 7: Commit**

```bash
rtk git add src/engines/aggregation/avgVmSize.ts src/engines/aggregation/avgVmSize.test.ts src/engines/aggregation/index.ts
rtk git commit -m "feat: avgVmSize engine (mean/median/max vCPU/vRAM/storage)"
```

---

### Task 2: Wire `vmSize` into `EstateView`

**Files:**
- Modify: `src/types/estate.ts` (import + new field on `EstateView`)
- Modify: `src/engines/aggregation/estateView.ts` (populate in the single pass + `EMPTY_VIEW`)
- Modify: `src/engines/aggregation/estateView.test.ts` (assert population)

**Interfaces:**
- Consumes: `avgVmSize`, `EMPTY_VM_SIZE`, `VmSizeStats` from Task 1.
- Produces: `EstateView.vmSize: VmSizeStats`, populated for real estates and `EMPTY_VM_SIZE` in `EMPTY_VIEW`.

- [ ] **Step 1: Write the failing test**

Append a new `describe` to `src/engines/aggregation/estateView.test.ts`. This file already defines a local `buildEstateView(snap, mode)` wrapper, a `snapshot()` fixture, and imports `EMPTY_VIEW` — all in scope, no new imports needed. avgVmSize's own math is covered in `avgVmSize.test.ts`; here we only assert the field is populated and the empty-state is wired:

```ts
describe('buildEstateView — vmSize (average VM size)', () => {
  it('counts ALL VMs regardless of accounting mode (mode-independent)', () => {
    // Fixture has 4 VMs (2 on, 2 off). vmSize counts all 4 under every mode
    // and the projection is identical; globals.vmCount is 2 under 'active'.
    const active = buildEstateView(snapshot(), 'active')
    const configured = buildEstateView(snapshot(), 'configured')
    expect(active.vmSize.vmCount).toBe(4)
    expect(configured.vmSize.vmCount).toBe(4)
    expect(active.globals.vmCount).toBe(2)
    expect(active.vmSize).toEqual(configured.vmSize)
  })

  it('computes per-axis stats over all VMs (max ≥ mean, storage > 0)', () => {
    const view = buildEstateView(snapshot(), 'active')
    expect(view.vmSize.vcpu.max).toBeGreaterThanOrEqual(view.vmSize.vcpu.mean)
    expect(view.vmSize.storageMib.mean).toBeGreaterThan(0)
  })

  it('EMPTY_VIEW.vmSize is the frozen empty projection', () => {
    expect(EMPTY_VIEW.vmSize.vmCount).toBe(0)
    expect(EMPTY_VIEW.vmSize.storageMib).toEqual({ mean: 0, median: 0, max: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk vitest run src/engines/aggregation/estateView.test.ts`
Expected: FAIL — `view.vmSize` is `undefined` / property does not exist on type.

- [ ] **Step 3: Add the type field**

In `src/types/estate.ts`, add the import beside the other engine-type imports (after the `avgVmSize`-adjacent line, alphabetically near the top block around lines 5-10):

```ts
import type { VmSizeStats } from '@/engines/aggregation/avgVmSize'
```

Then add the field to the `EstateView` interface — place it right after the `monsters: MonsterEstate` field (around line 542), with a doc comment:

```ts
  /**
   * Estate-wide average VM size (mean/median/max for vCPU, vRAM, and
   * in-use storage) over ALL VMs. Produced in the single `buildEstateView`
   * pass; `EMPTY_VM_SIZE` in `EMPTY_VIEW`. Web dashboard + PPTX only.
   */
  vmSize: VmSizeStats
```

- [ ] **Step 4: Populate it in the single pass**

In `src/engines/aggregation/estateView.ts`:

(a) Add to the imports from `./avgVmSize` (near the other sibling-engine imports around lines 22-33):

```ts
import { avgVmSize, EMPTY_VM_SIZE } from './avgVmSize'
```

(b) Compute it next to `monsters` (right after the `computeMonsters(...)` block, ~line 340). ALL VMs, mode-independent — no power-state/mode filter:

```ts
  // Average VM size (mean/median/max) — same single pass. ALWAYS over ALL
  // VMs (mode-independent): "average VM size" is a physical inventory fact,
  // not an accounting figure, so it must not shift with the accounting mode
  // (user decision 2026-07-03). vmSize.vmCount = raw VM count, not the
  // mode-filtered globals.vmCount.
  const vmSize = avgVmSize(merged.vinfo)
```

(c) Add `vmSize,` to the returned object literal — right after `monsters,` (~line 365):

```ts
    sizing,
    monsters,
    vmSize,
    datastoreDetail,
    vmDetail,
```

(d) Add `vmSize` to `EMPTY_VIEW` — right after `monsters: EMPTY_MONSTERS,` (~line 503):

```ts
  monsters: EMPTY_MONSTERS,
  vmSize: EMPTY_VM_SIZE,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk vitest run src/engines/aggregation/estateView.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck`
Expected: no errors (this catches any test-file `EstateView` literal now missing `vmSize` — if a test constructs a bare `EstateView`, add `vmSize: EMPTY_VM_SIZE` there).
Run: `npx @biomejs/biome check src/types/estate.ts src/engines/aggregation/estateView.ts src/engines/aggregation/estateView.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
rtk git add src/types/estate.ts src/engines/aggregation/estateView.ts src/engines/aggregation/estateView.test.ts
rtk git commit -m "feat: thread vmSize (average VM size) through EstateView"
```

---

### Task 3: Dashboard `AverageVmSizeCard` + formatter + i18n

**Files:**
- Modify: `src/utils/format.ts` (+ `src/utils/format.test.ts` if present) — add `fmtDecimal`
- Create: `src/components/dashboard/AverageVmSizeCard.tsx`
- Create: `src/components/dashboard/AverageVmSizeCard.test.tsx`
- Modify: `src/components/dashboard/GlobalDashboard.tsx` (mount)
- Modify: `src/i18n/locales/{en,fr,de,it}/dashboard.json` (new `avgVm` block)

**Interfaces:**
- Consumes: `VmSizeStats` (Task 1) via `view.vmSize` (Task 2); `fmtDecimal`, `fmtMemMb`.
- Produces: `<AverageVmSizeCard vmSize={view.vmSize} />`.

- [ ] **Step 1: Add the `fmtDecimal` formatter**

In `src/utils/format.ts`, add after `fmtInt` (~line 21):

```ts
/**
 * Locale-aware decimal formatter (up to `maxDigits` fraction digits, default
 * 1). Integers render clean (`"8"`); fractional values show the decimal
 * (`"5.5"`). Em-dash for non-finite inputs. Used for average vCPU (a
 * fractional count). Distinct from `fmtInt` (always 0 decimals).
 */
export const fmtDecimal = (n: number, locale = 'fr-FR', maxDigits = 1): string =>
  Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: maxDigits }) : '—'
```

- [ ] **Step 2: If `src/utils/format.test.ts` exists, add a failing test for it**

Run first: `ls src/utils/format.test.ts` — if present, add:

```ts
import { fmtDecimal } from './format'

describe('fmtDecimal', () => {
  it('renders integers without a decimal and fractionals to 1 place', () => {
    expect(fmtDecimal(8, 'en-US')).toBe('8')
    expect(fmtDecimal(5.5, 'en-US')).toBe('5.5')
    expect(fmtDecimal(14 / 3, 'en-US')).toBe('4.7')
  })
  it('returns em-dash for non-finite input', () => {
    expect(fmtDecimal(Number.NaN, 'en-US')).toBe('—')
  })
})
```

Run: `rtk vitest run src/utils/format.test.ts` → the new cases pass once Step 1 is in (they were written after the impl here — acceptable for a pure formatter; if you prefer strict red-first, comment out Step 1's export, watch it fail, then restore). If `format.test.ts` does NOT exist, skip this step — the formatter is exercised by the card test in Step 4.

- [ ] **Step 3: Write the failing card test**

Create `src/components/dashboard/AverageVmSizeCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { VmSizeStats } from '@/engines/aggregation/avgVmSize'
import i18n from '@/i18n'
import { AverageVmSizeCard } from './AverageVmSizeCard'

const SAMPLE: VmSizeStats = {
  vmCount: 3,
  vcpu: { mean: 4.5, median: 4, max: 8 },
  vramMib: { mean: 8192, median: 8192, max: 16384 },
  storageMib: { mean: 20480, median: 20480, max: 51200 },
}

describe('AverageVmSizeCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the titled section with an accessible name', () => {
    render(<AverageVmSizeCard vmSize={SAMPLE} />)
    expect(screen.getByRole('region', { name: 'Average VM size' })).not.toBeNull()
  })

  it('labels the storage row as in-use (never provisioned)', () => {
    render(<AverageVmSizeCard vmSize={SAMPLE} />)
    const storageLabel = screen.getByText(/Storage \(in-use\)/i)
    expect(storageLabel).not.toBeNull()
    expect(screen.queryByText(/provisioned/i)).toBeNull()
  })

  it('shows a fractional mean vCPU (en-US formatting)', () => {
    render(<AverageVmSizeCard vmSize={SAMPLE} />)
    expect(screen.getByText('4.5')).not.toBeNull()
  })

  it('uses no editorial verbs', () => {
    const { container } = render(<AverageVmSizeCard vmSize={SAMPLE} />)
    expect(container.textContent ?? '').not.toMatch(/recommend|should|good|bad|healthy/i)
  })
})
```

- [ ] **Step 4: Run the card test to verify it fails**

Run: `rtk vitest run src/components/dashboard/AverageVmSizeCard.test.tsx`
Expected: FAIL — cannot find module `./AverageVmSizeCard`.

- [ ] **Step 5: Add the i18n keys (all four locales)**

In `src/i18n/locales/en/dashboard.json`, add a top-level `"avgVm"` block (sibling of `"stats"`):

```json
  "avgVm": {
    "title": "Average VM size",
    "aria": "Average VM size",
    "axis": "Axis",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Storage (in-use)",
    "mean": "Mean",
    "median": "Median",
    "max": "Max"
  },
```

In `src/i18n/locales/fr/dashboard.json`:

```json
  "avgVm": {
    "title": "Taille moyenne des VM",
    "aria": "Taille moyenne des VM",
    "axis": "Axe",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Stockage (utilisé)",
    "mean": "Moyenne",
    "median": "Médiane",
    "max": "Max"
  },
```

In `src/i18n/locales/de/dashboard.json` (best-effort, native-review pending):

```json
  "avgVm": {
    "title": "Durchschnittliche VM-Größe",
    "aria": "Durchschnittliche VM-Größe",
    "axis": "Achse",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Speicher (belegt)",
    "mean": "Mittel",
    "median": "Median",
    "max": "Max"
  },
```

In `src/i18n/locales/it/dashboard.json` (best-effort, native-review pending):

```json
  "avgVm": {
    "title": "Dimensione media VM",
    "aria": "Dimensione media VM",
    "axis": "Asse",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Storage (in uso)",
    "mean": "Media",
    "median": "Mediana",
    "max": "Max"
  },
```

> Place the block at the same nesting level as the existing `"stats"` key in each file, with a trailing comma appropriate to its position (JSON — no trailing comma on the last key). The `keyParity.test.ts` gate requires identical key paths across all four files.

- [ ] **Step 6: Write the card component**

Create `src/components/dashboard/AverageVmSizeCard.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import type { VmSizeStats } from '@/engines/aggregation/avgVmSize'
import { fmtDecimal, fmtMemMb } from '@/utils/format'

export interface AverageVmSizeCardProps {
  vmSize: VmSizeStats
}

/**
 * Estate-wide average VM size — a 3×3 matrix (rows = vCPU / vRAM / Storage
 * in-use; columns = Mean / Median / Max). Presentational: consumes
 * `EstateView.vmSize` as a plain prop (no memo/engine/store imports). vCPU is
 * a fractional count (`fmtDecimal`); vRAM/storage are memory (`fmtMemMb`).
 * Storage row is explicitly "in-use" — never provisioned. Factual, brand-free.
 */
export function AverageVmSizeCard({ vmSize }: AverageVmSizeCardProps) {
  const { t, i18n } = useTranslation('dashboard')
  const loc = i18n.language

  const rows = [
    {
      label: t('avgVm.axisVcpu'),
      mean: fmtDecimal(vmSize.vcpu.mean, loc),
      median: fmtDecimal(vmSize.vcpu.median, loc),
      max: fmtDecimal(vmSize.vcpu.max, loc),
    },
    {
      label: t('avgVm.axisVram'),
      mean: fmtMemMb(vmSize.vramMib.mean, loc),
      median: fmtMemMb(vmSize.vramMib.median, loc),
      max: fmtMemMb(vmSize.vramMib.max, loc),
    },
    {
      label: t('avgVm.axisStorage'),
      mean: fmtMemMb(vmSize.storageMib.mean, loc),
      median: fmtMemMb(vmSize.storageMib.median, loc),
      max: fmtMemMb(vmSize.storageMib.max, loc),
    },
  ]

  return (
    <section className="panel" aria-label={t('avgVm.aria')}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t('avgVm.title')}
      </h3>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            <th className="py-1 text-left font-semibold">{t('avgVm.axis')}</th>
            <th className="py-1 text-right font-semibold">{t('avgVm.mean')}</th>
            <th className="py-1 text-right font-semibold">{t('avgVm.median')}</th>
            <th className="py-1 text-right font-semibold">{t('avgVm.max')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-200 dark:border-surface-700">
              <td className="py-1.5 text-left text-slate-600 dark:text-slate-300">{r.label}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {r.mean}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {r.median}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {r.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 7: Run the card test to verify it passes**

Run: `rtk vitest run src/components/dashboard/AverageVmSizeCard.test.tsx`
Expected: PASS (4 tests).

> If `getByRole('region', ...)` fails: a `<section>` exposes the `region` role only when it has an accessible name — the `aria-label` provides one, so this works. Keep the `aria-label`.

- [ ] **Step 8: Mount it on the dashboard**

In `src/components/dashboard/GlobalDashboard.tsx`:

(a) Add the import beside the other dashboard-card imports (near line 15):

```ts
import { AverageVmSizeCard } from './AverageVmSizeCard'
```

(b) Mount it directly after `<GlobalSummaryCard ... />` (line 111):

```tsx
          <GlobalSummaryCard globals={view.globals} mode={mode} capturedDate={capturedDate} />
          <AverageVmSizeCard vmSize={view.vmSize} />
          <OperationalInsights insights={view.operationalInsights} />
```

- [ ] **Step 9: Typecheck, lint, run the dashboard + parity tests**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx @biomejs/biome check src/utils/format.ts src/components/dashboard/AverageVmSizeCard.tsx src/components/dashboard/AverageVmSizeCard.test.tsx src/components/dashboard/GlobalDashboard.tsx`
Expected: no errors.
Run: `rtk vitest run src/i18n/keyParity.test.ts`
Expected: PASS (all four locales carry the `avgVm.*` keys).

- [ ] **Step 10: Commit**

```bash
rtk git add src/utils/format.ts src/utils/format.test.ts src/components/dashboard/AverageVmSizeCard.tsx src/components/dashboard/AverageVmSizeCard.test.tsx src/components/dashboard/GlobalDashboard.tsx src/i18n/locales/en/dashboard.json src/i18n/locales/fr/dashboard.json src/i18n/locales/de/dashboard.json src/i18n/locales/it/dashboard.json
rtk git commit -m "feat: average VM size card on the dashboard"
```

---

### Task 4: PPTX overview — native average-VM-size table + i18n

**Files:**
- Modify: `src/engines/export/pptx/slides/overviewSlide.ts` (`OverviewData.vmSize` + native table)
- Modify: `src/engines/export/pptx/builder.ts` (thread `view.vmSize`)
- Modify: `src/engines/export/pptx/builder.test.ts` (feed `vmSize`, assert no throw)
- Modify: `src/i18n/locales/{en,fr,de,it}/pptx.json` (new `avgVm` block)

**Interfaces:**
- Consumes: `VmSizeStats` (Task 1) via `view.vmSize` (Task 2); `pptxNumber`, `pptxMemMib`, `pptxSafeFormat`, `PPTX_COLORS`, `addKpiRow`, `CONTENT_W`, `M`.
- Produces: an `avgVm.*`-labelled native table on the overview slide.

- [ ] **Step 1: Add the i18n keys (all four locales)**

In `src/i18n/locales/en/pptx.json`, add a top-level `"avgVm"` block (sibling of `"overview"`):

```json
  "avgVm": {
    "title": "Average VM size",
    "axis": "Axis",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Storage (in-use)",
    "mean": "Mean",
    "median": "Median",
    "max": "Max"
  },
```

`fr/pptx.json`:

```json
  "avgVm": {
    "title": "Taille moyenne des VM",
    "axis": "Axe",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Stockage (utilisé)",
    "mean": "Moyenne",
    "median": "Médiane",
    "max": "Max"
  },
```

`de/pptx.json` (best-effort):

```json
  "avgVm": {
    "title": "Durchschnittliche VM-Größe",
    "axis": "Achse",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Speicher (belegt)",
    "mean": "Mittel",
    "median": "Median",
    "max": "Max"
  },
```

`it/pptx.json` (best-effort):

```json
  "avgVm": {
    "title": "Dimensione media VM",
    "axis": "Asse",
    "axisVcpu": "vCPU",
    "axisVram": "vRAM",
    "axisStorage": "Storage (in uso)",
    "mean": "Media",
    "median": "Mediana",
    "max": "Max"
  },
```

> Same nesting level as `"overview"`; mind JSON trailing commas. `keyParity.test.ts` derives the `pptx` namespace and enforces identical paths.

- [ ] **Step 2: Extend `OverviewData` and render the table**

In `src/engines/export/pptx/slides/overviewSlide.ts`:

(a) Import the type and the layout constants. Update the existing imports:

```ts
import type { GlobalSummary, OperationalInsights, OsBreakdown } from '@/types/estate'
import type { VmSizeStats } from '@/engines/aggregation/avgVmSize'
import type { ExportStrings } from '../../types'
import { type ExportLocale, pptxMemMib, pptxNumber, pptxSafeFormat } from '../format'
import { PPTX_COLORS } from '../primitives/colors'
import { addHeader, addKpiRow, CONTENT_W, M } from './_layout'
```

(b) Add `vmSize` to `OverviewData`:

```ts
export interface OverviewData {
  globals: GlobalSummary
  insights: OperationalInsights
  osBreakdown: OsBreakdown
  vmSize: VmSizeStats
}
```

(c) At the END of `addOverviewSlide` (after the OS `addKpiRow(...)` call that closes the function), insert the native table. The OS block ends around `y3 + 0.45 + row height`; anchor the table with a fixed y below it (the overview slide has room — mirror the monster-slide table idiom). Add before the function's closing brace:

```ts
  // Average VM size — a native table (native text renders fine; the resvg
  // trap only affects rasterized chart images). Rows = vCPU / vRAM / storage
  // (in-use); columns = mean / median / max. Factual, brand-free.
  const vs = d.vmSize
  const cell = (text: string, opts: Record<string, unknown> = {}) => ({
    text: pptxSafeFormat(text),
    options: { fontFace: 'Arial', fontSize: 11, color: PPTX_COLORS.ink, ...opts },
  })
  const hOpts = { bold: true, color: PPTX_COLORS.inkMuted }
  const rOpts = { align: 'right' as const }
  const num = (n: number) => pptxNumber(n, locale, 1)
  const mem = (n: number) => pptxMemMib(n, locale)
  const avgHeader = [
    cell(strings['avgVm.axis'] ?? 'Axis', hOpts),
    cell(strings['avgVm.mean'] ?? 'Mean', { ...hOpts, align: 'right' }),
    cell(strings['avgVm.median'] ?? 'Median', { ...hOpts, align: 'right' }),
    cell(strings['avgVm.max'] ?? 'Max', { ...hOpts, align: 'right' }),
  ]
  const avgRows = [
    [
      cell(strings['avgVm.axisVcpu'] ?? 'vCPU'),
      cell(num(vs.vcpu.mean), rOpts),
      cell(num(vs.vcpu.median), rOpts),
      cell(num(vs.vcpu.max), rOpts),
    ],
    [
      cell(strings['avgVm.axisVram'] ?? 'vRAM'),
      cell(mem(vs.vramMib.mean), rOpts),
      cell(mem(vs.vramMib.median), rOpts),
      cell(mem(vs.vramMib.max), rOpts),
    ],
    [
      cell(strings['avgVm.axisStorage'] ?? 'Storage (in-use)'),
      cell(mem(vs.storageMib.mean), rOpts),
      cell(mem(vs.storageMib.median), rOpts),
      cell(mem(vs.storageMib.max), rOpts),
    ],
  ]
  s.addText(pptxSafeFormat(strings['avgVm.title'] ?? 'Average VM size'), {
    x: M,
    y: 5.7,
    w: 6,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 13,
    bold: true,
    color: PPTX_COLORS.ink,
    margin: 0,
  })
  s.addTable([avgHeader, ...avgRows], {
    x: M,
    y: 6.05,
    w: CONTENT_W,
    colW: [CONTENT_W * 0.4, CONTENT_W * 0.2, CONTENT_W * 0.2, CONTENT_W * 0.2],
    rowH: 0.3,
    valign: 'middle',
    border: { type: 'solid', pt: 0.5, color: PPTX_COLORS.hairline },
    autoPage: false,
  })
```

> The `y: 5.7` / `y: 6.05` anchors assume the standard 7.5"-tall slide (`SLIDE.h`) with the OS block ending near y≈5.3. If the visual check (Step 5) shows overlap with the OS row or overflow off the slide bottom, nudge these two y-values together (keep the 0.35 gap) until the title sits below the OS block and the table's last row stays above the slide edge.

- [ ] **Step 3: Thread `view.vmSize` in the builder**

In `src/engines/export/pptx/builder.ts`, in the `addOverviewSlide(...)` call (lines 74-83), add `vmSize`:

```ts
  addOverviewSlide(
    pptx,
    {
      globals: view.globals,
      insights: view.operationalInsights,
      osBreakdown: view.osBreakdown,
      vmSize: view.vmSize,
    },
    strings,
    locale,
  )
```

- [ ] **Step 4: Update the builder test to feed `vmSize` and assert it runs**

`src/engines/export/pptx/builder.test.ts` builds the view via `buildExportView`, whose `view` is a real `EstateView` — so `view.vmSize` is already populated by Task 2 and the existing call needs no data change. This file's fixtures are `snap(id, nClusters, capturedAt)`, `MODE`, `TODAY`, `strings`, and it calls `buildPptx(view, trends, strings, 'en')` (async). Add this test inside the existing `describe`:

```ts
it('emits a deck carrying average-VM-size data without throwing', async () => {
  const s = snap('s1', 2, TODAY)
  const ev = buildExportView(s, [s], MODE, TODAY)
  expect(ev.view.vmSize.vmCount).toBeGreaterThan(0)
  await expect(buildPptx(ev.view, ev.trends, strings, 'en')).resolves.toBeDefined()
})
```

> `buildExportView` is imported in this file as `import { buildExportView } from '../buildExportView'`. If that import is not already present, add it. The four-arg `buildPptx(view, trends, strings, locale)` signature matches the existing golden-snapshot tests in this file.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `rtk vitest run src/engines/export/pptx/builder.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.
Run: `npx @biomejs/biome check src/engines/export/pptx/slides/overviewSlide.ts src/engines/export/pptx/builder.ts src/engines/export/pptx/builder.test.ts src/i18n/locales/en/pptx.json src/i18n/locales/fr/pptx.json src/i18n/locales/de/pptx.json src/i18n/locales/it/pptx.json`
Expected: no errors.
Run: `rtk vitest run src/i18n/keyParity.test.ts`
Expected: PASS.

- [ ] **Step 6: Visual verification of the deck (mandatory)**

Generate a deck from a real/sample workbook (or the existing export smoke path used in the repo), then render and inspect the overview slide:

```bash
# Convert the produced .pptx to PDF and read the overview slide.
soffice --headless --convert-to pdf --outdir /tmp/vatlas-deck /path/to/exported.pptx
```

Then Read the overview page of `/tmp/vatlas-deck/exported.pdf` and confirm:
- The "Average VM size" title and the 4-column table are visible and legible (text present — not blank, confirming the native-table path avoids the resvg no-font trap).
- The table does not overlap the OS-family block above it and does not run off the slide bottom. If it does, adjust the two y-values from Task 4 Step 2(c) and re-render.
- Storage row reads "Storage (in-use)" (or the localized equivalent), not "provisioned".

> If no scriptable export path exists in the repo for a headless run, drive the app per the project's run/verify convention to export a deck, then apply the same soffice→PDF→Read check. Do not skip the visual check — text/tests alone do not prove deck legibility (established project discipline).

- [ ] **Step 7: Commit**

```bash
rtk git add src/engines/export/pptx/slides/overviewSlide.ts src/engines/export/pptx/builder.ts src/engines/export/pptx/builder.test.ts src/i18n/locales/en/pptx.json src/i18n/locales/fr/pptx.json src/i18n/locales/de/pptx.json src/i18n/locales/it/pptx.json
rtk git commit -m "feat: average VM size table on the PPTX overview slide"
```

---

## Final Verification (after all tasks)

- [ ] Full typecheck: `npm run typecheck` → clean.
- [ ] Full lint: `npx @biomejs/biome check .` → clean.
- [ ] Full test run: `rtk vitest run` → all green (engines/ coverage still ≥ 75 %; run `npm run test:coverage` if confirming the gate).
- [ ] Deck visual check from Task 4 Step 6 completed and legible.
- [ ] Confirm the HTML report is unchanged (no average-VM-size surface added there — spec scope).
