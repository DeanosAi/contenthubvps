"use client"

import type { CustomField, CustomFieldType } from '@/lib/types'

const TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Single line' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]

function genId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `field_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

/** Per-field input — picks the right HTML control based on field.type. */
function FieldInput({
  field,
  onChange,
}: {
  field: CustomField
  onChange: (v: string) => void
}) {
  const common =
    'mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm'
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className={`${common} min-h-20`}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          className={common}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          className={common}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'url':
      return (
        <input
          type="url"
          className={common}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
      )
    default:
      return (
        <input
          type="text"
          className={common}
          value={field.value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** Editable list of custom fields. Each field has a label, a type, and a
 * value. Used in both the Create Job dialog and the Job Detail panel.
 *
 * The "type" picker lets the user pick the right input control: text,
 * long text, number, date, or URL. The data is always stored as strings
 * regardless — types only affect the input rendered. */
export function CustomFieldsEditor({
  fields,
  onChange,
}: {
  fields: CustomField[]
  onChange: (next: CustomField[]) => void
}) {
  function addField() {
    onChange([
      ...fields,
      { id: genId(), label: '', type: 'text', value: '' },
    ])
  }

  function patchField(id: string, patch: Partial<CustomField>) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeField(id: string) {
    onChange(fields.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <ul className="space-y-2">
          {fields.map((field) => (
            <li
              key={field.id}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 space-y-2"
            >
              <div className="grid grid-cols-[1fr,140px,auto] gap-2">
                <input
                  className="rounded border bg-transparent px-2 py-1.5 text-sm font-medium"
                  placeholder="Field name (e.g. Campaign code)"
                  value={field.label}
                  onChange={(e) => patchField(field.id, { label: e.target.value })}
                />
                <select
                  className="rounded border bg-transparent px-2 py-1.5 text-sm"
                  value={field.type}
                  onChange={(e) =>
                    patchField(field.id, { type: e.target.value as CustomFieldType })
                  }
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeField(field.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-2"
                  aria-label="Remove field"
                >
                  Remove
                </button>
              </div>
              <FieldInput
                field={field}
                onChange={(v) => patchField(field.id, { value: v })}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={addField}
        className="rounded-lg border px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]/30"
      >
        + Add custom field
      </button>

      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Use custom fields for one-off data the job needs but the standard form doesn&rsquo;t cover —
        campaign codes, vendor refs, target audiences, etc.
      </p>
    </div>
  )
}
