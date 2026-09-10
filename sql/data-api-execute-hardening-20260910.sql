-- PTM CRM Data API execute hardening
-- Date: 2026-09-10
-- Purpose: keep only authenticated/session-checked or secret-checked RPCs exposed through Neon Data API.
-- Internal trigger/helper functions must not be callable directly by anonymous/authenticated roles.

REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_v1() FROM PUBLIC, anonymous, authenticated;

REVOKE EXECUTE ON FUNCTION public.crm_cemetery_deal_guard() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_cemetery_deal_sync() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_deal_delete_guard_v2() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_deal_owner_guard_v1() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_finance_relation_guard_v1() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_lead_auto_assign_trigger() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_lead_delete_guard_v2() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_opportunity_owner_guard_v1() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_property_delete_guard_v2() FROM PUBLIC, anonymous, authenticated;

-- Other internal helpers: explicitly keep them private even if a future migration recreates grants.
REVOKE EXECUTE ON FUNCTION public.crm_automation_event_internal(text,uuid,uuid,uuid,jsonb) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_create_offer_for_lead(uuid,uuid,timestamptz) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_pick_sale_for_offer(timestamptz,uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_process_expired_offers(timestamptz) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_finance_reconcile_deal(uuid) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_finance_reconcile_trigger() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_full_api_internal(text,text,jsonb) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_integration_secret_ok(text,text) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_lead_normalize_guard() FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_cemetery_import_mgt_v2(jsonb) FROM PUBLIC, anonymous, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_cemetery_import_payload(text,jsonb) FROM PUBLIC, anonymous, authenticated;
