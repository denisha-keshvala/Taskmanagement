
-- ============================================================
-- TASK COMMAND SYSTEM - SUPABASE DATABASE
-- Converted from the supplied Google Apps Script + Index.html.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

create table if not exists public.employees (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  role text not null default 'Employee',
  email text default '',
  phone text default '',
  photo text default '',
  employee_id text not null unique,
  password_hash text not null,
  department text default 'Other',
  joining_date date default current_date,
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);

-- ------------------------------------------------------------
-- COMPATIBILITY MIGRATION
-- The project may already contain an older `employees` table.
-- `create table if not exists` does not add missing columns, so
-- migrate the old table before creating indexes/functions.
-- ------------------------------------------------------------
DO $$
DECLARE
  legacy_employee_id_col text;
  legacy_password_col text;
BEGIN
  IF to_regclass('public.employees') IS NULL THEN
    RETURN;
  END IF;

  -- Required modern columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='id') THEN
    ALTER TABLE public.employees ADD COLUMN id uuid DEFAULT extensions.gen_random_uuid();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='name') THEN
    ALTER TABLE public.employees ADD COLUMN name text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='role') THEN
    ALTER TABLE public.employees ADD COLUMN role text DEFAULT 'Employee';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='email') THEN
    ALTER TABLE public.employees ADD COLUMN email text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='phone') THEN
    ALTER TABLE public.employees ADD COLUMN phone text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='photo') THEN
    ALTER TABLE public.employees ADD COLUMN photo text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='employee_id') THEN
    ALTER TABLE public.employees ADD COLUMN employee_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='password_hash') THEN
    ALTER TABLE public.employees ADD COLUMN password_hash text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='department') THEN
    ALTER TABLE public.employees ADD COLUMN department text DEFAULT 'Other';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='joining_date') THEN
    ALTER TABLE public.employees ADD COLUMN joining_date date DEFAULT current_date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='updated_at') THEN
    ALTER TABLE public.employees ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='employees' AND column_name='is_active') THEN
    ALTER TABLE public.employees ADD COLUMN is_active boolean DEFAULT true;
  END IF;

  -- Copy EmployeeID / Password from older camel-case or legacy schemas when present.
  SELECT column_name INTO legacy_employee_id_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='employees'
    AND lower(column_name)='employeeid' AND column_name <> 'employee_id'
  LIMIT 1;

  IF legacy_employee_id_col IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.employees SET employee_id = COALESCE(NULLIF(employee_id, ''''), NULLIF(%I::text, '''')) WHERE employee_id IS NULL OR btrim(employee_id) = ''''',
      legacy_employee_id_col
    );
  END IF;

  SELECT column_name INTO legacy_password_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='employees'
    AND lower(column_name)='password' AND column_name <> 'password_hash'
  LIMIT 1;

  IF legacy_password_col IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.employees SET password_hash = extensions.crypt(%I::text, extensions.gen_salt(''bf'')) WHERE (password_hash IS NULL OR btrim(password_hash) = '''') AND %I IS NOT NULL AND btrim(%I::text) <> ''''',
      legacy_password_col, legacy_password_col, legacy_password_col
    );
  END IF;

  -- Fill missing IDs/default values without deleting existing rows.
  UPDATE public.employees SET id = extensions.gen_random_uuid() WHERE id IS NULL;
  UPDATE public.employees SET name = COALESCE(NULLIF(btrim(name),''),'Employee') WHERE name IS NULL OR btrim(name)='';
  UPDATE public.employees SET role = COALESCE(NULLIF(btrim(role),''),'Employee') WHERE role IS NULL OR btrim(role)='';
  UPDATE public.employees SET email = COALESCE(email,'') WHERE email IS NULL;
  UPDATE public.employees SET phone = COALESCE(phone,'') WHERE phone IS NULL;
  UPDATE public.employees SET photo = COALESCE(photo,'') WHERE photo IS NULL;
  UPDATE public.employees SET department = COALESCE(NULLIF(btrim(department),''),'Other') WHERE department IS NULL OR btrim(department)='';
  UPDATE public.employees SET joining_date = COALESCE(joining_date,current_date) WHERE joining_date IS NULL;
  UPDATE public.employees SET updated_at = COALESCE(updated_at,now()) WHERE updated_at IS NULL;
  UPDATE public.employees SET is_active = COALESCE(is_active,true) WHERE is_active IS NULL;

  -- If old records have no ID, generate one. If they have no login ID,
  -- derive it from the employee name.
  UPDATE public.employees
  SET employee_id = lower(regexp_replace(btrim(name),'\s+','','g'))
  WHERE employee_id IS NULL OR btrim(employee_id)='';

  -- Generate a usable default password for records that do not have one.
  UPDATE public.employees
  SET password_hash = extensions.crypt(lower(employee_id) || '@123', extensions.gen_salt('bf'))
  WHERE password_hash IS NULL OR btrim(password_hash)='';

  ALTER TABLE public.employees ALTER COLUMN id SET NOT NULL;
  ALTER TABLE public.employees ALTER COLUMN employee_id SET NOT NULL;
  ALTER TABLE public.employees ALTER COLUMN password_hash SET NOT NULL;
  ALTER TABLE public.employees ALTER COLUMN is_active SET NOT NULL;
END $$;

-- Unique/lookup indexes.
create index if not exists employees_employee_id_idx
  on public.employees(lower(employee_id));

-- The upsert functions use ON CONFLICT(employee_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.employees'::regclass
      AND contype='u'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attname='employee_id')]
  ) THEN
    BEGIN
      ALTER TABLE public.employees ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

create table if not exists public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  task_code text not null unique,
  task_type text not null,
  assigned_to text not null,
  priority text not null default 'Medium',
  deadline date,
  reminder timestamptz,
  description text default '',
  file_url text default '',
  status text not null default 'Pending'
    check (status in ('Pending','In Progress','Completed','Overdue','Cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,
  created_by_name text default '',
  department text default 'Other',
  follow_up text default ''
);

create index if not exists tasks_status_idx
  on public.tasks(status);

create index if not exists tasks_deadline_idx
  on public.tasks(deadline);

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.employees(id) on delete cascade,
  user_name text not null,
  message text not null,
  type text not null default 'Update',
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create index if not exists notifications_user_name_idx
  on public.notifications(lower(user_name));

create table if not exists public.announcements (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  description text not null,
  type text not null default 'Announcement',
  file_url text default '',
  created_by uuid references public.employees(id) on delete set null,
  created_by_name text default '',
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists public.task_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  task_code text,
  file_name text not null,
  file_url text not null,
  file_type text default '',
  file_size bigint default 0,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_reactions (
  id uuid primary key default extensions.gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  unique (announcement_id, employee_id)
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings(key,value)
values ('task_counter','1001')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- STORAGE
-- ------------------------------------------------------------

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values
(
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg','image/png','image/webp']
),
(
  'task-attachments',
  'task-attachments',
  true,
  8388608,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
drop policy if exists "avatars anon upload" on storage.objects;
drop policy if exists "avatars anon update" on storage.objects;
drop policy if exists "avatars anon delete" on storage.objects;
drop policy if exists "task files public read" on storage.objects;
drop policy if exists "task files anon upload" on storage.objects;
drop policy if exists "task files anon update" on storage.objects;
drop policy if exists "task files anon delete" on storage.objects;

create policy "avatars public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'avatars');

create policy "avatars anon upload"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'avatars');

create policy "avatars anon update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'avatars')
with check (bucket_id = 'avatars');

create policy "avatars anon delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'avatars');

create policy "task files public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'task-attachments');

create policy "task files anon upload"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'task-attachments');

create policy "task files anon update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'task-attachments')
with check (bucket_id = 'task-attachments');

create policy "task files anon delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'task-attachments');


create table if not exists public.app_sessions (
  token text primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists app_sessions_employee_idx
  on public.app_sessions(employee_id);

-- ------------------------------------------------------------
-- HELPER FUNCTIONS
-- ------------------------------------------------------------

create or replace function public.is_owner(p_employee_id text)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_catalog
as $$
  select exists(
    select 1
    from public.employees e
    where lower(e.employee_id) = lower(trim(p_employee_id))
      and e.is_active = true
      and lower(trim(e.role)) in ('owner','admin')
  );
$$;

create or replace function public.next_task_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  n integer;
begin
  select value::integer
    into n
  from public.app_settings
  where key = 'task_counter'
  for update;

  if n is null then
    n := 1001;
  end if;

  update public.app_settings
  set value = (n + 1)::text
  where key = 'task_counter';

  return 'TC-' || n;
end;
$$;


create or replace function public.get_session_employee(
  p_employee_id text,
  p_session_token text
)
returns public.employees
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  e public.employees%rowtype;
  p_session_token text;
begin
  select e.*
    into e
  from public.employees e
  join public.app_sessions s on s.employee_id=e.id
  where lower(e.employee_id)=lower(trim(p_employee_id))
    and s.token=trim(p_session_token)
    and s.expires_at>now()
    and e.is_active=true
  limit 1;

  if not found then
    raise exception 'Session expired. Please login again.';
  end if;

  update public.app_sessions
  set expires_at=now()+interval '7 days'
  where token=trim(p_session_token);

  return e;
end;
$$;

-- ------------------------------------------------------------
-- LOGIN
-- Uses bcrypt via pgcrypto. Password is never returned to client.
-- ------------------------------------------------------------

create or replace function public.login_employee(
  p_login_id text,
  p_password text,
  p_department text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  e public.employees%rowtype;
begin
  select *
    into e
  from public.employees
  where lower(trim(employee_id)) = lower(trim(p_login_id))
    and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'message','Invalid Employee ID or password.');
  end if;

  if e.password_hash <> extensions.crypt(p_password, e.password_hash) then
    return jsonb_build_object('ok',false,'message','Invalid Employee ID or password.');
  end if;

  if coalesce(trim(p_department),'') = '' then
    return jsonb_build_object('ok',false,'message','Please select department.');
  end if;

  if coalesce(e.department,'') <> ''
     and lower(trim(e.department)) <> lower(trim(p_department)) then
    return jsonb_build_object(
      'ok',false,
      'message','Wrong department selected. Please select ' || e.department || '.'
    );
  end if;

  delete from public.app_sessions
  where employee_id=e.id and expires_at<=now();

  insert into public.app_sessions(token,employee_id)
  values(encode(extensions.gen_random_bytes(32),'hex'),e.id)
  returning token into strict p_session_token;

  return jsonb_build_object(
    'ok',true,
    'sessionToken',p_session_token,
    'member',jsonb_build_object(
      'name',e.name,
      'role',e.role,
      'email',e.email,
      'phone',e.phone,
      'photo',e.photo,
      'employeeId',e.employee_id,
      'password','',
      'department',coalesce(e.department,p_department),
      'joiningDate',e.joining_date,
      'updatedAt',e.updated_at
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- APP DATA
-- ------------------------------------------------------------

create or replace function public.get_app_data(p_employee_id text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  me public.employees%rowtype;
  owner_user boolean;
begin
  me := public.get_session_employee(p_employee_id,p_session_token);

  owner_user := lower(trim(me.role)) in ('owner','admin');

  return jsonb_build_object(
    'members',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',e.name,
        'role',e.role,
        'email',e.email,
        'phone',e.phone,
        'photo',e.photo,
        'employeeId',e.employee_id,
        'password','',
        'department',e.department,
        'joiningDate',e.joining_date,
        'updatedAt',e.updated_at
      ) order by e.name)
      from public.employees e
      where e.is_active=true
    ),'[]'::jsonb),

    'tasks',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.task_code,
        'taskType',t.task_type,
        'assignedTo',t.assigned_to,
        'priority',t.priority,
        'deadline',t.deadline,
        'reminder',t.reminder,
        'description',t.description,
        'fileUrl',t.file_url,
        'status',t.status,
        'createdAt',t.created_at,
        'completedAt',t.completed_at,
        'updatedAt',t.updated_at,
        'createdBy',coalesce(cb.employee_id,''),
        'createdByName',t.created_by_name,
        'department',t.department,
        'taskDepartment',t.department,
        'followUpTo',t.follow_up
      ) order by t.created_at desc)
      from public.tasks t
      where owner_user
         or exists(
           select 1
           from regexp_split_to_table(t.assigned_to, '\s*,\s*') x
           where lower(trim(x)) = lower(me.name)
         )
    ),'[]'::jsonb),

    'notifications',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_name',n.user_name,
        'message',n.message,
        'type',n.type,
        'created_at',n.created_at,
        'read',n.read
      ) order by n.created_at desc)
      from public.notifications n
      where owner_user or lower(n.user_name)=lower(me.name)
    ),'[]'::jsonb),

    'announcements',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'title',a.title,
        'description',a.description,
        'type',a.type,
        'fileUrl',a.file_url,
        'createdBy',a.created_by,
        'createdByName',a.created_by_name,
        'createdAt',a.created_at,
        'publishedAt',a.published_at,
        'active',a.active
      ) order by a.created_at desc)
      from public.announcements a
      where a.active=true
    ),'[]'::jsonb),

    'task_counter',
    coalesce((select value::integer from public.app_settings where key='task_counter'),1001),

    'current_user',
    jsonb_build_object(
      'name',me.name,
      'role',me.role,
      'email',me.email,
      'phone',me.phone,
      'photo',me.photo,
      'employeeId',me.employee_id,
      'password','',
      'department',me.department,
      'joiningDate',me.joining_date,
      'updatedAt',me.updated_at
    ),

    'is_owner',owner_user
  );
end;
$$;

create or replace function public.get_live_updates(p_employee_id text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  d jsonb;
begin
  d := public.get_app_data(p_employee_id,p_session_token);
  return jsonb_build_object(
    'tasks',coalesce(d->'tasks','[]'::jsonb),
    'notifications',coalesce(d->'notifications','[]'::jsonb),
    'announcements',coalesce(d->'announcements','[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- TASK CREATION
-- ------------------------------------------------------------

create or replace function public.create_task(
  p_employee_id text,
  p_session_token text,
  p_task_type text,
  p_assigned_to text,
  p_priority text default 'Medium',
  p_deadline date default null,
  p_reminder timestamptz default null,
  p_description text default '',
  p_file_url text default '',
  p_department text default 'Other',
  p_follow_up text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
  task_id uuid;
  task_code text;
  names text[];
  nm text;
  assigned_names text[];
  assigned_employee public.employees%rowtype;
  now_ts timestamptz := now();
begin
  actor := public.get_session_employee(p_employee_id,p_session_token);

  if trim(coalesce(p_task_type,''))='' then
    raise exception 'Task type is required.';
  end if;

  names := array(
    select trim(x)
    from regexp_split_to_table(coalesce(p_assigned_to,''), '\s*,\s*') x
    where trim(x)<>''
  );

  if coalesce(array_length(names,1),0)=0 then
    raise exception 'Please select at least one valid team member.';
  end if;

  foreach nm in array names loop
    select * into assigned_employee
    from public.employees
    where lower(name)=lower(nm)
      and is_active=true
    limit 1;

    if not found then
      raise exception 'Team member not found: %', nm;
    end if;
  end loop;

  task_code := public.next_task_code();

  insert into public.tasks(
    task_code,task_type,assigned_to,priority,deadline,reminder,
    description,file_url,status,created_at,updated_at,created_by,
    created_by_name,department,follow_up
  )
  values(
    task_code,trim(p_task_type),array_to_string(names,', '),
    coalesce(p_priority,'Medium'),p_deadline,p_reminder,
    coalesce(p_description,''),coalesce(p_file_url,''),'Pending',
    now_ts,now_ts,actor.id,actor.name,coalesce(nullif(p_department,''),'Other'),
    coalesce(p_follow_up,'')
  )
  returning id into task_id;

  foreach nm in array names loop
    select * into assigned_employee
    from public.employees
    where lower(name)=lower(nm)
      and is_active=true
    limit 1;

    insert into public.notifications(
      user_id,user_name,message,type,created_at,read
    )
    values(
      assigned_employee.id,
      assigned_employee.name,
      case
        when lower(actor.name)=lower(assigned_employee.name)
          then 'You created a new task: ' || trim(p_task_type)
        else actor.name || ' assigned you a new task: ' || trim(p_task_type)
      end,
      'task',
      now_ts,
      false
    );
  end loop;

  if trim(coalesce(p_follow_up,''))<>'' then
    select * into assigned_employee
    from public.employees
    where lower(name)=lower(trim(p_follow_up))
      and is_active=true
    limit 1;

    if found and not exists(
      select 1 from unnest(names) n where lower(n)=lower(assigned_employee.name)
    ) then
      insert into public.notifications(
        user_id,user_name,message,type,created_at,read
      )
      values(
        assigned_employee.id,
        assigned_employee.name,
        actor.name || ' added you as follow-up for task: ' || trim(p_task_type) || ' (' || task_code || ')',
        'follow-up',
        now_ts,
        false
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'task',jsonb_build_object(
      'id',task_code,
      'taskType',trim(p_task_type),
      'assignedTo',array_to_string(names,', '),
      'priority',coalesce(p_priority,'Medium'),
      'deadline',p_deadline,
      'reminder',p_reminder,
      'description',coalesce(p_description,''),
      'fileUrl',coalesce(p_file_url,''),
      'status','Pending',
      'createdAt',now_ts,
      'completedAt',null,
      'updatedAt',now_ts,
      'createdBy',actor.employee_id,
      'createdByName',actor.name,
      'department',coalesce(nullif(p_department,''),'Other'),
      'taskDepartment',coalesce(nullif(p_department,''),'Other'),
      'followUpTo',coalesce(p_follow_up,'')
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- TASK STATUS
-- ------------------------------------------------------------

create or replace function public.update_task_status(
  p_employee_id text,
  p_session_token text,
  p_task_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
  t public.tasks%rowtype;
  old_status text;
  nm text;
  assigned_employee public.employees%rowtype;
begin
  select * into actor
  from public.employees
  where lower(employee_id)=lower(trim(p_employee_id))
    and is_active=true;

  if not found then
    raise exception 'Invalid employee session.';
  end if;

  if p_status not in ('Pending','In Progress','Completed') then
    raise exception 'Invalid task status.';
  end if;

  select * into t
  from public.tasks
  where task_code=trim(p_task_id);

  if not found then
    raise exception 'Task not found.';
  end if;

  if lower(trim(actor.role)) not in ('owner','admin')
     and not exists(
       select 1 from regexp_split_to_table(t.assigned_to, '\s*,\s*') x
       where lower(trim(x))=lower(actor.name)
     ) then
    raise exception 'You can update only your own tasks.';
  end if;

  old_status := t.status;

  update public.tasks
  set status=p_status,
      completed_at=case when p_status='Completed' then now() else null end,
      updated_at=now()
  where id=t.id;

  if lower(trim(actor.role)) in ('owner','admin') then
    assigned_names := array(
      select trim(x)
      from regexp_split_to_table(t.assigned_to, '\s*,\s*') x
      where trim(x)<>''
    );

    foreach nm in array assigned_names loop
      select * into assigned_employee
      from public.employees
      where lower(name)=lower(nm)
        and is_active=true
      limit 1;

      if found then
        insert into public.notifications(user_id,user_name,message,type,created_at,read)
        values(
          assigned_employee.id,
          assigned_employee.name,
          'Task status updated: ' || t.task_type || ' → ' || p_status,
          'status',
          now(),
          false
        );
      end if;
    end loop;
  else
    insert into public.notifications(user_id,user_name,message,type,created_at,read)
    select e.id,e.name,
           actor.name || ' updated ' || t.task_type || ' → ' || p_status,
           'status',now(),false
    from public.employees e
    where e.is_active=true
      and lower(trim(e.role)) in ('owner','admin');
  end if;

  return jsonb_build_object(
    'ok',true,
    'taskId',p_task_id,
    'status',p_status,
    'updatedAt',now()
  );
end;
$$;

-- ------------------------------------------------------------
-- ANNOUNCEMENTS
-- ------------------------------------------------------------

create or replace function public.create_announcement(
  p_employee_id text,
  p_session_token text,
  p_title text,
  p_description text,
  p_type text default 'Announcement',
  p_file_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
  ann public.announcements%rowtype;
begin
  select * into actor
  from public.employees
  where lower(employee_id)=lower(trim(p_employee_id))
    and is_active=true;

  if not found or lower(trim(actor.role)) not in ('owner','admin') then
    raise exception 'Only the Owner can publish announcements.';
  end if;

  if trim(coalesce(p_title,''))='' or trim(coalesce(p_description,''))='' then
    raise exception 'Title and announcement details are required.';
  end if;

  insert into public.announcements(
    title,description,type,file_url,created_by,created_by_name,
    created_at,published_at,active
  )
  values(
    trim(p_title),trim(p_description),coalesce(nullif(p_type,''),'Announcement'),
    coalesce(p_file_url,''),actor.id,actor.name,now(),now(),true
  )
  returning * into ann;

  insert into public.notifications(
    user_id,user_name,message,type,created_at,read
  )
  select
    e.id,
    e.name,
    actor.name || ' published a new announcement: ' || ann.title,
    'announcement',
    now(),
    false
  from public.employees e
  where e.is_active=true
    and e.id<>actor.id;

  return jsonb_build_object(
    'ok',true,
    'announcement',jsonb_build_object(
      'id',ann.id,
      'title',ann.title,
      'description',ann.description,
      'type',ann.type,
      'fileUrl',ann.file_url,
      'createdBy',actor.employee_id,
      'createdByName',actor.name,
      'createdAt',ann.created_at,
      'publishedAt',ann.published_at,
      'active',ann.active
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- PROFILE
-- ------------------------------------------------------------

create or replace function public.update_own_profile(
  p_employee_id text,
  p_session_token text,
  p_email text default '',
  p_phone text default '',
  p_photo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
begin
  select * into actor
  from public.employees
  where lower(employee_id)=lower(trim(p_employee_id))
    and is_active=true;

  if not found then
    raise exception 'Invalid employee session.';
  end if;

  update public.employees
  set email=coalesce(p_email,email),
      phone=coalesce(p_phone,phone),
      photo=case
        when lower(trim(actor.role)) in ('owner','admin')
             and p_photo is not null
          then p_photo
        else photo
      end,
      updated_at=now()
  where id=actor.id
  returning * into actor;

  return jsonb_build_object(
    'ok',true,
    'member',jsonb_build_object(
      'name',actor.name,
      'role',actor.role,
      'email',actor.email,
      'phone',actor.phone,
      'photo',actor.photo,
      'employeeId',actor.employee_id,
      'password','',
      'department',actor.department,
      'joiningDate',actor.joining_date,
      'updatedAt',actor.updated_at
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- OWNER SAVE-ALL COMPATIBILITY
-- Used by the original UI for member edits/deletes and task edits.
-- ------------------------------------------------------------

create or replace function public.save_all(
  p_employee_id text,
  p_session_token text,
  p_members jsonb default '[]'::jsonb,
  p_tasks jsonb default '[]'::jsonb,
  p_notifications jsonb default '{}'::jsonb,
  p_task_counter integer default 1001
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
  item jsonb;
  task_item jsonb;
  creator_uuid uuid;
begin
  select * into actor
  from public.employees
  where lower(employee_id)=lower(trim(p_employee_id))
    and is_active=true;

  if not found or lower(trim(actor.role)) not in ('owner','admin') then
    raise exception 'Only the Owner can modify company-wide data.';
  end if;

  -- Members: upsert and preserve existing password hash when client sends blank.
  for item in select * from jsonb_array_elements(p_members) loop
    insert into public.employees(
      name,role,email,phone,photo,employee_id,password_hash,
      department,joining_date,updated_at,is_active
    )
    values(
      trim(item->>'name'),
      coalesce(nullif(item->>'role',''),'Employee'),
      coalesce(item->>'email',''),
      coalesce(item->>'phone',''),
      coalesce(item->>'photo',''),
      lower(regexp_replace(coalesce(nullif(item->>'employeeId',''),item->>'name'),'\s+','','g')),
      extensions.crypt(
        coalesce(nullif(item->>'password',''),
          lower(regexp_replace(coalesce(nullif(item->>'employeeId',''),item->>'name'),'\s+','','g')) || '@123'),
        extensions.gen_salt('bf')
      ),
      coalesce(nullif(item->>'department',''),'Other'),
      coalesce((item->>'joiningDate')::date,current_date),
      now(),
      true
    )
    on conflict(employee_id) do update
    set name=excluded.name,
        role=excluded.role,
        email=excluded.email,
        phone=excluded.phone,
        photo=excluded.photo,
        department=excluded.department,
        joining_date=excluded.joining_date,
        updated_at=now(),
        is_active=true,
        password_hash=case
          when coalesce(item->>'password','')<>'' then excluded.password_hash
          else public.employees.password_hash
        end;
  end loop;

  -- Delete members removed from the Owner's list, but never delete the actor.
  delete from public.employees e
  where e.is_active=true
    and e.id<>actor.id
    and not exists(
      select 1
      from jsonb_array_elements(p_members) m
      where lower(coalesce(m->>'employeeId',''))=lower(e.employee_id)
    );

  -- Tasks: upsert current list, then delete removed tasks.
  for task_item in select * from jsonb_array_elements(p_tasks) loop
    select id into creator_uuid
    from public.employees
    where lower(employee_id)=lower(coalesce(task_item->>'createdBy',''))
    limit 1;

    insert into public.tasks(
      task_code,task_type,assigned_to,priority,deadline,reminder,
      description,file_url,status,created_at,completed_at,updated_at,
      created_by,created_by_name,department,follow_up
    )
    values(
      task_item->>'id',
      coalesce(task_item->>'taskType',task_item->>'type','Task'),
      coalesce(task_item->>'assignedTo',''),
      coalesce(nullif(task_item->>'priority',''),'Medium'),
      nullif(task_item->>'deadline','')::date,
      nullif(task_item->>'reminder','')::timestamptz,
      coalesce(task_item->>'description',''),
      coalesce(task_item->>'fileUrl',''),
      coalesce(nullif(task_item->>'status',''),'Pending'),
      coalesce(nullif(task_item->>'createdAt','')::timestamptz,now()),
      nullif(task_item->>'completedAt','')::timestamptz,
      now(),
      creator_uuid,
      coalesce(task_item->>'createdByName',''),
      coalesce(nullif(task_item->>'department',''),nullif(task_item->>'taskDepartment',''),'Other'),
      coalesce(task_item->>'followUpTo','')
    )
    on conflict(task_code) do update
    set task_type=excluded.task_type,
        assigned_to=excluded.assigned_to,
        priority=excluded.priority,
        deadline=excluded.deadline,
        reminder=excluded.reminder,
        description=excluded.description,
        file_url=excluded.file_url,
        status=excluded.status,
        completed_at=excluded.completed_at,
        updated_at=now(),
        created_by=coalesce(excluded.created_by,public.tasks.created_by),
        created_by_name=coalesce(nullif(excluded.created_by_name,''),public.tasks.created_by_name),
        department=excluded.department,
        follow_up=excluded.follow_up;
  end loop;

  delete from public.tasks t
  where not exists(
    select 1
    from jsonb_array_elements(p_tasks) x
    where x->>'id'=t.task_code
  );

  -- Notifications are generated server-side for task/announcement events.
  -- Keep the payload for backward compatibility, but do not replace the
  -- server notification stream during a member/task save.

  insert into public.app_settings(key,value)
  values('task_counter',greatest(coalesce(p_task_counter,1001),1001)::text)
  on conflict(key) do update set value=excluded.value;

  return jsonb_build_object(
    'ok',true,
    'savedAt',now()
  );
end;
$$;

-- ------------------------------------------------------------
-- REPORTS
-- ------------------------------------------------------------

create or replace function public.get_task_report(
  p_employee_id text,
  p_session_token text,
  p_employee text default 'ALL',
  p_period text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  actor public.employees%rowtype;
  owner_user boolean;
  start_ts timestamptz;
  result_tasks jsonb;
begin
  actor := public.get_session_employee(p_employee_id,p_session_token);

  owner_user := lower(trim(actor.role)) in ('owner','admin');

  if not owner_user then
    p_employee := actor.name;
  end if;

  if lower(coalesce(p_period,'all'))='daily' then
    start_ts := date_trunc('day',now());
  elsif lower(coalesce(p_period,'all'))='weekly' then
    start_ts := date_trunc('week',now());
  elsif lower(coalesce(p_period,'all'))='monthly' then
    start_ts := date_trunc('month',now());
  else
    start_ts := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.task_code,
    'taskType',t.task_type,
    'assignedTo',t.assigned_to,
    'priority',t.priority,
    'deadline',t.deadline,
    'reminder',t.reminder,
    'description',t.description,
    'fileUrl',t.file_url,
    'status',t.status,
    'createdAt',t.created_at,
    'completedAt',t.completed_at,
    'updatedAt',t.updated_at,
    'createdBy',coalesce(cb.employee_id,''),
    'createdByName',t.created_by_name,
    'department',t.department,
    'taskDepartment',t.department,
    'followUpTo',t.follow_up
  ) order by t.created_at desc),'[]'::jsonb)
  into result_tasks
  from public.tasks t
  left join public.employees cb on cb.id=t.created_by
  where (owner_user or exists(
      select 1 from regexp_split_to_table(t.assigned_to,'\s*,\s*') x
      where lower(trim(x))=lower(p_employee)
    ))
    and (start_ts is null or t.created_at>=start_ts);

  return jsonb_build_object(
    'tasks',result_tasks,
    'employee',coalesce(p_employee,'ALL'),
    'period',coalesce(p_period,'all')
  );
end;
$$;

-- ------------------------------------------------------------
-- OPTIONAL: seed login for first test
-- owner / owner@123
-- Remove or change this after first successful login.
-- ------------------------------------------------------------

insert into public.employees(
  name,role,email,phone,photo,employee_id,password_hash,department,joining_date,is_active
)
values(
  'Owner',
  'Owner',
  '',
  '',
  '',
  'owner',
  extensions.crypt('owner@123',extensions.gen_salt('bf')),
  'Other',
  current_date,
  true
)
on conflict(employee_id) do nothing;

insert into public.employees(
  name,role,email,phone,photo,employee_id,password_hash,department,joining_date,is_active
)
values(
  'Denisha',
  'Employee',
  '',
  '',
  '',
  'denisha',
  extensions.crypt('denisha@123',extensions.gen_salt('bf')),
  'Other',
  current_date,
  true
)
on conflict(employee_id) do nothing;

-- ------------------------------------------------------------
-- GRANTS
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant execute on function public.login_employee(text,text,text) to anon, authenticated;
grant execute on function public.get_app_data(text,text) to anon, authenticated;
grant execute on function public.get_live_updates(text,text) to anon, authenticated;
grant execute on function public.create_task(text,text,text,text,text,date,timestamptz,text,text,text,text) to anon, authenticated;
grant execute on function public.update_task_status(text,text,text,text) to anon, authenticated;
grant execute on function public.create_announcement(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.update_own_profile(text,text,text,text,text) to anon, authenticated;
grant execute on function public.save_all(text,text,jsonb,jsonb,jsonb,integer) to anon, authenticated;
grant execute on function public.get_task_report(text,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
