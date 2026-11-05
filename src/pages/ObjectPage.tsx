import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { STATUS_LABEL, type Profile, type SiteObject, type Task } from '../types'

type TaskRow = Task & { assignee: { full_name: string } | null }

export default function ObjectPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const isManager = profile!.role === 'manager'
  const navigate = useNavigate()

  const [object, setObject] = useState<SiteObject | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [workers, setWorkers] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')

  async function load() {
    const { data: obj, error: objError } = await supabase.from('objects').select('*').eq('id', id).maybeSingle()
    if (objError) return setError(objError.message)
    if (!obj) return setNotFound(true)
    setObject(obj)
    const { data, error } = await supabase
      .from('tasks')
      .select('*, assignee:profiles!assignee_id(full_name)')
      .eq('object_id', id)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setTasks(data as TaskRow[])
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

  async function saveObject(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('objects').update({ name: editName, address: editAddress }).eq('id', id)
    if (error) return setError(error.message)
    setEditing(false)
    void load()
  }

  async function deleteObject() {
    if (!confirm(`Удалить объект «${object!.name}» вместе со всеми задачами?`)) return
    const { error } = await supabase.from('objects').delete().eq('id', id)
    if (error) return setError(error.message)
    navigate('/')
  }

  async function createTask(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase
      .from('tasks')
      .insert({ title, description, object_id: id, assignee_id: assigneeId })
    if (error) return setError(error.message)
    setTitle('')
    setDescription('')
    setAssigneeId('')
    void load()
  }

  if (notFound) return <p className="muted">Объект не найден или у вас нет к нему доступа.</p>
  if (!object) return <p className="muted">Загрузка…</p>

  return (
    <>
      <p>
        <Link to="/" className="muted">
          ← Все объекты
        </Link>
      </p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <form className="card inline-form" onSubmit={saveObject}>
          <input required value={editName} onChange={(e) => setEditName(e.target.value)} />
          <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="Адрес" />
          <button className="btn primary">Сохранить</button>
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </form>
      ) : (
        <div className="page-head">
          <div>
            <h1>{object.name}</h1>
            {object.address && <p className="muted">{object.address}</p>}
          </div>
          {isManager && (
            <div className="actions">
              <button
                className="btn"
                onClick={() => {
                  setEditName(object.name)
                  setEditAddress(object.address)
                  setEditing(true)
                }}
              >
                Редактировать
              </button>
              <button className="btn danger" onClick={deleteObject}>
                Удалить
              </button>
            </div>
          )}
        </div>
      )}

      <h2>Задачи</h2>
      {tasks.length === 0 && <p className="muted">Задач пока нет.</p>}
      <div className="card list">
        {tasks.map((t) => (
          <Link to={`/tasks/${t.id}`} key={t.id} className="list-row">
            <span>{t.title}</span>
            <span className="muted">{t.assignee?.full_name}</span>
            <span className={`badge status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          </Link>
        ))}
      </div>

      {isManager && (
        <>
          <h2>Новая задача</h2>
          <form className="card form" onSubmit={createTask}>
            <input
              placeholder="Название задачи"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              placeholder="Описание"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <select required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="" disabled>
                Исполнитель…
              </option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
            <button className="btn primary">Создать задачу</button>
          </form>
        </>
      )}
    </>
  )
}
