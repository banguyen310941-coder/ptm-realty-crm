-- PTM Realty CRM
-- Heartbeat xử lý offer hết hạn + tự lấy lead đang chờ khi Sale bắt đầu điểm danh.
-- Đã áp dụng vào Neon main ngày 2026-09-08.

CREATE OR REPLACE FUNCTION public.crm_lead_offer_tick(p_token text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS '
WITH cu AS (
  SELECT u.id
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''''),''sha256''),''hex'')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1
), proc AS (
  SELECT public.crm_process_expired_offers(now()) result
  FROM cu
), waiting AS (
  SELECT l.id
  FROM public.leads l,cu
  WHERE l.owner_id IS NULL
    AND l.current_offer_id IS NULL
    AND l.assignment_reason=''waiting_attendance''
  ORDER BY l.created_at,l.id
  LIMIT 1
), assign AS (
  SELECT public.crm_create_offer_for_lead(w.id,NULL,now()) offer_id
  FROM waiting w
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object(''ok'',false,''error'',''Phiên đăng nhập đã hết hạn'')
  ELSE coalesce(
    (SELECT result FROM proc),
    jsonb_build_object(''ok'',true,''expired_count'',0,''reassigned_count'',0)
  ) || jsonb_build_object(
    ''waiting_offer_id'',
    (SELECT offer_id FROM assign LIMIT 1)
  )
END';
