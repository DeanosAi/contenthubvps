"use client"

export function DashboardFilters({
  keyword,
  setKeyword,
  stage,
  setStage,
  platform,
  setPlatform,
}: {
  keyword: string
  setKeyword: (v: string) => void
  stage: string
  setStage: (v: string) => void
  platform: string
  setPlatform: (v: string) => void
}) {
  return (
    <div className="grid md:grid-cols-3 gap-4 rounded-2xl border bg-[hsl(var(--card))] p-5">
      <input className="rounded-lg border bg-transparent px-3 py-2" placeholder="Search jobs..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <select className="rounded-lg border bg-transparent px-3 py-2" value={stage} onChange={(e) => setStage(e.target.value)}>
        <option value="">All stages</option>
        <option value="brief">Brief</option>
        <option value="production">Production</option>
        <option value="ready">Ready</option>
        <option value="posted">Posted</option>
        <option value="archive">Archive</option>
      </select>
      <select className="rounded-lg border bg-transparent px-3 py-2" value={platform} onChange={(e) => setPlatform(e.target.value)}>
        <option value="">All platforms</option>
        <option value="instagram">Instagram</option>
        <option value="facebook">Facebook</option>
        <option value="tiktok">TikTok</option>
        <option value="youtube">YouTube</option>
      </select>
    </div>
  )
}
