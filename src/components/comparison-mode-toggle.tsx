"use client"

export type ComparisonMode = 'manual' | 'campaign'

/**
 * Sub-toggle inside the Campaign report view. Lets the user pick between
 * hand-selecting individual posts (manual) and filtering by campaign tag
 * (campaign). Visually similar to the top-level report-type pills so the
 * relationship reads consistently.
 */
export function ComparisonModeToggle({
  mode,
  onChange,
}: {
  mode: ComparisonMode
  onChange: (next: ComparisonMode) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-slate-600">
        Selection
      </span>
      <div className="inline-flex items-center rounded-lg border border-slate-300 p-0.5 bg-white surface-shadow">
        {(
          [
            { value: 'manual', label: 'Pick posts manually' },
            { value: 'campaign', label: 'By campaign' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === opt.value
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
