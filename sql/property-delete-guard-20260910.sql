-- Protect cemetery inventory history from accidental property deletion.
-- Once a property/plot is referenced by a sales opportunity, deal, or contract,
-- keep the record and change its status instead of deleting it.

CREATE OR REPLACE FUNCTION public.crm_property_delete_guard_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals d WHERE d.property_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_opportunities o WHERE o.property_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.crm_contracts c WHERE c.property_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Mộ phần đã phát sinh cơ hội/giao dịch/hợp đồng. Hãy đổi trạng thái để giữ lịch sử thay vì xóa.'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS crm_property_delete_guard_v2_trg ON public.properties;
CREATE TRIGGER crm_property_delete_guard_v2_trg
BEFORE DELETE ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.crm_property_delete_guard_v2();
