-- Track seller onboarding events for funnel analytics.
create table if not exists public.seller_onboarding_events (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references public.sellers(id) on delete cascade,
    event_type text not null,
    step_key text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint seller_onboarding_events_event_type_check check (
        event_type in ('step_viewed', 'step_completed', 'cta_clicked')
    ),
    constraint seller_onboarding_events_step_key_check check (
        step_key is null
        or step_key in (
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

create index if not exists seller_onboarding_events_seller_id_idx
    on public.seller_onboarding_events (seller_id);

create index if not exists seller_onboarding_events_event_type_idx
    on public.seller_onboarding_events (event_type);

create index if not exists seller_onboarding_events_created_at_idx
    on public.seller_onboarding_events (created_at desc);

alter table public.seller_onboarding_events enable row level security;

-- Sellers can read only their own events.
drop policy if exists seller_onboarding_events_select_own on public.seller_onboarding_events;
create policy seller_onboarding_events_select_own
    on public.seller_onboarding_events
    for select
    using (
        exists (
            select 1
            from public.sellers s
            where s.id = seller_onboarding_events.seller_id
              and s.user_id = auth.uid()
        )
    );
