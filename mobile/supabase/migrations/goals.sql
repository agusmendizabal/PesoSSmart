-- Tabla de metas de ahorro
create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  target_amount numeric(12,2) not null,
  current_amount numeric(12,2) not null default 0,
  deadline date,
  emoji text default '🎯',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.savings_goals enable row level security;

create policy "Users can manage their own goals"
  on public.savings_goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);