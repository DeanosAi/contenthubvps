import { Job, Workspace } from './types'

export const demoUser = {
  id: 'demo-user',
  email: 'dean@example.com',
  name: 'Dean',
}

export const demoWorkspaces: Workspace[] = [
  {
    id: 'ws-mingara',
    ownerId: demoUser.id,
    name: 'Mingara',
    color: '#8b5cf6',
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ws-sca',
    ownerId: demoUser.id,
    name: 'SCA',
    color: '#06b6d4',
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export const demoJobs: Job[] = [
  {
    id: 'job-1',
    workspaceId: 'ws-mingara',
    title: 'ANZAC Day recap reel',
    description: 'Short social recap for Instagram and Facebook.',
    stage: 'brief',
    priority: 2,
    dueDate: null,
    hashtags: '#anzacday #mingara',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'job-2',
    workspaceId: 'ws-mingara',
    title: 'Weekend promo cutdown',
    description: 'Club promo edit with multiple aspect ratios.',
    stage: 'production',
    priority: 1,
    dueDate: null,
    hashtags: '#weekend #promo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'job-3',
    workspaceId: 'ws-sca',
    title: 'Client social highlights pack',
    description: 'Highlight clips and captions ready for review.',
    stage: 'ready',
    priority: 0,
    dueDate: null,
    hashtags: '#radio #social',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
