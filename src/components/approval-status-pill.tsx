"use client"

import type { ApprovalStatus } from '@/lib/types'

/**
 * Round 7.13 — small, color-coded approval status pill.
 *
 * Renders one of:
 *   - "Awaiting approval" (amber) — briefer asked to review
 *   - "Changes requested" (red)   — briefer pushed back
 *   - "Approved" (green)          — briefer signed off
 *   - nothing                     — when status is 'none'
 *
 * Used on kanban cards (under the title, per Round 7.13 design)
 * and on list view rows so staff can scan at a glance which jobs
 * need attention. The pill renders nothing when status is 'none'
 * so jobs that aren't routed for approval don't get a confusing
 * "—" or empty space.
 *
 * Two visual sizes: `sm` (kanban cards, dense layout) and `md`
 * (list rows, more breathing room). Default is `sm` because cards
 * are the primary surface.
 */
export function ApprovalStatusPill({
  status,
  size = 'sm',
}: {
  status: ApprovalStatus
  size?: 'sm' | 'md'
}) {
  if (status === 'none') return null

  const config: { label: string; tint: string } =
    status === 'awaiting'
      ? { label: 'Awaiting approval', tint: 'bg-amber-100 text-amber-800 border-amber-200' }
      : status === 'changes_requested'
        ? { label: 'Changes requested', tint: 'bg-red-100 text-red-800 border-red-200' }
        : status === 'approved'
          ? { label: 'Approved', tint: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
          : { label: status, tint: 'bg-slate-100 text-slate-700 border-slate-200' }

  const sizeClass =
    size === 'md'
      ? 'text-xs px-2 py-0.5'
      : 'text-[10px] px-1.5 py-0.5'

  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${config.tint} ${sizeClass}`}
    >
      {config.label}
    </span>
  )
}
