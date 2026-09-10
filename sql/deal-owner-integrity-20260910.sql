-- Keep every cemetery deal owned by the active Sale who owns the customer.
-- Prevent CEO/Admin/manual API calls from creating orphan deals owned by non-Sale users.

CREATE OR REPLACE FUNCTION public.crm_deal_owner_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_lead_owner uuid;
  v_role text;
  v_active boolean;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RAISE EXCEPTION 'Giao dịch phải gắn với khách hàng.' USING ERRCODE = '23514';
  END IF;

  IF NEW.property_id IS NULL THEN
    RAISE EXCEPTION 'Giao dịch phải gắn với mộ phần.' USING ERRCODE = '23514';
  END IF;

  SELECT l.owner_id INTO v_lead_owner
  FROM public.leads l
  WHERE l.id = NEW.lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khách hàng của giao dịch không tồn tại.' USING ERRCODE = '23503';
  END IF;

  IF v_lead_owner IS NULL THEN
    RAISE EXCEPTION 'Khách hàng chưa được phân Sale. Hãy phân Sale trước khi tạo giữ chỗ.' USING ERRCODE = '23514';
  END IF;

  SELECT u.role, u.active INTO v_role, v_active
  FROM public.users u
  WHERE u.id = v_lead_owner;

  IF NOT FOUND OR v_role <> 'sale' OR coalesce(v_active, false) = false THEN
    RAISE EXCEPTION 'Người phụ trách khách hàng phải là Sale đang hoạt động.' USING ERRCODE = '23514';
  END IF;

  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := v_lead_owner;
  ELSIF NEW.owner_id IS DISTINCT FROM v_lead_owner THEN
    RAISE EXCEPTION 'Sale phụ trách giao dịch phải trùng với Sale đang phụ trách khách hàng.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS crm_deal_owner_guard_v1_trg ON public.deals;
CREATE TRIGGER crm_deal_owner_guard_v1_trg
BEFORE INSERT OR UPDATE OF lead_id, property_id, owner_id ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.crm_deal_owner_guard_v1();
