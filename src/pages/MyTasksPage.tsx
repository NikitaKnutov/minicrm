import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import { STATUS_LABEL, type Task } from '../types'

type TaskRow = Task & { objects: { name: string } | null }

export default function MyTasksPage() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('tasks')
      .select('*, objects!object_id(name)')
      .eq('assignee_id', profile!.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTasks(data as TaskRow[])
      })
  }, [])

  return (
    <>
      <h1>Мои задачи</h1>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 && <p className="muted">Вам пока не назначили задач.</p>}
      <div className="card list">
        {tasks.map((t) => (
          <Link to={`/tasks/${t.id}`} key={t.id} className="list-row">
            <span>{t.title}</span>
            <span className="muted">{t.objects?.name}</span>
            <span className={`badge status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
