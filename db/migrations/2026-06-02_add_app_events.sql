-- Analytics events stream for website, pwa, and seller platform telemetry
create table if not exists public.app_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null,
    platform text not null,
    session_id text,
    user_id text,
    seller_id uuid,
    source text,
    utm_campaign text,
    path text,
    referrer text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_app_events_created_at on public.app_events (created_at desc);
create index if not exists idx_app_events_session_id on public.app_events (session_id);
create index if not exists idx_app_events_platform_created_at on public.app_events (platform, created_at desc);
create index if not exists idx_app_events_event_type_created_at on public.app_events (event_type, created_at desc);
create index if not exists idx_app_events_source on public.app_events (source);
create index if not exists idx_app_events_utm_campaign on public.app_events (utm_campaign);
create index if not exists idx_app_events_seller_id on public.app_events (seller_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'app_events_platform_check'
    ) then
        alter table public.app_events
            add constraint app_events_platform_check
            check (platform in ('website', 'pwa', 'seller'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'app_events_event_type_check'
    ) then
        alter table public.app_events
            add constraint app_events_event_type_check
            check (event_type in ('page_view', 'heartbeat', 'link_click', 'product_view', 'add_to_cart', 'checkout_started', 'order_paid'));
    end if;
end $$;
