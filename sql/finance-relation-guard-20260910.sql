-- Enforce one coherent Sales-to-Cash chain across lead -> deal -> property -> contract -> payment.
-- Prevent API/manual requests from cross-linking records belonging to different customers/deals.

CREATE OR REPLACE FUNCTION public.crm_finance_relation_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_deal_lead uuid;
  v_deal_property uuid;
  v_contract_lead uuid;
  v_contract_deal uuid;
BEGIN
  IF TG_TABLE_NAME = 'crm_contracts' THEN
    IF NEW.deal_id IS NOT NULL THEN
      SELECT d.lead_id, d.property_id
      INTO v_deal_lead, v_deal_property
      FROM public.deals d
      WHERE d.id = NEW.deal_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Giao dịch liên kết không tồn tại.' USING ERRCODE = '23503';
      END IF;

      IF NEW.lead_id IS DISTINCT FROM v_deal_lead THEN
        RAISE EXCEPTION 'Hợp đồng và giao dịch phải thuộc cùng một khách hàng.' USING ERRCODE = '23514';
      END IF;

      IF NEW.property_id IS NULL AND v_deal_property IS NOT NULL THEN
        NEW.property_id := v_deal_property;
      ELSIF NEW.property_id IS NOT NULL
        AND v_deal_property IS NOT NULL
        AND NEW.property_id IS DISTINCT FROM v_deal_property THEN
        RAISE EXCEPTION 'Hợp đồng và giao dịch phải gắn cùng một mộ phần.' USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'crm_payments' THEN
    IF NEW.contract_id IS NOT NULL THEN
      SELECT c.lead_id, c.deal_id
      INTO v_contract_lead, v_contract_deal
      FROM public.crm_contracts c
      WHERE c.id = NEW.contract_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Hợp đồng liên kết không tồn tại.' USING ERRCODE = '23503';
      END IF;

      IF NEW.lead_id IS DISTINCT FROM v_contract_lead THEN
        RAISE EXCEPTION 'Phiếu thu và hợp đồng phải thuộc cùng một khách hàng.' USING ERRCODE = '23514';
      END IF;

      IF NEW.deal_id IS NULL AND v_contract_deal IS NOT NULL THEN
        NEW.deal_id := v_contract_deal;
      ELSIF NEW.deal_id IS NOT NULL
        AND v_contract_deal IS NOT NULL
        AND NEW.deal_id IS DISTINCT FROM v_contract_deal THEN
        RAISE EXCEPTION 'Phiếu thu và hợp đồng phải thuộc cùng một giao dịch.' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.deal_id IS NOT NULL THEN
      SELECT d.lead_id
      INTO v_deal_lead
      FROM public.deals d
      WHERE d.id = NEW.deal_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Giao dịch liên kết không tồn tại.' USING ERRCODE = '23503';
      END IF;

      IF NEW.lead_id IS DISTINCT FROM v_deal_lead THEN
        RAISE EXCEPTION 'Phiếu thu và giao dịch phải thuộc cùng một khách hàng.' USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS crm_finance_contract_relation_guard_trg ON public.crm_contracts;
CREATE TRIGGER crm_finance_contract_relation_guard_trg
BEFORE INSERT OR UPDATE OF deal_id, lead_id, property_id ON public.crm_contracts
FOR EACH ROW
EXECUTE FUNCTION public.crm_finance_relation_guard_v1();

DROP TRIGGER IF EXISTS crm_finance_payment_relation_guard_trg ON public.crm_payments;
CREATE TRIGGER crm_finance_payment_relation_guard_trg
BEFORE INSERT OR UPDATE OF contract_id, deal_id, lead_id ON public.crm_payments
FOR EACH ROW
EXECUTE FUNCTION public.crm_finance_relation_guard_v1();
