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
      <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        Selection
      </span>
      <div className="inline-flex items-center rounded-lg border border-[hsl(var(--border))] p-0.5 bg-[hsl(var(--card))]">
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
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
