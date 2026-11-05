// Проверка прав и переходов статусов через реальный API Supabase.
// Запуск: node scripts/test-api.mjs  (нужен запущенный локальный Supabase и .env.test)
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!anonKey || !serviceKey) {
  console.error('Нужны SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const PASSWORD = 'Test1234!'

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

let failures = 0
function check(name, cond) {
  console.log(cond ? `ok   ${name}` : `FAIL ${name}`)
  if (!cond) failures++
}

async function makeUser(email, name, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error && !/already been registered/.test(error.message)) throw error
  const id =
    data?.user?.id ??
    (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await admin.from('profiles').upsert({ id, full_name: name, role })
  return id
}

async function login(email) {
  const c = createClient(url, anonKey, opts)
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return c
}

// --- пользователи ---
const managerId = await makeUser('manager@test.ru', 'Иван Петров', 'manager')
const worker1Id = await makeUser('worker1@test.ru', 'Сергей Сидоров', 'worker')
const worker2Id = await makeUser('worker2@test.ru', 'Алексей Козлов', 'worker')

const manager = await login('manager@test.ru')
const worker1 = await login('worker1@test.ru')
const worker2 = await login('worker2@test.ru')

// --- постановщик создаёт объект и задачи ---
const { data: obj, error: objErr } = await manager.from('objects').insert({ name: 'ЖК Тестовый', address: 'ул. Пробная, 1' }).select().single()
check('постановщик создаёт объект', !objErr && !!obj)

const { data: task1 } = await manager.from('tasks').insert({ title: 'Задача исполнителя 1', object_id: obj.id, assignee_id: worker1Id }).select().single()
const { data: task2 } = await manager.from('tasks').insert({ title: 'Задача исполнителя 2', object_id: obj.id, assignee_id: worker2Id }).select().single()
check('задача создаётся в статусе new', task1?.status === 'new')

// --- RLS: видимость ---
const { data: w1tasks } = await worker1.from('tasks').select('id')
check('исполнитель видит только свои задачи', w1tasks.length === 1 && w1tasks[0].id === task1.id)

const { data: stolen } = await worker1.from('tasks').select('*').eq('id', task2.id)
check('исполнитель не читает чужую задачу даже по прямой ссылке', stolen.length === 0)

const { data: w1objects } = await worker1.from('objects').select('id')
check('исполнитель видит объект со своей задачей', w1objects.some((o) => o.id === obj.id))

const { error: wCreateObj } = await worker1.from('objects').insert({ name: 'Самозванец' })
check('исполнитель не может создать объект', !!wCreateObj)

const { error: wCreateTask } = await worker1.from('tasks').insert({ title: 'x', object_id: obj.id, assignee_id: worker1Id })
check('исполнитель не может создать задачу', !!wCreateTask)

// --- переходы статусов ---
const ok = async (client, taskId, status, comment = null) =>
  (await client.rpc('set_task_status', { p_task_id: taskId, p_new_status: status, p_comment: comment })).error

check('исполнитель: new → in_progress', !(await ok(worker1, task1.id, 'in_progress')))
check('исполнитель: запрещённый переход in_progress → accepted', !!(await ok(worker1, task1.id, 'accepted')))
check('чужой исполнитель не ворует задачу (worker2 → задача worker1)', !!(await ok(worker2, task1.id, 'on_review')))
check('исполнитель: in_progress → on_review', !(await ok(worker1, task1.id, 'on_review')))
check('постановщик: on_review → rework без комментария отклонён', !!(await ok(manager, task1.id, 'rework')))
check('постановщик: on_review → rework с комментарием', !(await ok(manager, task1.id, 'rework', 'Переделать')))
check('исполнитель: rework → in_progress', !(await ok(worker1, task1.id, 'in_progress')))
check('исполнитель: повторно in_progress → on_review', !(await ok(worker1, task1.id, 'on_review')))
check('постановщик: on_review → accepted', !(await ok(manager, task1.id, 'accepted')))
check('accepted — конечный статус, дальше нельзя', !!(await ok(worker1, task1.id, 'in_progress')))

// --- прямое изменение статуса запрещено даже постановщику ---
const { error: directUpdate } = await manager.from('tasks').update({ status: 'accepted' }).eq('id', task2.id)
check('прямой UPDATE статуса заблокирован (только через функцию)', !!directUpdate)

// --- история ---
const { data: hist } = await worker1.from('task_history').select('*').eq('task_id', task1.id).order('created_at')
check('история содержит все переходы (создание + 6 смен)', hist.length === 7)
check('в истории сохранён комментарий доработки', hist.some((h) => h.comment === 'Переделать'))

// UPDATE/DELETE при RLS молча трогают 0 строк — проверяем через service-клиент, что данные не изменились.
await manager.from('task_history').update({ comment: 'подделка' }).eq('task_id', task1.id)
const { data: forged } = await admin.from('task_history').select('id').eq('comment', 'подделка')
check('историю нельзя изменить', forged.length === 0)
await manager.from('task_history').delete().eq('task_id', task1.id)
const { data: survived } = await admin.from('task_history').select('id').eq('task_id', task1.id)
check('историю нельзя удалить', survived.length === 7)
const { data: w2hist } = await worker2.from('task_history').select('id').eq('task_id', task1.id)
check('чужой исполнитель не читает историю чужой задачи', w2hist.length === 0)

// --- редактирование задачи постановщиком ---
const { error: editErr } = await manager.from('tasks').update({ title: 'Переименовано' }).eq('id', task2.id)
check('постановщик редактирует поля задачи', !editErr)

// --- уборка тестовых данных ---
await manager.from('objects').delete().eq('id', obj.id)

console.log(failures === 0 ? '\nВсе проверки прошли' : `\nПровалено: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
