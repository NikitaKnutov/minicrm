import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import type { SiteObject } from '../types'

export default function ObjectsPage() {
  const { profile } = useAuth()
  const isManager = profile!.role === 'manager'
  const [objects, setObjects] = useState<SiteObject[]>([])
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  async function load() {
    const { data, error } = await supabase.from('objects').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setObjects(data)
  }

  useEffect(() => {
    void load()
  }, [])

  async function createObject(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('objects').insert({ name, address })
    if (error) return setError(error.message)
    setName('')
    setAddress('')
    void load()
  }

  return (
    <>
      <h1>Объекты</h1>
      {error && <p className="error">{error}</p>}
      {isManager && (
        <form className="card inline-form" onSubmit={createObject}>
          <input placeholder="Название объекта" required value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Адрес" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="btn primary">Добавить объект</button>
        </form>
      )}
      {objects.length === 0 && <p className="muted">Пока нет объектов.</p>}
      <div className="grid">
        {objects.map((o) => (
          <Link to={`/objects/${o.id}`} key={o.id} className="card object-card">
            <h3>{o.name}</h3>
            {o.address && <p className="muted">{o.address}</p>}
          </Link>
        ))}
      </div>
    </>
  )
}
