-- Мини-CRM «Объекты и задачи»: схема, RLS, переходы статусов на уровне БД.

create type user_role as enum ('manager', 'worker');
create type task_status as enum ('new', 'in_progress', 'on_review', 'accepted', 'rework');

-- Профиль 1:1 к auth.users. Открытая регистрация отключена в настройках Auth,
-- пользователей создаёт администратор, поэтому профили заводятся вручную/сидом.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role user_role not null
);

create table objects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  created_by uuid not null references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  object_id uuid not null references objects (id) on delete cascade,
  assignee_id uuid not null references profiles (id),
  status task_status not null default 'new',
  author_id uuid not null references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references tasks (id) on delete cascade,
  from_status task_status, -- null = создание задачи
  to_status task_status not null,
  changed_by uuid not null references profiles (id),
  comment text,
  created_at timestamptz not null default now()
);

create index tasks_object_idx on tasks (object_id);
create index tasks_assignee_idx on tasks (assignee_id);
create index task_history_task_idx on task_history (task_id);

create or replace function is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'manager');
$$;

-- Смена статуса — только через эту функцию: она проверяет роль, назначение,
-- допустимость перехода и обязательность комментария, затем пишет историю.
create or replace function set_task_status(p_task_id uuid, p_new_status task_status, p_comment text default null)
returns tasks
language plpgsql security definer set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_old task_status;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found then
    raise exception 'Задача не найдена';
  end if;
  v_old := v_task.status;

  if is_manager() then
    if not (v_old = 'on_review' and p_new_status in ('accepted', 'rework')) then
      raise exception 'Недопустимый переход статуса: % → %', v_old, p_new_status;
    end if;
    if p_new_status = 'rework' and (p_comment is null or btrim(p_comment) = '') then
      raise exception 'При возврате на доработку комментарий обязателен';
    end if;
  elsif v_task.assignee_id = auth.uid() then
    if not ((v_old = 'new' and p_new_status = 'in_progress')
         or (v_old = 'in_progress' and p_new_status = 'on_review')
         or (v_old = 'rework' and p_new_status = 'in_progress')) then
      raise exception 'Недопустимый переход статуса: % → %', v_old, p_new_status;
    end if;
  else
    raise exception 'Нет прав на смену статуса этой задачи';
  end if;

  perform set_config('app.allow_status_change', 'on', true);
  update tasks set status = p_new_status where id = p_task_id returning * into v_task;
  insert into task_history (task_id, from_status, to_status, changed_by, comment)
  values (p_task_id, v_old, p_new_status, auth.uid(), nullif(btrim(coalesce(p_comment, '')), ''));
  return v_task;
end;
$$;

-- Блокирует прямое изменение status через UPDATE (в обход функции выше).
create or replace function guard_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_status_change', true), '') <> 'on' then
    raise exception 'Статус задачи меняется только через функцию set_task_status';
  end if;
  return new;
end;
$$;

create trigger tasks_guard_status
  before update on tasks
  for each row execute function guard_status_change();

-- Создание задачи = первый переход «— → Новая», тоже в историю.
create or replace function log_task_creation()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into task_history (task_id, from_status, to_status, changed_by)
  values (new.id, null, new.status, new.author_id);
  return new;
end;
$$;

create trigger tasks_log_creation
  after insert on tasks
  for each row execute function log_task_creation();

alter table profiles enable row level security;
alter table objects enable row level security;
alter table tasks enable row level security;
alter table task_history enable row level security;

-- Профили: имена коллег не секрет, читают все авторизованные.
-- Изменять профиль через API нельзя вовсе — иначе исполнитель сделал бы себя постановщиком.
create policy profiles_select on profiles for select to authenticated using (true);

-- Объекты: постановщик — всё; исполнитель — только объекты со своими задачами.
create policy objects_manager_all on objects for all to authenticated
  using (is_manager()) with check (is_manager());
create policy objects_worker_select on objects for select to authenticated
  using (exists (select 1 from tasks t where t.object_id = objects.id and t.assignee_id = auth.uid()));

-- Задачи: постановщик — всё; исполнитель — только чтение своих.
-- Новая задача создаётся только в статусе 'new' от имени автора.
create policy tasks_manager_select on tasks for select to authenticated using (is_manager());
create policy tasks_manager_insert on tasks for insert to authenticated
  with check (is_manager() and status = 'new' and author_id = auth.uid());
create policy tasks_manager_update on tasks for update to authenticated
  using (is_manager()) with check (is_manager());
create policy tasks_manager_delete on tasks for delete to authenticated using (is_manager());
create policy tasks_worker_select on tasks for select to authenticated
  using (assignee_id = auth.uid());

-- История: только чтение участниками задачи. Нет политик на insert/update/delete —
-- через API историю нельзя ни подделать, ни изменить, ни удалить
-- (записи создают только security definer функции выше).
create policy history_manager_select on task_history for select to authenticated
  using (is_manager());
create policy history_worker_select on task_history for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_history.task_id and t.assignee_id = auth.uid()));

grant execute on function set_task_status(uuid, task_status, text) to authenticated;

-- В hosted Supabase эти гранты уже выданы через default privileges;
-- явные гранты делают миграцию рабочей и на чистом Postgres (локальные тесты).
grant select, insert, update, delete on profiles, objects, tasks, task_history to authenticated;
