/** Phase 18 — estate overview: KPI cards (counts + utilization + capacity)
 *  and a factual OS-family breakdown. The rasterized OS donut had no legend
 *  ("missing text") and the CPU/RAM gauges rendered giant + verdict-colored
 *  (off-brand) and were redundant with the Avg CPU/Mem cards — both dropped
 *  for readable text. Pure, factual, brand-free. */
import type PptxGenJS from 'pptxgenjs'
import type { VmSizeStats } from '@/engines/aggregation/avgVmSize'
import type { GlobalSummary, OperationalInsights, OsBreakdown } from '@/types/estate'
import type { ExportStrings } from '../../types'
import { type ExportLocale, pptxMemMib, pptxNumber, pptxSafeFormat } from '../format'
import { PPTX_COLORS } from '../primitives/colors'
import { addHeader, addKpiRow, CONTENT_W, M } from './_layout'

export interface OverviewData {
  globals: GlobalSummary
  insights: OperationalInsights
  osBreakdown: OsBreakdown
  vmSize: VmSizeStats
}

export function addOverviewSlide(
  pptx: PptxGenJS,
  d: OverviewData,
  strings: ExportStrings,
  locale: ExportLocale,
): void {
  const s = pptx.addSlide()
  const y = addHeader(s, strings['overview.title'] ?? 'Estate overview')
  const y2 = addKpiRow(
    s,
    [
      { label: strings['overview.vms'] ?? 'VMs', value: pptxNumber(d.globals.vmCount, locale) },
      {
        label: strings['overview.hosts'] ?? 'Hosts',
        value: pptxNumber(d.globals.hostCount, locale),
      },
      {
        label: strings['overview.clusters'] ?? 'Clusters',
        value: pptxNumber(d.globals.clusterCount, locale),
      },
      {
        label: strings['overview.vcpuPerPcpu'] ?? 'vCPU : pCPU',
        value: pptxNumber(Number(d.globals.vcpuPerPcpu), locale, 1),
      },
    ],
    y,
  )
  // PPT-02: second KPI row surfaces previously-dropped estate facts
  // (utilization + physical capacity + storage), factual only.
  const o = d.insights
  const y3 = addKpiRow(
    s,
    [
      {
        label: strings['overview.avgCpu'] ?? 'Avg CPU %',
        value: pptxNumber(Number(o.avgCpuPct), locale, 1),
      },
      {
        label: strings['overview.avgMem'] ?? 'Avg memory %',
        value: pptxNumber(Number(o.avgMemPct), locale, 1),
      },
      {
        label: strings['overview.cores'] ?? 'Physical cores',
        value: pptxNumber(Number(o.totalPhysicalCores), locale),
      },
      {
        label: strings['overview.hostMem'] ?? 'Host memory',
        value: pptxMemMib(Number(o.totalHostMemoryMib), locale),
      },
      {
        label: strings['overview.provisioned'] ?? 'Provisioned',
        value: pptxMemMib(Number(o.provisionedMib), locale),
      },
      {
        label: strings['overview.usedStorage'] ?? 'Used storage',
        value: pptxMemMib(Number(o.usedStorageMib), locale),
      },
    ],
    y2,
  )
  // OS-family breakdown as factual text (counts + share). Replaces the
  // unlabeled donut so the families are actually named on the slide.
  const os = d.osBreakdown
  const total = os.windows + os.linux + os.other
  const share = (k: number) =>
    total > 0 ? ` (${pptxNumber(Math.round((k / total) * 100), locale)} %)` : ''
  s.addText(pptxSafeFormat(strings['os.title'] ?? 'Operating systems'), {
    x: M,
    y: y3 + 0.05,
    w: 6,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 13,
    bold: true,
    color: PPTX_COLORS.ink,
    margin: 0,
  })
  addKpiRow(
    s,
    [
      {
        label: strings['os.windows'] ?? 'Windows',
        value: pptxNumber(os.windows, locale) + share(os.windows),
      },
      {
        label: strings['os.linux'] ?? 'Linux',
        value: pptxNumber(os.linux, locale) + share(os.linux),
      },
      {
        label: strings['os.other'] ?? 'Other',
        value: pptxNumber(os.other, locale) + share(os.other),
      },
    ],
    y3 + 0.45,
  )

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
}
