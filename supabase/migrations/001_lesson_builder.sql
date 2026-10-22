-- Lesson Builder schema: words bank + lessons + lesson_steps + admins
-- Apply in Supabase SQL editor or via `supabase db push`.
-- Idempotent: safe to re-run.

-- ─── Admin check ────────────────────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ─── Word bank ─────────────────────────────────────────────────
-- One row per seña/palabra. label is canonical (glyphs in the old
-- curriculum are truncated display text, e.g. "INTELIGENC…").
create table if not exists public.words (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  glyph      text,
  video_ref  text,                  -- youtube embed URL or /videos/signs/<n>.mp4
  thumbnail  text,
  hint       text,
  template   text,                  -- finger-state template, e.g. 'ECCCC'
  mov        boolean not null default false,  -- sign has movement
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Lessons ────────────────────────────────────────────────────
-- slug is the stable public id ('G0', 'G1', …) reused as module_id in
-- module_progress / sign_practice so existing user progress keeps working.
create table if not exists public.lessons (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  level      int  not null default 1,
  module     text,                  -- grouping label, e.g. 'Abecedario'
  position   int  not null default 0,
  status     text not null default 'draft'
             check (status in ('draft', 'published')),
  intro_md   text,                  -- markdown intro shown before the lesson
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Lesson steps ───────────────────────────────────────────────
create table if not exists public.lesson_steps (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  position   int  not null,
  type       text not null check (type in (
               'mostrar_seña',
               'elegir_correcta',
               'deletrear',
               'escucha_y_repite',
               'opcion_multiple',
               'emparejar'
             )),
  word_id    uuid references public.words(id) on delete set null,
  word_ids   uuid[] not null default '{}',  -- distractors / extra words
  reps       int  not null default 1 check (reps >= 0),
  explanation text,
  hint       text,
  threshold  numeric check (threshold is null or (threshold > 0 and threshold <= 1)),
  created_at timestamptz not null default now(),
  unique (lesson_id, position)
);

create index if not exists lesson_steps_lesson_idx on public.lesson_steps (lesson_id, position);
create index if not exists lessons_status_pos_idx  on public.lessons (status, position);

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch before update on public.lessons
  for each row execute function public.touch_updated_at();

drop trigger if exists words_touch on public.words;
create trigger words_touch before update on public.words
  for each row execute function public.touch_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────
alter table public.admins       enable row level security;
alter table public.words        enable row level security;
alter table public.lessons      enable row level security;
alter table public.lesson_steps enable row level security;

-- admins: a user can see their own row; only admins see/manage the list
drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists admins_admin_write on public.admins;
create policy admins_admin_write on public.admins
  for all using (public.is_admin()) with check (public.is_admin());

-- words: readable by everyone (public lesson content), writable by admins
drop policy if exists words_read on public.words;
create policy words_read on public.words for select using (true);
drop policy if exists words_admin_write on public.words;
create policy words_admin_write on public.words
  for all using (public.is_admin()) with check (public.is_admin());

-- lessons: published readable by everyone; drafts only by admins
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons
  for select using (status = 'published' or public.is_admin());
drop policy if exists lessons_admin_write on public.lessons;
create policy lessons_admin_write on public.lessons
  for all using (public.is_admin()) with check (public.is_admin());

-- lesson_steps: readable if parent lesson is published (or caller is admin)
drop policy if exists steps_read on public.lesson_steps;
create policy steps_read on public.lesson_steps
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.lessons l
      where l.id = lesson_steps.lesson_id and l.status = 'published'
    )
  );
drop policy if exists steps_admin_write on public.lesson_steps;
create policy steps_admin_write on public.lesson_steps
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── Bootstrap: grant yourself admin (run once, edit the email) ──
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
-- on conflict do nothing;
