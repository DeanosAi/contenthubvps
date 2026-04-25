export type JobStage = 'brief' | 'production' | 'ready' | 'posted' | 'archive'

export interface Workspace {
  id: string
  ownerId: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface Job {
  id: string
  workspaceId: string
  title: string
  description: string | null
  stage: JobStage
  priority: number
  dueDate: string | null
  hashtags: string | null
  platform: string | null
  liveUrl: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}
