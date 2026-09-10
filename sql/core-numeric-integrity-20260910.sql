-- Database-level numeric integrity for core CRM records.
-- UI already limits these values; this prevents manual/API requests from bypassing the rules.

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_value_nonnegative_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_value_nonnegative_check CHECK (value >= 0);

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_commission_nonnegative_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_commission_nonnegative_check CHECK (commission >= 0);

ALTER TABLE public.crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_value_nonnegative_check;
ALTER TABLE public.crm_opportunities ADD CONSTRAINT crm_opportunities_value_nonnegative_check CHECK (value >= 0);

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_budget_nonnegative_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_budget_nonnegative_check CHECK (budget >= 0);

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_score_range_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_score_range_check CHECK (score BETWEEN 0 AND 100);
