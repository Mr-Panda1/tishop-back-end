-- Store-level rules configured by sellers
CREATE TABLE IF NOT EXISTS public.seller_store_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    preset TEXT NOT NULL CHECK (preset IN ('flexible', 'standard', 'strict')),
    cancellation_window_hours INTEGER NOT NULL CHECK (cancellation_window_hours >= 0),
    delivery_min_days INTEGER NOT NULL CHECK (delivery_min_days >= 0),
    delivery_max_days INTEGER NOT NULL CHECK (delivery_max_days >= 0),
    pickup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    pickup_instructions TEXT,
    damaged_claim_window_days INTEGER NOT NULL CHECK (damaged_claim_window_days >= 0),
    support_contact_method TEXT NOT NULL CHECK (support_contact_method IN ('whatsapp', 'email', 'phone')),
    support_contact_value TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (seller_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_store_policies_shop_id
    ON public.seller_store_policies (shop_id);

CREATE INDEX IF NOT EXISTS idx_seller_store_policies_seller_id
    ON public.seller_store_policies (seller_id);

CREATE OR REPLACE FUNCTION public.update_seller_store_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_seller_store_policies_updated_at ON public.seller_store_policies;

CREATE TRIGGER trigger_update_seller_store_policies_updated_at
BEFORE UPDATE ON public.seller_store_policies
FOR EACH ROW EXECUTE FUNCTION public.update_seller_store_policies_updated_at();

ALTER TABLE public.seller_store_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_store_policies_select_own ON public.seller_store_policies;
CREATE POLICY seller_store_policies_select_own
    ON public.seller_store_policies
    FOR SELECT
    USING (
        seller_id IN (
            SELECT id FROM public.sellers
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS seller_store_policies_insert_own ON public.seller_store_policies;
CREATE POLICY seller_store_policies_insert_own
    ON public.seller_store_policies
    FOR INSERT
    WITH CHECK (
        seller_id IN (
            SELECT id FROM public.sellers
            WHERE user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS seller_store_policies_update_own ON public.seller_store_policies;
CREATE POLICY seller_store_policies_update_own
    ON public.seller_store_policies
    FOR UPDATE
    USING (
        seller_id IN (
            SELECT id FROM public.sellers
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        seller_id IN (
            SELECT id FROM public.sellers
            WHERE user_id = auth.uid()
        )
    );

-- Audit of customer agreement with seller rules at order time
CREATE TABLE IF NOT EXISTS public.customer_order_policy_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    seller_policy_id UUID NOT NULL REFERENCES public.seller_store_policies(id) ON DELETE RESTRICT,
    agreed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_order_policy_agreements_order_id
    ON public.customer_order_policy_agreements (order_id);

CREATE INDEX IF NOT EXISTS idx_customer_order_policy_agreements_shop_id
    ON public.customer_order_policy_agreements (shop_id);

ALTER TABLE public.customer_order_policy_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_order_policy_agreements_select_own ON public.customer_order_policy_agreements;
CREATE POLICY customer_order_policy_agreements_select_own
    ON public.customer_order_policy_agreements
    FOR SELECT
    USING (true);