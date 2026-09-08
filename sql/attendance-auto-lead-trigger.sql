-- LEGACY / KHÔNG DÙNG CHO BẢN MỚI
-- Cơ chế cũ giao lead trực tiếp, không có bước Sale xác nhận trong 10 phút.
-- File được giữ lại để tham chiếu lịch sử.
-- Cơ chế hiện hành nằm tại: sql/lead-offer-10-minute-routing.sql

-- PTM Realty CRM - automatic lead distribution trigger (legacy)
-- Requires attendance_records, lead_assignment_log and crm_pick_sale_for_lead().

CREATE OR REPLACE FUNCTION public.crm_auto_assign_lead_internal(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH lk AS (
  SELECT pg_advisory_xact_lock(hashtext(''ptm_auto_lead_round_robin'')) locked
), p AS (
  SELECT CASE
    WHEN (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time >= time ''08:30''
     AND (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::time < time ''17:30''
    THEN ''day'' ELSE ''evening'' END period
), pick AS (
  SELECT public.crm_pick_sale_for_lead(now()) user_id FROM lk
), att AS (
  SELECT ar.id attendance_id,pk.user_id
  FROM pick pk
  LEFT JOIN LATERAL (
    SELECT id FROM public.attendance_records ar
    WHERE ar.user_id=pk.user_id AND ar.check_out_at IS NULL
    ORDER BY ar.check_in_at DESC LIMIT 1
  ) ar ON true
), assigned AS (
  UPDATE public.leads l
  SET owner_id=pk.user_id,
      assigned_at=now(),
      assignment_reason=''auto_''||(SELECT period FROM p),
      updated_at=now()
  FROM pick pk
  WHERE l.id=p_lead_id AND pk.user_id IS NOT NULL
  RETURNING l.id,l.owner_id
), logged AS (
  INSERT INTO public.lead_assignment_log(lead_id,user_id,attendance_id,assignment_period,reason)
  SELECT a.id,a.owner_id,att.attendance_id,(SELECT period FROM p),''round_robin_attendance''
  FROM assigned a LEFT JOIN att ON att.user_id=a.owner_id
  RETURNING user_id
), waiting AS (
  UPDATE public.leads l
  SET owner_id=NULL,assigned_at=NULL,assignment_reason=''waiting_attendance'',updated_at=now()
  WHERE l.id=p_lead_id AND EXISTS(SELECT 1 FROM pick WHERE user_id IS NULL)
  RETURNING l.id
)
SELECT CASE
  WHEN EXISTS(SELECT 1 FROM logged)
    THEN jsonb_build_object(''ok'',true,''assigned'',true,''user_id'',(SELECT user_id FROM logged LIMIT 1))
  WHEN EXISTS(SELECT 1 FROM waiting)
    THEN jsonb_build_object(''ok'',true,''assigned'',false)
  ELSE jsonb_build_object(''ok'',false)
END';

REVOKE EXECUTE ON FUNCTION public.crm_auto_assign_lead_internal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_auto_assign_lead_internal(uuid) FROM anonymous;

CREATE OR REPLACE FUNCTION public.crm_lead_auto_assign_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS 'BEGIN
  PERFORM public.crm_auto_assign_lead_internal(NEW.id);
  RETURN NEW;
END';

-- Không tự chạy file legacy này trên production.
