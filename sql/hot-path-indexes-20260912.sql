-- PTM CRM · selective hot-path indexes
-- Add only foreign-key indexes used by frequent CRM joins/filtering.

CREATE INDEX IF NOT EXISTS deals_lead_idx
  ON public.deals(lead_id);

CREATE INDEX IF NOT EXISTS tasks_lead_idx
  ON public.tasks(lead_id);

CREATE INDEX IF NOT EXISTS lead_assignment_log_lead_idx
  ON public.lead_assignment_log(lead_id);

CREATE INDEX IF NOT EXISTS crm_facebook_auto_reply_attempts_conversation_idx
  ON public.crm_facebook_auto_reply_attempts(conversation_id,last_attempt_at DESC);

CREATE INDEX IF NOT EXISTS crm_payments_deal_idx
  ON public.crm_payments(deal_id);

CREATE INDEX IF NOT EXISTS crm_opportunities_property_idx
  ON public.crm_opportunities(property_id);

CREATE INDEX IF NOT EXISTS crm_contracts_property_idx
  ON public.crm_contracts(property_id);

CREATE INDEX IF NOT EXISTS crm_campaign_members_lead_idx
  ON public.crm_campaign_members(lead_id);
