-- PTM CRM · internal RPC exposure hardening · 2026-09-13
-- crm_full_api is the public authenticated wrapper.
-- crm_full_api_internal contains lower-level mutation logic and must never be
-- directly callable from the anonymous Neon Data API role.

REVOKE ALL ON FUNCTION public.crm_full_api_internal(text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_full_api_internal(text,text,jsonb) FROM anonymous;

-- Keep the intended public wrapper available to the Data API.
REVOKE ALL ON FUNCTION public.crm_full_api(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_full_api(text,text,jsonb) TO anonymous;

NOTIFY pgrst,'reload schema';
