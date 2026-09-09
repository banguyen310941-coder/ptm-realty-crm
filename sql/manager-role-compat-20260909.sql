-- Legacy role compatibility · 2026-09-09
-- The UI labels manager as Giám đốc điều hành, so backend permissions must match CEO.

CREATE OR REPLACE FUNCTION public.crm_role_permissions(p_role text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
SELECT CASE
  WHEN p_role IN ('ceo','manager') THEN jsonb_build_object(
    'dashboard_view',true,'leads_view',true,'leads_scope','all','leads_create',true,'leads_update',true,'leads_delete',true,'leads_assign',true,
    'properties_view',true,'properties_manage',true,'deals_view',true,'deals_scope','all','deals_create',true,'deals_update',true,'deals_delete',true,
    'tasks_view',true,'tasks_scope','all','tasks_create',true,'tasks_update',true,'tasks_delete',true,'team_view',true,'users_manage',false,'finance_view',true)
  WHEN p_role='admin' THEN jsonb_build_object(
    'dashboard_view',true,'leads_view',true,'leads_scope','all','leads_create',true,'leads_update',true,'leads_delete',true,'leads_assign',true,
    'properties_view',true,'properties_manage',true,'deals_view',true,'deals_scope','all','deals_create',true,'deals_update',true,'deals_delete',true,
    'tasks_view',true,'tasks_scope','all','tasks_create',true,'tasks_update',true,'tasks_delete',true,'team_view',true,'users_manage',true,'finance_view',true)
  WHEN p_role='marketing' THEN jsonb_build_object(
    'dashboard_view',true,'leads_view',true,'leads_scope','all','leads_create',true,'leads_update',true,'leads_delete',false,'leads_assign',true,
    'properties_view',true,'properties_manage',false,'deals_view',true,'deals_scope','all','deals_create',false,'deals_update',false,'deals_delete',false,
    'tasks_view',true,'tasks_scope','own','tasks_create',true,'tasks_update',true,'tasks_delete',true,'team_view',false,'users_manage',false,'finance_view',false)
  WHEN p_role='sale' THEN jsonb_build_object(
    'dashboard_view',true,'leads_view',true,'leads_scope','own','leads_create',true,'leads_update',true,'leads_delete',false,'leads_assign',false,
    'properties_view',true,'properties_manage',false,'deals_view',true,'deals_scope','own','deals_create',true,'deals_update',true,'deals_delete',false,
    'tasks_view',true,'tasks_scope','own','tasks_create',true,'tasks_update',true,'tasks_delete',true,'team_view',false,'users_manage',false,'finance_view',true)
  WHEN p_role='accounting' THEN jsonb_build_object(
    'dashboard_view',true,'leads_view',true,'leads_scope','all','leads_create',false,'leads_update',false,'leads_delete',false,'leads_assign',false,
    'properties_view',true,'properties_manage',false,'deals_view',true,'deals_scope','all','deals_create',false,'deals_update',true,'deals_delete',false,
    'tasks_view',true,'tasks_scope','own','tasks_create',true,'tasks_update',true,'tasks_delete',true,'team_view',true,'users_manage',false,'finance_view',true)
  ELSE '{}'::jsonb
END;
$function$;

-- Normalize only the routing role. crm_api still sees the real user role, which is safe because
-- its own write scoping is only special for sale; manager follows the CEO path.
CREATE OR REPLACE FUNCTION public.crm_api_v2(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
 SELECT u.id,CASE WHEN u.role='manager' THEN 'ceo' ELSE u.role END role
 FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
 WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
   AND s.expires_at>now() AND u.active=true LIMIT 1
)
SELECT CASE
 WHEN NOT EXISTS(SELECT 1 FROM cu) THEN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED')
 WHEN p_action='bootstrap' THEN public.crm_bootstrap_v2(p_token)
 WHEN p_action='logout' THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='save_lead' AND (SELECT role FROM cu) IN ('ceo','admin','marketing','sale')
   AND ((SELECT role FROM cu)='sale' OR nullif(p_payload->>'owner_id','') IS NULL OR EXISTS(SELECT 1 FROM public.users WHERE id=(p_payload->>'owner_id')::uuid AND role='sale' AND active=true))
   THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='save_lead' THEN jsonb_build_object('ok',false,'error','Bạn không có quyền sửa khách hàng hoặc người nhận lead không hợp lệ')
 WHEN p_action='delete_lead' AND (SELECT role FROM cu) IN ('ceo','admin') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='delete_lead' THEN jsonb_build_object('ok',false,'error','Chỉ Giám đốc hoặc Admin được xóa khách hàng')
 WHEN p_action IN ('save_property','delete_property') AND (SELECT role FROM cu) IN ('ceo','admin') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action IN ('save_property','delete_property') THEN jsonb_build_object('ok',false,'error','Bạn chỉ có quyền xem giỏ hàng')
 WHEN p_action='save_deal' AND (SELECT role FROM cu)='accounting' THEN public.crm_accounting_save_deal_v2(p_token,p_payload)
 WHEN p_action='save_deal' AND (SELECT role FROM cu)='sale' THEN public.crm_sale_save_deal_v2(p_token,p_payload)
 WHEN p_action='save_deal' AND (SELECT role FROM cu) IN ('ceo','admin') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='save_deal' THEN jsonb_build_object('ok',false,'error','Bạn không có quyền sửa giao dịch')
 WHEN p_action='delete_deal' AND (SELECT role FROM cu) IN ('ceo','admin') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='delete_deal' THEN jsonb_build_object('ok',false,'error','Chỉ Giám đốc hoặc Admin được xóa giao dịch')
 WHEN p_action='save_task' AND (SELECT role FROM cu) IN ('marketing','accounting') THEN
   CASE WHEN nullif(p_payload->>'id','') IS NULL OR EXISTS(SELECT 1 FROM public.tasks WHERE id=(p_payload->>'id')::uuid AND owner_id=(SELECT id FROM cu))
     THEN public.crm_api(p_token,p_action,jsonb_set(coalesce(p_payload,'{}'::jsonb),'{owner_id}',to_jsonb((SELECT id FROM cu)::text),true))
     ELSE jsonb_build_object('ok',false,'error','Bạn chỉ được sửa công việc của mình') END
 WHEN p_action='save_task' AND (SELECT role FROM cu) IN ('ceo','admin','sale') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action IN ('toggle_task','delete_task') AND (SELECT role FROM cu) IN ('marketing','accounting') THEN
   CASE WHEN EXISTS(SELECT 1 FROM public.tasks WHERE id=nullif(p_payload->>'id','')::uuid AND owner_id=(SELECT id FROM cu))
     THEN public.crm_api(p_token,p_action,p_payload)
     ELSE jsonb_build_object('ok',false,'error','Bạn chỉ được xử lý công việc của mình') END
 WHEN p_action IN ('toggle_task','delete_task') AND (SELECT role FROM cu) IN ('ceo','admin','sale') THEN public.crm_api(p_token,p_action,p_payload)
 WHEN p_action='save_user' THEN public.crm_save_user_v2(p_token,p_payload)
 WHEN p_action='toggle_user' THEN public.crm_toggle_user_v2(p_token,p_payload)
 ELSE jsonb_build_object('ok',false,'error','Thao tác không hợp lệ') END
FROM (SELECT 1) z;
$function$;
