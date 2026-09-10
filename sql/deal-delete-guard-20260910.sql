-- PTM CRM · Deal deletion guard
-- Keep historical/financial integrity even if a caller bypasses the UI.
-- A deal may be deleted only while it is booking/cancelled AND has no linked
-- contracts, payments or commissions. Otherwise use Cancelled to keep history.

CREATE OR REPLACE FUNCTION public.crm_deal_delete_guard_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF OLD.stage NOT IN ('booking','cancelled') THEN
    RAISE EXCEPTION 'Giao dịch đã qua bước Giữ chỗ. Hãy chuyển sang Hủy để giữ lịch sử thay vì xóa.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.crm_contracts c WHERE c.deal_id=OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_payments p WHERE p.deal_id=OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_commissions c WHERE c.deal_id=OLD.id) THEN
    RAISE EXCEPTION 'Giao dịch đã có chứng từ tài chính/hợp đồng/hoa hồng, không thể xóa.';
  END IF;

  RETURN OLD;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='crm_deal_delete_guard_v2_trg'
      AND tgrelid='public.deals'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER crm_deal_delete_guard_v2_trg
    BEFORE DELETE ON public.deals
    FOR EACH ROW EXECUTE FUNCTION public.crm_deal_delete_guard_v2();
  END IF;
END
$$;
