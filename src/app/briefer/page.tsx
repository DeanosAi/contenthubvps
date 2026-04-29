import { BrieferShell } from '@/components/briefer-shell'
import { BrieferJobsList } from '@/components/briefer-jobs-list'
import { requireBrieferPage } from '@/lib/page-guards'

export default async function BrieferHome() {
  // Round 7.11: redirect staff (admin/member) to /app — only briefers
  // belong here.
  await requireBrieferPage()
  return (
    <BrieferShell>
      <BrieferJobsList />
    </BrieferShell>
  )
}
