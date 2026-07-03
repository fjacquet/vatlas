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
