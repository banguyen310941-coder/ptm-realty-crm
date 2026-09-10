-- Protect Customer 360 business history from accidental lead deletion.
-- A lead may be deleted only when it has not generated downstream operational,
-- sales, finance, or support records. Lightweight CRM history such as activities
-- and tags keeps the existing ON DELETE CASCADE behavior.

CREATE OR REPLACE FUNCTION public.crm_lead_delete_guard_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals d WHERE d.lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_opportunities o WHERE o.lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_tickets t WHERE t.lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_contracts c WHERE c.lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_payments p WHERE p.lead_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Khách hàng đã phát sinh nghiệp vụ bán hàng/tài chính/CSKH. Hãy giữ hồ sơ để bảo toàn lịch sử thay vì xóa.'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS crm_lead_delete_guard_v2_trg ON public.leads;
CREATE TRIGGER crm_lead_delete_guard_v2_trg
BEFORE DELETE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.crm_lead_delete_guard_v2();
