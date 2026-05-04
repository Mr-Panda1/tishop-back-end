-- Persist seller onboarding progress across devices.
create table if not exists public.seller_onboarding_steps (
    seller_id uuid not null references public.sellers(id) on delete cascade,
    step_key text not null,
    is_completed boolean not null default false,
    completed_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint seller_onboarding_steps_pkey primary key (seller_id, step_key),
    constraint seller_onboarding_steps_step_key_check check (
        step_key in (
            'brand',
            'first_product',
            'payment_method',
            'kyc_approved',
            'delivery_zone',
            'policies',
            'go_live'
        )
    )
);

create index if not exists seller_onboarding_steps_seller_id_idx
    on public.seller_onboarding_steps (seller_id);

create or replace function public.set_seller_onboarding_steps_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_seller_onboarding_steps_updated_at
    on public.seller_onboarding_steps;

create trigger trg_seller_onboarding_steps_updated_at
before update on public.seller_onboarding_steps
for each row execute function public.set_seller_onboarding_steps_updated_at();

alter table public.seller_onboarding_steps enable row level security;

-- Seller can read and write only their own onboarding state.
drop policy if exists seller_onboarding_steps_select_own on public.seller_onboarding_steps;
create policy seller_onboarding_steps_select_own
    on public.seller_onboarding_steps
    for select
    using (
        exists (
            select 1
            from public.sellers s
            where s.id = seller_onboarding_steps.seller_id
              and s.user_id = auth.uid()
        )
    );

drop policy if exists seller_onboarding_steps_insert_own on public.seller_onboarding_steps;
create policy seller_onboarding_steps_insert_own
    on public.seller_onboarding_steps
    for insert
    with check (
        exists (
            select 1
            from public.sellers s
            where s.id = seller_onboarding_steps.seller_id
              and s.user_id = auth.uid()
        )
    );

drop policy if exists seller_onboarding_steps_update_own on public.seller_onboarding_steps;
create policy seller_onboarding_steps_update_own
    on public.seller_onboarding_steps
    for update
    using (
        exists (
            select 1
            from public.sellers s
            where s.id = seller_onboarding_steps.seller_id
              and s.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from public.sellers s
            where s.id = seller_onboarding_steps.seller_id
              and s.user_id = auth.uid()
        )
    );
