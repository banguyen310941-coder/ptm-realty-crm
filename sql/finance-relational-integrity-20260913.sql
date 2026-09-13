-- PTM CRM · finance relational integrity · 2026-09-13
-- Prevent contracts/payments from pointing at a different lead/deal/property
-- than their parent business records.

CREATE OR REPLACE FUNCTION public.crm_contract_consistency_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_deal_lead uuid;
  v_deal_property uuid;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.lead_id,d.property_id
  INTO v_deal_lead,v_deal_property
  FROM public.deals d
  WHERE d.id=NEW.deal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Giao dịch liên kết không tồn tại.';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM v_deal_lead THEN
    RAISE EXCEPTION 'Hợp đồng và giao dịch phải thuộc cùng một khách hàng.';
  END IF;

  IF NEW.property_id IS DISTINCT FROM v_deal_property THEN
    RAISE EXCEPTION 'Hợp đồng và giao dịch phải thuộc cùng một mộ phần/sản phẩm.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_payment_consistency_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_contract_lead uuid;
  v_contract_deal uuid;
  v_deal_lead uuid;
BEGIN
  IF NEW.contract_id IS NOT NULL THEN
    SELECT c.lead_id,c.deal_id
    INTO v_contract_lead,v_contract_deal
    FROM public.crm_contracts c
    WHERE c.id=NEW.contract_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Hợp đồng liên kết không tồn tại.';
    END IF;

    IF NEW.lead_id IS DISTINCT FROM v_contract_lead THEN
      RAISE EXCEPTION 'Thanh toán và hợp đồng phải thuộc cùng một khách hàng.';
    END IF;

    IF NEW.deal_id IS DISTINCT FROM v_contract_deal THEN
      RAISE EXCEPTION 'Thanh toán và hợp đồng phải thuộc cùng một giao dịch.';
    END IF;
  END IF;

  IF NEW.deal_id IS NOT NULL THEN
    SELECT d.lead_id INTO v_deal_lead
    FROM public.deals d
    WHERE d.id=NEW.deal_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Giao dịch liên kết không tồn tại.';
    END IF;

    IF NEW.lead_id IS DISTINCT FROM v_deal_lead THEN
      RAISE EXCEPTION 'Thanh toán và giao dịch phải thuộc cùng một khách hàng.';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS crm_contract_consistency_guard ON public.crm_contracts;
CREATE TRIGGER crm_contract_consistency_guard
BEFORE INSERT OR UPDATE OF deal_id,lead_id,property_id
ON public.crm_contracts
FOR EACH ROW
EXECUTE FUNCTION public.crm_contract_consistency_guard_v1();

DROP TRIGGER IF EXISTS crm_payment_consistency_guard ON public.crm_payments;
CREATE TRIGGER crm_payment_consistency_guard
BEFORE INSERT OR UPDATE OF contract_id,deal_id,lead_id
ON public.crm_payments
FOR EACH ROW
EXECUTE FUNCTION public.crm_payment_consistency_guard_v1();

REVOKE ALL ON FUNCTION public.crm_contract_consistency_guard_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_payment_consistency_guard_v1() FROM PUBLIC;

NOTIFY pgrst,'reload schema';
