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
 * largest-storage VM). Population = ALL VMs (no power-state filter), so
 * `vmCount` equals `GlobalSummary.vmCount`.
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
