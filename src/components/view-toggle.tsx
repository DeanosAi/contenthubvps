"use client"

export type JobView = 'kanban' | 'list'

export function ViewToggle({ value, onChange }: { value: JobView; onChange: (v: JobView) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-[hsl(var(--border))] p-0.5 bg-[hsl(var(--card))]">
      {(['kanban', 'list'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value === v
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          {v === 'kanban' ? 'Board' : 'List'}
        </button>
      ))}
    </div>
  )
}
