-- PTM CRM system audit fixes · 2026-09-09
-- Non-destructive database hardening for Thiên Phúc lead distribution and customer identity.

CREATE OR REPLACE FUNCTION public.crm_pick_sale_for_offer(
  p_at timestamptz DEFAULT now(),
  p_exclude_user uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH p AS (
  SELECT
    (p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d,
    CASE
      WHEN (p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= time '08:30'
       AND (p_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < time '17:30'
      THEN 'day' ELSE 'evening'
    END AS period
), eligible AS (
  SELECT
    u.id,
    p.period,
    CASE WHEN p.period='day' THEN (
      SELECT ar.check_in_at
      FROM public.attendance_records ar
      WHERE ar.user_id=u.id
        AND ar.check_in_at<=p_at
        AND (ar.check_out_at IS NULL OR ar.check_out_at>p_at)
        AND ar.work_date=p.d
        AND (ar.work_mode<>'client_visit' OR length(coalesce(ar.photo_data,''))>=50)
      ORDER BY ar.check_in_at DESC
      LIMIT 1
    ) ELSE NULL END AS check_in_at
  FROM public.users u
  CROSS JOIN p
  WHERE u.active=true
    AND u.role='sale'
    AND (p_exclude_user IS NULL OR u.id<>p_exclude_user)
), candidates AS (
  SELECT
    e.id,
    e.check_in_at,
    count(lg.id) FILTER (
      WHERE (lg.assigned_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=(SELECT d FROM p)
        AND lg.assignment_period=(SELECT period FROM p)
    ) AS assigned_count,
    max(lg.assigned_at) FILTER (
      WHERE lg.assignment_period=(SELECT period FROM p)
    ) AS last_assigned
  FROM eligible e
  LEFT JOIN public.lead_assignment_log lg ON lg.user_id=e.id
  WHERE e.period='evening' OR e.check_in_at IS NOT NULL
  GROUP BY e.id,e.check_in_at
  ORDER BY assigned_count ASC,
           last_assigned ASC NULLS FIRST,
           e.check_in_at ASC NULLS LAST,
           e.id
  LIMIT 1
)
SELECT id FROM candidates;
$function$;

CREATE OR REPLACE FUNCTION public.crm_lead_auto_assign_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  -- A manually assigned customer must keep the selected Sale.
  IF NEW.owner_id IS NULL THEN
    PERFORM public.crm_create_offer_for_lead(NEW.id,NULL,now());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $function$
WITH x AS (SELECT regexp_replace(coalesce(p_phone,''),'\D','','g') AS d)
SELECT CASE
  WHEN d='' THEN ''
  WHEN d LIKE '84%' AND length(d)>=10 THEN '0'||substr(d,3)
  ELSE d
END
FROM x;
$function$;
REVOKE ALL ON FUNCTION public.crm_phone_key(text) FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.crm_lead_normalize_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_phone text;
BEGIN
  NEW.name:=trim(coalesce(NEW.name,''));
  NEW.phone:=trim(coalesce(NEW.phone,''));
  NEW.email:=nullif(lower(trim(coalesce(NEW.email,''))),'');
  NEW.project:=coalesce(nullif(trim(coalesce(NEW.project,'')),''),'Thiên Phúc Vĩnh Hằng Viên');

  IF NEW.name='' OR NEW.phone='' THEN
    RAISE EXCEPTION 'Họ tên và số điện thoại khách hàng là bắt buộc.';
  END IF;

  v_phone:=public.crm_phone_key(NEW.phone);
  PERFORM pg_advisory_xact_lock(hashtext('ptm_lead_identity_guard'));

  IF EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.id IS DISTINCT FROM NEW.id
      AND (
        (v_phone<>'' AND public.crm_phone_key(l.phone)=v_phone)
        OR (NEW.email IS NOT NULL AND lower(l.email)=NEW.email)
      )
  ) THEN
    RAISE EXCEPTION 'Số điện thoại hoặc email đã tồn tại trong CRM. Vui lòng kiểm tra khách hàng hiện có trước khi tạo mới.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_lead_normalize_guard() FROM PUBLIC, anonymous, authenticated;

DROP TRIGGER IF EXISTS leads_normalize_guard_before_write ON public.leads;
CREATE TRIGGER leads_normalize_guard_before_write
BEFORE INSERT OR UPDATE OF name,phone,email,project ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.crm_lead_normalize_guard();

CREATE OR REPLACE FUNCTION public.crm_attendance_status(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
  SELECT u.id,u.role
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1
), p AS (
  SELECT
    (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date d,
    CASE WHEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time>=time '08:30'
          AND (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<time '17:30'
         THEN 'day' ELSE 'evening' END period
), a AS (
  SELECT ar.*
  FROM public.attendance_records ar,cu
  WHERE ar.user_id=cu.id AND ar.check_out_at IS NULL
  ORDER BY ar.check_in_at DESC LIMIT 1
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu) THEN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn')
  ELSE jsonb_build_object(
    'ok',true,
    'work_hours',jsonb_build_object('start','08:30','end','17:30'),
    'period',(SELECT period FROM p),
    'attendance',COALESCE((SELECT jsonb_build_object('id',id,'work_date',work_date,'check_in_at',check_in_at,'work_mode',work_mode,'client_name',client_name,'note',note,'has_photo',photo_data IS NOT NULL) FROM a),'null'::jsonb),
    'eligible_for_leads',CASE
      WHEN (SELECT role FROM cu)<>'sale' THEN false
      WHEN (SELECT period FROM p)='evening' THEN true
      ELSE EXISTS(SELECT 1 FROM a WHERE work_date=(SELECT d FROM p) AND (work_mode<>'client_visit' OR length(coalesce(photo_data,''))>=50))
    END
  )
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_team_attendance(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
  SELECT u.id,u.role
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1
), p AS (
  SELECT
    (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date d,
    CASE WHEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time>=time '08:30'
          AND (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::time<time '17:30'
         THEN 'day' ELSE 'evening' END period
), rows AS (
  SELECT
    u.id,u.name,u.role,u.active,a.check_in_at,a.work_mode,a.client_name,
    (a.photo_data IS NOT NULL) has_photo,
    CASE
      WHEN u.role<>'sale' THEN false
      WHEN (SELECT period FROM p)='evening' THEN true
      ELSE a.id IS NOT NULL AND a.work_date=(SELECT d FROM p)
           AND (a.work_mode<>'client_visit' OR length(coalesce(a.photo_data,''))>=50)
    END can_receive_lead
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT ar.* FROM public.attendance_records ar
    WHERE ar.user_id=u.id AND ar.check_out_at IS NULL
    ORDER BY ar.check_in_at DESC LIMIT 1
  ) a ON true
  WHERE u.active=true
  ORDER BY u.role,u.name
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu) THEN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn')
  WHEN (SELECT role FROM cu) NOT IN ('admin','ceo','manager') THEN jsonb_build_object('ok',false,'error','Bạn không có quyền xem điểm danh toàn công ty')
  ELSE jsonb_build_object('ok',true,'period',(SELECT period FROM p),'employees',coalesce((SELECT jsonb_agg(to_jsonb(rows)) FROM rows),'[]'::jsonb))
END;
$function$;
