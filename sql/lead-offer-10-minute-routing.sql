-- PTM Realty CRM
-- Lead offer 10 phút + thu hồi + phân lại Sale tiếp theo.
-- Yêu cầu có sẵn: attendance_records, lead_assignment_log, users, leads, crm_sessions.
-- Quy tắc: Sale có ca điểm danh đang mở trong ngày đều đủ điều kiện, kể cả sau 17:30.

CREATE TABLE IF NOT EXISTS public.lead_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attendance_id uuid NULL REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  accepted_at timestamptz NULL,
  closed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','rejected','revoked')),
  round_no integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_offer_expiry_after_offer CHECK (expires_at > offered_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_offers_one_pending_per_lead_idx
  ON public.lead_offers(lead_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS lead_offers_user_pending_idx
  ON public.lead_offers(user_id,status,expires_at);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS current_offer_id uuid NULL REFERENCES public.lead_offers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.crm_pick_sale_for_offer(
  p_at timestamptz DEFAULT now(),
  p_exclude_user uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH p AS (
  SELECT
    (p_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date d,
    CASE WHEN (p_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time >= time ''08:30''
           AND (p_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time < time ''17:30''
         THEN ''day'' ELSE ''evening'' END period
), c AS (
  SELECT
    u.id,
    a.id attendance_id,
    a.check_in_at,
    count(lg.id) FILTER (
      WHERE (lg.assigned_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date=(SELECT d FROM p)
        AND lg.assignment_period=(SELECT period FROM p)
    ) assigned_count,
    max(lg.assigned_at) FILTER (WHERE lg.assignment_period=(SELECT period FROM p)) last_assigned
  FROM public.users u
  JOIN LATERAL (
    SELECT ar.*
    FROM public.attendance_records ar
    WHERE ar.user_id=u.id
      AND ar.check_in_at<=p_at
      AND (ar.check_out_at IS NULL OR ar.check_out_at>p_at)
      AND ar.work_date=(SELECT d FROM p)
      AND (ar.work_mode<>''client_visit'' OR length(coalesce(ar.photo_data,''''))>=50)
    ORDER BY ar.check_in_at DESC
    LIMIT 1
  ) a ON true
  LEFT JOIN public.lead_assignment_log lg ON lg.user_id=u.id
  WHERE u.active=true
    AND u.role=''sale''
    AND (p_exclude_user IS NULL OR u.id<>p_exclude_user)
  GROUP BY u.id,a.id,a.check_in_at
  ORDER BY assigned_count ASC,last_assigned ASC NULLS FIRST,a.check_in_at ASC,u.id
  LIMIT 1
)
SELECT id FROM c';

CREATE OR REPLACE FUNCTION public.crm_create_offer_for_lead(
  p_lead_id uuid,
  p_exclude_user uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH lk AS (
  SELECT pg_advisory_xact_lock(hashtext(''ptm_auto_lead_round_robin'')) locked
), p AS (
  SELECT CASE WHEN (p_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time >= time ''08:30''
               AND (p_at AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time < time ''17:30''
              THEN ''day'' ELSE ''evening'' END period
  FROM lk
), pick AS (
  SELECT public.crm_pick_sale_for_offer(p_at,p_exclude_user) user_id
), att AS (
  SELECT ar.id attendance_id,pk.user_id
  FROM pick pk
  LEFT JOIN LATERAL (
    SELECT id FROM public.attendance_records ar
    WHERE ar.user_id=pk.user_id
      AND ar.check_in_at<=p_at
      AND (ar.check_out_at IS NULL OR ar.check_out_at>p_at)
    ORDER BY ar.check_in_at DESC LIMIT 1
  ) ar ON true
), rn AS (
  SELECT coalesce(max(round_no),0)+1 round_no
  FROM public.lead_offers WHERE lead_id=p_lead_id
), ins AS (
  INSERT INTO public.lead_offers(lead_id,user_id,attendance_id,offered_at,expires_at,status,round_no)
  SELECT p_lead_id,pk.user_id,att.attendance_id,p_at,p_at+interval ''10 minutes'',''pending'',rn.round_no
  FROM pick pk LEFT JOIN att ON att.user_id=pk.user_id,rn
  WHERE pk.user_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.lead_offers WHERE lead_id=p_lead_id AND status=''pending'')
  RETURNING id,user_id,attendance_id
), upd AS (
  UPDATE public.leads l
  SET owner_id=i.user_id,current_offer_id=i.id,assigned_at=p_at,
      assignment_reason=''offer_''||(SELECT period FROM p),updated_at=now()
  FROM ins i WHERE l.id=p_lead_id
  RETURNING l.id
), lg AS (
  INSERT INTO public.lead_assignment_log(lead_id,user_id,attendance_id,assignment_period,reason,assigned_at)
  SELECT p_lead_id,i.user_id,i.attendance_id,(SELECT period FROM p),''offer_created'',p_at
  FROM ins i
  RETURNING id
), waiting AS (
  UPDATE public.leads l
  SET owner_id=NULL,current_offer_id=NULL,assigned_at=NULL,
      assignment_reason=''waiting_attendance'',updated_at=now()
  WHERE l.id=p_lead_id
    AND NOT EXISTS(SELECT 1 FROM ins)
    AND NOT EXISTS(SELECT 1 FROM public.lead_offers WHERE lead_id=p_lead_id AND status=''pending'')
  RETURNING l.id
)
SELECT id FROM ins LIMIT 1';

CREATE OR REPLACE FUNCTION public.crm_accept_lead_offer(p_token text,p_offer_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH cu AS (
  SELECT u.id
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''''),''sha256''),''hex'')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1
), upd AS (
  UPDATE public.lead_offers o
  SET status=''accepted'',accepted_at=now(),closed_at=now()
  FROM cu
  WHERE o.id=p_offer_id AND o.user_id=cu.id
    AND o.status=''pending'' AND o.expires_at>now()
  RETURNING o.id,o.lead_id
), lead_upd AS (
  UPDATE public.leads l SET assignment_reason=''accepted'',updated_at=now()
  FROM upd u WHERE l.id=u.lead_id AND l.current_offer_id=u.id
  RETURNING l.id
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object(''ok'',false,''error'',''Phiên đăng nhập đã hết hạn'')
  WHEN EXISTS(SELECT 1 FROM upd)
    THEN jsonb_build_object(''ok'',true,''offer_id'',(SELECT id FROM upd LIMIT 1),''lead_id'',(SELECT lead_id FROM upd LIMIT 1))
  ELSE jsonb_build_object(''ok'',false,''error'',''Lead đã hết 10 phút hoặc không còn thuộc lượt nhận của bạn'')
END';

CREATE OR REPLACE FUNCTION public.crm_process_expired_offers(p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH lk AS (
  SELECT pg_advisory_xact_lock(hashtext(''ptm_offer_expiry'')) locked
), expired AS (
  UPDATE public.lead_offers
  SET status=''expired'',closed_at=p_at
  FROM lk
  WHERE status=''pending'' AND expires_at<=p_at
  RETURNING id,lead_id,user_id
), clear_leads AS (
  UPDATE public.leads l
  SET owner_id=NULL,current_offer_id=NULL,assigned_at=NULL,
      assignment_reason=''expired_reassigning'',updated_at=now()
  FROM expired e
  WHERE l.id=e.lead_id AND l.current_offer_id=e.id
  RETURNING l.id,e.user_id old_user
), reassigned AS (
  SELECT c.id lead_id,c.old_user,
         public.crm_create_offer_for_lead(c.id,c.old_user,p_at) new_offer_id
  FROM clear_leads c
)
SELECT jsonb_build_object(
  ''ok'',true,
  ''expired_count'',(SELECT count(*) FROM expired),
  ''reassigned_count'',(SELECT count(*) FROM reassigned WHERE new_offer_id IS NOT NULL)
)';

CREATE OR REPLACE FUNCTION public.crm_my_lead_offers(p_token text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH proc AS (
  SELECT public.crm_process_expired_offers(now()) result
), cu AS (
  SELECT u.id
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id,proc
  WHERE s.token_hash=encode(digest(coalesce(p_token,''''),''sha256''),''hex'')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1
), rows AS (
  SELECT o.id offer_id,o.offered_at,o.expires_at,o.round_no,
         l.id lead_id,l.name,l.phone,l.source,l.need,l.budget,l.project
  FROM public.lead_offers o
  JOIN public.leads l ON l.id=o.lead_id,cu
  WHERE o.user_id=cu.id AND o.status=''pending'' AND o.expires_at>now()
  ORDER BY o.offered_at DESC
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object(''ok'',false,''error'',''Phiên đăng nhập đã hết hạn'')
  ELSE jsonb_build_object(''ok'',true,''offers'',coalesce((SELECT jsonb_agg(to_jsonb(rows)) FROM rows),''[]''::jsonb))
END';

CREATE OR REPLACE FUNCTION public.crm_lead_offer_tick(p_token text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH cu AS (
  SELECT u.id
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''''),''sha256''),''hex'')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1
), proc AS (
  SELECT public.crm_process_expired_offers(now()) result FROM cu
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object(''ok'',false,''error'',''Phiên đăng nhập đã hết hạn'')
  ELSE coalesce((SELECT result FROM proc),jsonb_build_object(''ok'',true,''expired_count'',0,''reassigned_count'',0))
END';

-- Trigger đã tồn tại trong dự án: thay body để mọi lead mới đều đi qua bộ chia tự động.
CREATE OR REPLACE FUNCTION public.crm_lead_auto_assign_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  PERFORM public.crm_create_offer_for_lead(NEW.id,NULL,now());
  RETURN NEW;
END
$function$;

REVOKE ALL ON public.lead_offers FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_process_expired_offers(timestamptz) FROM anonymous;
GRANT EXECUTE ON FUNCTION public.crm_my_lead_offers(text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_accept_lead_offer(text,uuid) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_lead_offer_tick(text) TO anonymous;
