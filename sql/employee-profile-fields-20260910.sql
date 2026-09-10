-- Complete employee profile fields for PTM CRM
-- Additive migration: preserves existing login/session/user IDs.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS employee_code text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS manager_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS work_location text,
  ADD COLUMN IF NOT EXISTS internal_notes text;

CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_unique
  ON public.users (lower(trim(employee_code)))
  WHERE nullif(trim(employee_code),'') IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_manager_idx ON public.users(manager_id);
CREATE INDEX IF NOT EXISTS users_department_idx ON public.users(department);

CREATE OR REPLACE FUNCTION public.crm_save_user_v2(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_name text := nullif(trim(p_payload->>'name'),'');
  v_email text := nullif(lower(trim(p_payload->>'email')),'');
  v_role text := coalesce(nullif(p_payload->>'role',''),'sale');
  v_pw text := coalesce(p_payload->>'password','');
  v_employee_code text := nullif(trim(p_payload->>'employee_code'),'');
  v_phone text := nullif(trim(p_payload->>'phone'),'');
  v_department text := nullif(trim(p_payload->>'department'),'');
  v_job_title text := nullif(trim(p_payload->>'job_title'),'');
  v_manager uuid := nullif(p_payload->>'manager_id','')::uuid;
  v_start_date date := nullif(p_payload->>'start_date','')::date;
  v_work_location text := nullif(trim(p_payload->>'work_location'),'');
  v_notes text := nullif(trim(p_payload->>'internal_notes'),'');
  v_salt bytea;
  v_hash text;
BEGIN
  SELECT u.id INTO v_admin
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true AND u.role='admin'
  LIMIT 1;
  IF v_admin IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Chỉ Admin được quản lý tài khoản'); END IF;
  IF v_role NOT IN ('ceo','admin','marketing','sale','accounting') THEN RETURN jsonb_build_object('ok',false,'error','Vai trò không hợp lệ'); END IF;
  IF v_employee_code IS NOT NULL AND EXISTS(SELECT 1 FROM public.users u WHERE lower(trim(u.employee_code))=lower(v_employee_code) AND (v_id IS NULL OR u.id<>v_id)) THEN RETURN jsonb_build_object('ok',false,'error','Mã nhân viên đã tồn tại'); END IF;
  IF v_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_manager AND u.active=true) THEN RETURN jsonb_build_object('ok',false,'error','Quản lý trực tiếp không tồn tại hoặc đã bị khóa'); END IF;
  IF v_id IS NULL THEN
    IF v_name IS NULL OR v_email IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Tên và email là bắt buộc'); END IF;
    IF length(v_pw)<8 THEN RETURN jsonb_build_object('ok',false,'error','Mật khẩu mới phải có ít nhất 8 ký tự'); END IF;
    v_salt:=gen_random_bytes(16);
    v_hash:='pbkdf2_sha256$210000$'||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')||'$'||rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');
    INSERT INTO public.users(name,email,password_hash,role,active,employee_code,phone,department,job_title,manager_id,start_date,work_location,internal_notes)
    VALUES(v_name,v_email,v_hash,v_role,true,v_employee_code,v_phone,v_department,v_job_title,v_manager,v_start_date,v_work_location,v_notes)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_id) THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy tài khoản'); END IF;
  IF v_id=v_admin AND v_role<>'admin' THEN RETURN jsonb_build_object('ok',false,'error','Admin không thể tự hạ quyền tài khoản đang đăng nhập'); END IF;
  IF v_manager=v_id THEN RETURN jsonb_build_object('ok',false,'error','Nhân viên không thể là quản lý trực tiếp của chính mình'); END IF;
  IF length(v_pw)>0 AND length(v_pw)<8 THEN RETURN jsonb_build_object('ok',false,'error','Mật khẩu mới phải có ít nhất 8 ký tự'); END IF;
  IF length(v_pw)>0 THEN
    v_salt:=gen_random_bytes(16);
    v_hash:='pbkdf2_sha256$210000$'||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')||'$'||rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');
  END IF;
  UPDATE public.users SET
    name=coalesce(v_name,name), email=coalesce(v_email,email), role=v_role,
    password_hash=coalesce(v_hash,password_hash), employee_code=v_employee_code, phone=v_phone,
    department=v_department, job_title=v_job_title, manager_id=v_manager, start_date=v_start_date,
    work_location=v_work_location, internal_notes=v_notes, updated_at=now()
  WHERE id=v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'error','Email hoặc mã nhân viên đã tồn tại');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_bootstrap_v2(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
  SELECT u.id,u.name,u.email,u.role,u.employee_code,u.phone,u.department,u.job_title,u.manager_id,u.start_date,u.work_location
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') AND s.expires_at>now() AND u.active=true
  LIMIT 1
), payload AS (
  SELECT jsonb_build_object(
    'ok',true,
    'user',jsonb_build_object('id',cu.id,'name',cu.name,'email',cu.email,'role',cu.role,'employee_code',cu.employee_code,'phone',cu.phone,'department',cu.department,'job_title',cu.job_title,'manager_id',cu.manager_id,'start_date',cu.start_date,'work_location',cu.work_location),
    'permissions',public.crm_role_permissions(cu.role),
    'users',CASE
      WHEN cu.role='admin' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'role',u.role,'active',u.active,'employee_code',u.employee_code,'phone',u.phone,'department',u.department,'job_title',u.job_title,'manager_id',u.manager_id,'manager_name',m.name,'start_date',u.start_date,'work_location',u.work_location,'internal_notes',u.internal_notes) ORDER BY u.name) FROM public.users u LEFT JOIN public.users m ON m.id=u.manager_id),'[]'::jsonb)
      WHEN cu.role IN ('ceo','manager','accounting') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'active',u.active,'employee_code',u.employee_code,'phone',u.phone,'department',u.department,'job_title',u.job_title,'manager_id',u.manager_id,'manager_name',m.name,'start_date',u.start_date,'work_location',u.work_location) ORDER BY u.name) FROM public.users u LEFT JOIN public.users m ON m.id=u.manager_id WHERE u.active=true),'[]'::jsonb)
      WHEN cu.role='marketing' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'active',u.active,'employee_code',u.employee_code,'department',u.department,'job_title',u.job_title) ORDER BY u.name) FROM public.users u WHERE u.role='sale' AND u.active=true),'[]'::jsonb)
      ELSE jsonb_build_array(jsonb_build_object('id',cu.id,'name',cu.name,'role',cu.role,'active',true,'employee_code',cu.employee_code,'phone',cu.phone,'department',cu.department,'job_title',cu.job_title,'manager_id',cu.manager_id,'start_date',cu.start_date,'work_location',cu.work_location))
    END,
    'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'phone',l.phone,'email',l.email,'source',l.source,'need',l.need,'budget',l.budget,'status',l.status,'project',l.project,'owner_id',l.owner_id,'owner_name',u.name,'notes',l.notes,'created_at',l.created_at,'updated_at',l.updated_at) ORDER BY l.updated_at DESC) FROM public.leads l LEFT JOIN public.users u ON u.id=l.owner_id WHERE cu.role<>'sale' OR l.owner_id=cu.id),'[]'::jsonb),
    'properties','[]'::jsonb,
    'deals',coalesce((SELECT jsonb_agg(CASE WHEN cu.role='marketing' THEN jsonb_build_object('id',d.id,'lead_id',d.lead_id,'lead_name',l.name,'property_id',d.property_id,'property_name',p.name,'value',NULL,'commission',NULL,'stage',d.stage,'owner_id',d.owner_id,'owner_name',u.name,'deal_date',d.deal_date,'notes',NULL,'updated_at',d.updated_at) ELSE jsonb_build_object('id',d.id,'lead_id',d.lead_id,'lead_name',l.name,'property_id',d.property_id,'property_name',p.name,'value',d.value,'commission',d.commission,'stage',d.stage,'owner_id',d.owner_id,'owner_name',u.name,'deal_date',d.deal_date,'notes',d.notes,'updated_at',d.updated_at) END ORDER BY d.deal_date DESC,d.updated_at DESC) FROM public.deals d LEFT JOIN public.leads l ON l.id=d.lead_id LEFT JOIN public.properties p ON p.id=d.property_id LEFT JOIN public.users u ON u.id=d.owner_id WHERE cu.role<>'sale' OR d.owner_id=cu.id),'[]'::jsonb),
    'tasks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'task_type',t.task_type,'due_at',t.due_at,'owner_id',t.owner_id,'owner_name',u.name,'lead_id',t.lead_id,'lead_name',l.name,'done',t.done,'priority',t.priority,'updated_at',t.updated_at) ORDER BY t.done,t.due_at NULLS LAST) FROM public.tasks t LEFT JOIN public.users u ON u.id=t.owner_id LEFT JOIN public.leads l ON l.id=t.lead_id WHERE CASE WHEN cu.role IN ('sale','marketing','accounting') THEN t.owner_id=cu.id ELSE true END),'[]'::jsonb)
  ) AS data FROM cu
)
SELECT coalesce((SELECT data FROM payload),jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED'));
$function$;
