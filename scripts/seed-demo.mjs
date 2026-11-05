// Демо-данные для сдачи: 3 объекта, задачи в разных статусах, реальная история.
// Запуск: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const { SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env
if (!anonKey || !serviceKey) {
  console.error('Нужны SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const PASSWORD = 'Demo1234!'

// Сеть бывает нестабильной — fetch с ретраями для всех вызовов supabase-js.
async function fetchWithRetry(input, init, attempt = 1) {
  try {
    return await fetch(input, init)
  } catch (e) {
    if (attempt === 10) throw e
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    return fetchWithRetry(input, init, attempt + 1)
  }
}
const opts = { auth: { persistSession: false }, global: { fetch: fetchWithRetry } }

const admin = createClient(url, serviceKey, opts)

async function makeUser(email, name, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error && !/already been registered/.test(error.message)) throw error
  const id = data?.user?.id ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await admin.from('profiles').upsert({ id, full_name: name, role })
  return id
}

async function login(email) {
  const c = createClient(url, anonKey, opts)
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return c
}

const managerId = await makeUser('director@demo.ru', 'Иван Петров', 'manager')
const worker1Id = await makeUser('worker1@demo.ru', 'Сергей Сидоров', 'worker')
const worker2Id = await makeUser('worker2@demo.ru', 'Алексей Козлов', 'worker')

const manager = await login('director@demo.ru')
const worker1 = await login('worker1@demo.ru')
const worker2 = await login('worker2@demo.ru')

async function addObject(name, address) {
  const { data, error } = await manager.from('objects').insert({ name, address }).select().single()
  if (error) throw error
  return data.id
}

async function addTask(title, description, objectId, assigneeId) {
  const { data, error } = await manager
    .from('tasks')
    .insert({ title, description, object_id: objectId, assignee_id: assigneeId })
    .select()
    .single()
  if (error) throw error
  return data.id
}

const move = (client, taskId, status, comment = null) =>
  client.rpc('set_task_status', { p_task_id: taskId, p_new_status: status, p_comment: comment }).then(({ error }) => {
    if (error) throw error
  })

const objA = await addObject('ЖК «Северный»', 'ул. Строителей, 12')
const objB = await addObject('Школа № 15', 'пр. Ленина, 45')
const objC = await addObject('ТЦ «Меридиан»', 'ш. Энтузиастов, 3')

// Новая
await addTask('Разметить парковку', 'Разметка гостевой парковки по плану Б-3.', objA, worker2Id)

// В работе
const t2 = await addTask('Залить стяжку, секция 2', 'Толщина 50 мм, срок — пятница.', objA, worker1Id)
await move(worker1, t2, 'in_progress')

// На проверке
const t3 = await addTask('Смонтировать стойки лифтовых холлов', 'Этажи 3–5, по чертежу ЛХ-12.', objA, worker1Id)
await move(worker1, t3, 'in_progress')
await move(worker1, t3, 'on_review')

// На доработке (с комментарием в истории)
const t4 = await addTask('Покрасить фасадные панели', 'Цвет RAL 7016, двухслойное покрытие.', objB, worker2Id)
await move(worker2, t4, 'in_progress')
await move(worker2, t4, 'on_review')
await move(manager, t4, 'rework', 'На панелях 14–16 потёки, нужен третий слой')

// Принята
const t5 = await addTask('Установить окна в актовом зале', '12 блоков, проверить откосы.', objB, worker2Id)
await move(worker2, t5, 'in_progress')
await move(worker2, t5, 'on_review')
await move(manager, t5, 'accepted')

// Ещё новая на третьем объекте
await addTask('Согласовать входную группу', 'Встреча с представителем заказчика, взять акт.', objC, worker1Id)

console.log(`Готово. Вход: director@demo.ru / worker1@demo.ru / worker2@demo.ru, пароль у всех: ${PASSWORD}`)
console.log(`manager=${managerId} worker1=${worker1Id} worker2=${worker2Id}`)
