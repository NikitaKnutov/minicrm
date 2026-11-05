-- Проверки RLS и переходов статусов на чистом Postgres.
-- Прогон: psql -v ON_ERROR_STOP=1 — любой FAIL роняет весь скрипт.
\set ON_ERROR_STOP on

create or replace function assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice 'ok: %', p_msg;
  else raise exception 'FAIL: %', p_msg; end if;
end $$;

-- Выполняет SQL от имени текущей роли и ждёт ошибку.
create or replace function assert_fails(p_sql text, p_msg text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL (ожидалась ошибка): %', p_msg;
exception when others then
  if sqlerrm like 'FAIL (ожидалась ошибка):%' then raise; end if;
  raise notice 'ok: % [%]', p_msg, sqlerrm;
end $$;

\set manager_id '''11111111-1111-1111-1111-111111111111'''
\set worker1_id '''22222222-2222-2222-2222-222222222222'''
\set worker2_id '''33333333-3333-3333-3333-333333333333'''

insert into auth.users values (:manager_id), (:worker1_id), (:worker2_id);
insert into profiles values
  (:manager_id, 'Иван Петров', 'manager'),
  (:worker1_id, 'Сергей Сидоров', 'worker'),
  (:worker2_id, 'Алексей Козлов', 'worker');

-- ===== Постановщик =====
set role authenticated;
select become(:manager_id);

insert into objects (name, address) values ('ЖК Тестовый', 'ул. Пробная, 1') returning id \gset
insert into tasks (title, object_id, assignee_id) values ('Задача исполнителя 1', :'id', :worker1_id) returning id as task1 \gset t1_
insert into tasks (title, object_id, assignee_id) values ('Задача исполнителя 2', :'id', :worker2_id) returning id as task2 \gset t2_

select assert((select status = 'new' from tasks where id = :'t1_task1'), 'задача создаётся в статусе new');
select assert_fails(
  format('insert into tasks (title, object_id, assignee_id, status) values (''x'', %L, %L, ''accepted'')', :'id', :worker1_id),
  'нельзя создать задачу сразу в статусе accepted');

-- ===== Исполнитель 1: видимость =====
select become(:worker1_id);
select assert((select count(*) = 1 and bool_and(id = :'t1_task1') from tasks), 'исполнитель видит только свою задачу');
select assert((select count(*) = 0 from tasks where id = :'t2_task2'), 'исполнитель не читает чужую задачу по id');
select assert((select count(*) = 1 from objects where id = :'id'), 'исполнитель видит объект со своей задачей');
select assert_fails('insert into objects (name) values (''Самозванец'')', 'исполнитель не создаёт объект');
select assert_fails(
  format('insert into tasks (title, object_id, assignee_id) values (''x'', %L, %L)', :'id', :worker1_id),
  'исполнитель не создаёт задачу');
-- UPDATE/DELETE при RLS молча трогают 0 строк — проверяем, что данные не изменились.
update tasks set title = 'взлом' where id = :'t1_task1';
select assert((select title = 'Задача исполнителя 1' from tasks where id = :'t1_task1'), 'исполнитель не редактирует задачу');

-- ===== Переходы статусов =====
select assert_fails(
  format('select set_task_status(%L, ''accepted'')', :'t1_task1'),
  'исполнитель: запрещённый переход new → accepted');
select set_task_status(:'t1_task1', 'in_progress');
select assert((select status = 'in_progress' from tasks where id = :'t1_task1'), 'исполнитель: new → in_progress');

-- Чужой исполнитель пытается сменить статус
select become(:worker2_id);
select assert_fails(
  format('select set_task_status(%L, ''on_review'')', :'t1_task1'),
  'исполнитель 2 не трогает задачу исполнителя 1');

select become(:worker1_id);
select set_task_status(:'t1_task1', 'on_review');
select assert((select status = 'on_review' from tasks where id = :'t1_task1'), 'исполнитель: in_progress → on_review');
select assert_fails(
  format('select set_task_status(%L, ''accepted'')', :'t1_task1'),
  'исполнитель не принимает свою задачу сам');

-- ===== Постановщик: проверка =====
select become(:manager_id);
select assert_fails(
  format('select set_task_status(%L, ''rework'')', :'t1_task1'),
  'rework без комментария отклонён');
select assert_fails(
  format('select set_task_status(%L, ''rework'', ''   '')', :'t1_task1'),
  'rework с пустым комментарием отклонён');
select set_task_status(:'t1_task1', 'rework', 'Переделать');
select assert((select status = 'rework' from tasks where id = :'t1_task1'), 'постановщик: on_review → rework с комментарием');

-- Прямой UPDATE статуса запрещён даже постановщику
select assert_fails(
  format('update tasks set status = ''accepted'' where id = %L', :'t1_task1'),
  'прямой UPDATE статуса заблокирован триггером');
-- А редактировать поля — можно
update tasks set title = 'Переименовано' where id = :'t2_task2';
select assert((select title = 'Переименовано' from tasks where id = :'t2_task2'), 'постановщик редактирует поля задачи');

-- ===== Полный цикл до принятия =====
select become(:worker1_id);
select set_task_status(:'t1_task1', 'in_progress');
select set_task_status(:'t1_task1', 'on_review');
select become(:manager_id);
select set_task_status(:'t1_task1', 'accepted');
select assert((select status = 'accepted' from tasks where id = :'t1_task1'), 'постановщик: on_review → accepted');
select become(:worker1_id);
select assert_fails(
  format('select set_task_status(%L, ''in_progress'')', :'t1_task1'),
  'accepted — конечный статус');

-- ===== История =====
select assert((select count(*) = 7 from task_history where task_id = :'t1_task1'), 'история: создание + 6 смен статуса');
select assert((select count(*) = 1 from task_history where task_id = :'t1_task1' and comment = 'Переделать'), 'комментарий доработки в истории');
select assert((select changed_by = :manager_id from task_history where task_id = :'t1_task1' and to_status = 'accepted'), 'в истории видно, кто принял задачу');

update task_history set comment = 'подделка' where task_id = :'t1_task1';
select assert((select count(*) = 0 from task_history where comment = 'подделка'), 'историю нельзя изменить');
delete from task_history where task_id = :'t1_task1';
select assert((select count(*) = 7 from task_history where task_id = :'t1_task1'), 'историю нельзя удалить');
select assert_fails(
  format('insert into task_history (task_id, to_status, changed_by) values (%L, ''accepted'', %L)', :'t1_task1', :worker1_id),
  'историю нельзя подделать вручную');

-- Исполнитель 2 не читает историю чужой задачи
select become(:worker2_id);
select assert((select count(*) = 0 from task_history where task_id = :'t1_task1'), 'чужой исполнитель не читает историю');

-- Исполнитель не может стать постановщиком
update profiles set role = 'manager' where id = :worker1_id;
select assert((select role = 'worker' from profiles where id = :worker1_id), 'исполнитель не повышает себе роль');

reset role;
\echo '=== Все проверки прошли ==='
