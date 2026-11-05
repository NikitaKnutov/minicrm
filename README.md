# Мини-CRM «Объекты и задачи»

CRM для строительной компании: постановщик ставит задачи по объектам (стройкам), исполнители выполняют их и отдают на проверку.

Стек: React + TypeScript + Vite, Supabase (Postgres + Auth + RLS).

## Локальный запуск

```bash
npm install
cp .env.example .env   # вписать VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm run dev
```

## Развёртывание базы (Supabase)

1. Создайте бесплатный проект на [supabase.com](https://supabase.com).
2. Установите CLI: `npm install` (CLI уже в dev-зависимостях) и привяжите проект:
   ```bash
   npx supabase login
   npx supabase link --project-ref <id-проекта>
   npx supabase db push        # применит миграции из supabase/migrations/
   ```
   Либо выполните `supabase/migrations/0001_init.sql` в SQL Editor дашборда.
3. **Отключите открытую регистрацию**: Authentication → Sign In / Up → выключить «Allow new users to sign up».
4. Создайте пользователей: Authentication → Users → Add user (минимум 1 постановщик и 2 исполнителя).
5. Проставьте им роли и имена в таблице `profiles` (Table Editor):
   роль `manager` — постановщик, `worker` — исполнитель.
6. Возьмите `Project URL` и `anon public` ключ: Project Settings → Data API — они нужны для `.env`.

## Деплой на Vercel (бесплатно)

```bash
npm i -g vercel && vercel
```

или через GitHub: запушить репозиторий → [vercel.com/new](https://vercel.com/new) → Import →
добавить переменные окружения `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` → Deploy.
`vercel.json` с SPA-rewrite уже в репозитории. Service-role ключ никуда не нужен.

## Локальная разработка с Supabase в Docker

```bash
npx supabase start            # поднимает локальный стек, печатает URL и ключи
psql "$DB_URL" -f supabase/migrations/0001_init.sql
```

## Проверка безопасности

`scripts/test-api.mjs` гоняет реальные API-запросы за постановщика и двух исполнителей
и проверяет: видимость чужих задач, запрет прямого UPDATE статуса, все разрешённые и
запрещённые переходы, обязательность комментария, неизменяемость истории.

```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run test:api
```

Демо-данные (3 объекта, задачи во всех статусах, реальная история; пользователи
`director@demo.ru`, `worker1@demo.ru`, `worker2@demo.ru` с паролем `Demo1234!`):

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
```

Service-role ключ используется только в этих скриптах на вашей машине —
в репозиторий и во фронтенд он не попадает.

## Архитектура безопасности

- Права закрыты RLS-политиками в Postgres, а не в интерфейсе.
- Статус задачи меняется только через функцию `set_task_status(...)`: она проверяет
  роль, назначение исполнителя, допустимость перехода и обязательность комментария
  при возврате на доработку. Прямой `UPDATE status` блокирует триггер
  `guard_status_change` — даже постановщику.
- История пишется только из security-definer функций; политик на
  insert/update/delete у `task_history` нет — через API её нельзя подделать,
  изменить или удалить.
- Профили нельзя редактировать через API, иначе исполнитель назначил бы себе роль
  постановщика.
