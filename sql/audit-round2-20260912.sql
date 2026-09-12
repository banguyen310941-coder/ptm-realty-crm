-- PTM CRM · audit round 2 · revoke obsolete/public helper RPCs
-- Keep current authenticated/secret-gated entrypoints available to Neon Data API.

REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_claim_v2(text,uuid,text,text) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_pick_v1(text,uuid,text,text) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_log_v1(text,uuid,uuid,text,text,text,jsonb) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_automation_api_v1(text,text,jsonb) FROM anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_verify_password(text,text) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_pbkdf2_sha256(text,bytea,integer) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_b64url_decode(text) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_role_permissions(text) FROM anonymous;

NOTIFY pgrst,'reload schema';
