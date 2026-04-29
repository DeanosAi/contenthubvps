"use client"

import { useEffect, useRef, useState } from 'react'
import { ALLOWED_JOB_TYPES, JOB_TYPE_DESCRIPTIONS } from '@/lib/types'

/**
 * Round 7.12 — multi-select picker for "Type of Job".
 *
 * Renders a button labeled with the current selection (or a
 * placeholder) that opens a small popover with one checkbox per
 * value from ALLOWED_JOB_TYPES. Each row also shows a short help
 * description so the user knows what the value means.
 *
 * Closes on outside-click and on Escape.
 *
 * Usage:
 *   <JobTypePicker
 *     value={job.contentTypes}
 *     onChange={(types) => patch('contentTypes', types)}
 *   />
 */
export function JobTypePicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(type: string) {
    if (value.includes(type)) {
      onChange(value.filter((v) => v !== type))
    } else {
      onChange([...value, type])
    }
  }

  // Render values in ALLOWED_JOB_TYPES order, not selection order,
  // so the button label is stable even if the user picks them in
  // a weird sequence.
  const orderedSelection = ALLOWED_JOB_TYPES.filter((t) => value.includes(t))
  const buttonLabel =
    orderedSelection.length === 0
      ? 'Select type(s)…'
      : orderedSelection.length <= 2
        ? orderedSelection.join(', ')
        : `${orderedSelection[0]} +${orderedSelection.length - 1} more`

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full text-left rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className={orderedSelection.length === 0 ? 'text-slate-400' : ''}>
          {buttonLabel}
        </span>
        <span className="float-right text-slate-400 text-xs ml-2">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] rounded-lg border border-slate-200 bg-white shadow-lg p-2 max-h-[360px] overflow-y-auto">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 px-2 pt-1 pb-2">
            Pick one or more
          </p>
          <ul className="space-y-0.5">
            {ALLOWED_JOB_TYPES.map((type) => {
              const checked = value.includes(type)
              return (
                <li key={type}>
                  <label className="flex items-start gap-2 px-2 py-2 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(type)}
                      className="mt-0.5"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-900">
                        {type}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {JOB_TYPE_DESCRIPTIONS[type]}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {orderedSelection.length > 0 && (
            <div className="border-t border-slate-200 mt-2 pt-2 px-2 flex items-center justify-between text-xs">
              <span className="text-slate-600">
                {orderedSelection.length} selected
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-slate-600 hover:text-slate-900 underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
