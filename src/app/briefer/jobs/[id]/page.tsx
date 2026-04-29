import { BrieferShell } from '@/components/briefer-shell'
import { BrieferJobDetail } from '@/components/briefer-job-detail'
import { requireBrieferPage } from '@/lib/page-guards'

export default async function BrieferJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireBrieferPage()
  const { id } = await params
  return (
    <BrieferShell>
      <BrieferJobDetail jobId={id} />
    </BrieferShell>
  )
}
