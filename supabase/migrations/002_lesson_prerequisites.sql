-- Lesson prerequisites: skill-tree unlocking (multi-prereq graph).
-- Apply after 001_lesson_builder.sql. Idempotent.

-- ─── Table ──────────────────────────────────────────────────────
-- Edge: lesson_id requires requires_lesson_id to be completed first.
-- A lesson with NO rows here is always unlocked.
create table if not exists public.lesson_prerequisites (
  lesson_id          uuid not null references public.lessons(id) on delete cascade,
  requires_lesson_id uuid not null references public.lessons(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (lesson_id, requires_lesson_id),
  check (lesson_id <> requires_lesson_id)
);

create index if not exists lesson_prereq_requires_idx
  on public.lesson_prerequisites (requires_lesson_id);

-- ─── RLS: read is public (unlock state is computed per-user from
--     module_progress anyway); writes are admin-only ─────────────
alter table public.lesson_prerequisites enable row level security;

drop policy if exists prereq_read on public.lesson_prerequisites;
create policy prereq_read on public.lesson_prerequisites
  for select using (true);

drop policy if exists prereq_admin_write on public.lesson_prerequisites;
create policy prereq_admin_write on public.lesson_prerequisites
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── Unlock computation ─────────────────────────────────────────
-- "Completed" matches the app's existing criterion in module_progress:
-- status='completed' OR signs_completed >= total_signs (when total > 0).
-- module_id in module_progress == lessons.slug.
--
-- Returns one row per published lesson for the CALLING user:
--   is_unlocked = no missing prerequisites
--   missing_prereq_slugs = which prereqs are still incomplete
create or replace function public.get_my_lesson_unlocks()
returns table (
  lesson_id uuid,
  slug text,
  title text,
  lesson_position int,
  is_unlocked boolean,
  missing_prereq_slugs text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with completed as (
    select mp.module_id
    from module_progress mp
    where mp.user_id = auth.uid()
      and (
        mp.status = 'completed'
        or (mp.total_signs > 0 and mp.signs_completed >= mp.total_signs)
      )
  ),
  missing as (
    select lp.lesson_id, req.slug as req_slug
    from lesson_prerequisites lp
    join lessons req on req.id = lp.requires_lesson_id
    where not exists (select 1 from completed c where c.module_id = req.slug)
  )
  select
    l.id,
    l.slug,
    l.title,
    l.position as lesson_position,
    not exists (select 1 from missing m where m.lesson_id = l.id) as is_unlocked,
    coalesce(
      (select array_agg(m.req_slug order by m.req_slug)
       from missing m where m.lesson_id = l.id),
      '{}'::text[]
    ) as missing_prereq_slugs
  from lessons l
  where l.status = 'published'
  order by l.position;
$$;

-- ─── Default prerequisites: linear chain G0→G1→…→G7 ────────────
-- Matches the app's previous implicit sequential unlocking.
insert into public.lesson_prerequisites (lesson_id, requires_lesson_id)
select cur.id, prev.id
from (values
  ('G1','G0'), ('G2','G1'), ('G3','G2'), ('G4','G3'),
  ('G5','G4'), ('G6','G5'), ('G7','G6')
) as v(cur_slug, req_slug)
join lessons cur on cur.slug = v.cur_slug
join lessons prev on prev.slug = v.req_slug
on conflict do nothing;
