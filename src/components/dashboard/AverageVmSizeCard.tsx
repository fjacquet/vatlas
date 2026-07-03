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
