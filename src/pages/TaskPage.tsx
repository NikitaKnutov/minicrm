import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import {
  STATUS_LABEL,
  formatDate,
  type HistoryEntry,
  type Profile,
  type Task,
  type TaskStatus,
} from '../types'

type TaskRow = Task & {
  objects: { id: string; name: string } | null
  assignee: { full_name: string } | null
  author: { full_name: string } | null
}
type HistoryRow = HistoryEntry & { changer: { full_name: string } | null }

export default function TaskPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const isManager = profile!.role === 'manager'
  const navigate = useNavigate()

  const [task, setTask] = useState<TaskRow | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [workers, setWorkers] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)

  const [reworkOpen, setReworkOpen] = useState(false)
  const [comment, setComment] = useState('')

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAssignee, setEditAssignee] = useState('')

  async function load() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, objects!object_id(id, name), assignee:profiles!assignee_id(full_name), author:profiles!author_id(full_name)')
      .eq('id', id)
      .maybeSingle()
    if (error) return setError(error.message)
    if (!data) return setNotFound(true)
    setTask(data as TaskRow)
    const { data: h } = await supabase
      .from('task_history')
      .select('*, changer:profiles!changed_by(full_name)')
      .eq('task_id', id)
      .order('created_at')
    setHistory((h as HistoryRow[]) ?? [])
  }

  useEffect(() => {
    void load()
    if (isManager) {
      supabase
        .from('profiles')
        .select('*')
        .eq('role', 'worker')
        .order('full_name')
        .then(({ data }) => setWorkers(data ?? []))
    }
  }, [id])

  async function changeStatus(status: TaskStatus, withComment?: string) {
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('set_task_status', {
      p_task_id: id,
      p_new_status: status,
      p_comment: withComment ?? null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setReworkOpen(false)
    setComment('')
    void load()
  }

  async function saveTask(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase
      .from('tasks')
      .update({ title: editTitle, description: editDescription, assignee_id: editAssignee })
      .eq('id', id)
    if (error) return setError(error.message)
    setEditing(false)
    void load()
  }

  async function deleteTask() {
    if (!confirm(`Удалить задачу «${task!.title}»?`)) return
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) return setError(error.message)
    navigate(task!.objects ? `/objects/${task!.objects.id}` : '/')
  }

  if (notFound) return <p className="muted">Задача не найдена или у вас нет к ней доступа.</p>
  if (!task) return <p className="muted">Загрузка…</p>

  const isAssignee = task.assignee_id === profile!.id

  return (
    <>
      <p>
        <Link to={task.objects ? `/objects/${task.objects.id}` : '/'} className="muted">
          ← {task.objects?.name ?? 'Объекты'}
        </Link>
      </p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <form className="card form" onSubmit={saveTask}>
          <input required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          <textarea rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          <select required value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)}>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </select>
          <div className="actions">
            <button className="btn primary">Сохранить</button>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <div className="card">
          <div className="page-head">
            <h1>{task.title}</h1>
            <span className={`badge status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
          </div>
          {task.description && <p className="description">{task.description}</p>}
          <dl className="meta">
            <dt>Объект</dt>
            <dd>{task.objects?.name}</dd>
            <dt>Исполнитель</dt>
            <dd>{task.assignee?.full_name}</dd>
            <dt>Автор</dt>
            <dd>{task.author?.full_name}</dd>
            <dt>Создана</dt>
            <dd>{formatDate(task.created_at)}</dd>
          </dl>

          <div className="actions">
            {isAssignee && (task.status === 'new' || task.status === 'rework') && (
              <button className="btn primary" disabled={busy} onClick={() => changeStatus('in_progress')}>
                Взять в работу
              </button>
            )}
            {isAssignee && task.status === 'in_progress' && (
              <button className="btn primary" disabled={busy} onClick={() => changeStatus('on_review')}>
                Отправить на проверку
              </button>
            )}
            {isManager && task.status === 'on_review' && (
              <>
                <button className="btn primary" disabled={busy} onClick={() => changeStatus('accepted')}>
                  Принять
                </button>
                <button className="btn" disabled={busy} onClick={() => setReworkOpen((v) => !v)}>
                  Вернуть на доработку
                </button>
              </>
            )}
            {isManager && (
              <>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setEditTitle(task.title)
                    setEditDescription(task.description)
                    setEditAssignee(task.assignee_id)
                    setEditing(true)
                  }}
                >
                  Редактировать
                </button>
                <button className="btn danger" onClick={deleteTask}>
                  Удалить
                </button>
              </>
            )}
          </div>

          {reworkOpen && (
            <div className="rework-box">
              <textarea
                placeholder="Комментарий: что нужно доработать (обязательно)"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
              />
              <button
                className="btn primary"
                disabled={busy || comment.trim() === ''}
                onClick={() => changeStatus('rework', comment)}
              >
                Отправить на доработку
              </button>
            </div>
          )}
        </div>
      )}

      <h2>История</h2>
      <div className="card list">
        {history.map((h) => (
          <div key={h.id} className="history-row">
            <span className="muted">{formatDate(h.created_at)}</span>
            <span>{h.changer?.full_name}</span>
            <span>
              {h.from_status ? STATUS_LABEL[h.from_status] : '—'} →{' '}
              <span className={`badge status-${h.to_status}`}>{STATUS_LABEL[h.to_status]}</span>
            </span>
            {h.comment && <span className="muted">«{h.comment}»</span>}
          </div>
        ))}
      </div>
    </>
  )
}
