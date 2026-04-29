import { BrieferShell } from '@/components/briefer-shell'
import { BriefSubmitForm } from '@/components/brief-submit-form'
import { requireBrieferPage } from '@/lib/page-guards'

export default async function BrieferSubmitPage() {
  await requireBrieferPage()
  return (
    <BrieferShell>
      <BriefSubmitForm />
    </BrieferShell>
  )
}
