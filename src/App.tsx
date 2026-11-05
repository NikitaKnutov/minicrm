import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { ROLE_LABEL } from './types'
import Login from './Login'
import ObjectsPage from './pages/ObjectsPage'
import ObjectPage from './pages/ObjectPage'
import TaskPage from './pages/TaskPage'
import MyTasksPage from './pages/MyTasksPage'

export default function App() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading || (session && !profile)) {
    return <div className="center muted">Загрузка…</div>
  }
  if (!session || !profile) return <Login />

  return (
    <>
      <header className="topbar">
        <Link to="/" className="logo">
          Мини-CRM
        </Link>
        <nav>
          <Link to="/">Объекты</Link>
          {profile.role === 'worker' && <Link to="/my">Мои задачи</Link>}
        </nav>
        <div className="user">
          <span className={`badge role-${profile.role}`}>{ROLE_LABEL[profile.role]}</span>
          <span>{profile.full_name}</span>
          <button className="btn ghost" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<ObjectsPage />} />
          <Route path="/objects/:id" element={<ObjectPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/my" element={<MyTasksPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
