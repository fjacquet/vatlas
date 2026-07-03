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
