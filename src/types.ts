export type Role = 'manager' | 'worker'

export type TaskStatus = 'new' | 'in_progress' | 'on_review' | 'accepted' | 'rework'

export interface Profile {
  id: string
  full_name: string
  role: Role
}

export interface SiteObject {
  id: string
  name: string
  address: string
  created_by: string
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string
  object_id: string
  assignee_id: string
  status: TaskStatus
  author_id: string
  created_at: string
}

export interface HistoryEntry {
  id: number
  task_id: string
  from_status: TaskStatus | null
  to_status: TaskStatus
  changed_by: string
  comment: string | null
  created_at: string
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  on_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
}

export const ROLE_LABEL: Record<Role, string> = {
  manager: 'Постановщик',
  worker: 'Исполнитель',
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}
