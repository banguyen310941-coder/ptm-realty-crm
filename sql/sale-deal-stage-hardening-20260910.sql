-- PTM CRM · Sale deal-stage hardening
-- Tested on temporary Neon branch test-sale-deal-hardening-20260910 before production rollout.
-- Sales may create a booking and cancel/re-open their own booking only.
-- Deposit, contract, payment and completion must flow through Finance workflows.

CREATE OR REPLACE FUNCTION public.crm_sale_save_deal_v2(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_sale uuid;
  v_id uuid;
  v_lead uuid;
  v_property uuid;
  v_stage text;
  v_current_stage text;
  v_value numeric;
BEGIN
  SELECT u.id INTO v_sale
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true AND u.role='sale'
  LIMIT 1;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền thực hiện thao tác này');
  END IF;

  v_id:=nullif(p_payload->>'id','')::uuid;
  v_stage:=coalesce(nullif(p_payload->>'stage',''),'booking');

  IF v_id IS NULL THEN
    IF v_stage <> 'booking' THEN
      RETURN jsonb_build_object('ok',false,'error','Sale chỉ được tạo giao dịch ở giai đoạn Giữ chỗ. Cọc, hợp đồng và hoàn tất phải đi qua quy trình Tài chính.');
    END IF;

    v_lead:=nullif(p_payload->>'lead_id','')::uuid;
    v_property:=nullif(p_payload->>'property_id','')::uuid;
    IF v_lead IS NULL OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=v_lead AND owner_id=v_sale) THEN
      RETURN jsonb_build_object('ok',false,'error','Sale chỉ được tạo giao dịch cho khách hàng của mình');
    END IF;
    IF v_property IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','Vui lòng chọn mộ phần');
    END IF;

    SELECT coalesce(nullif(price_before_vat,0),price,0)
      INTO v_value
      FROM public.properties
     WHERE id=v_property;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error','Mộ phần không tồn tại');
    END IF;

    INSERT INTO public.deals(lead_id,property_id,value,commission,stage,owner_id,deal_date,notes)
    VALUES(v_lead,v_property,coalesce(v_value,0),0,'booking',v_sale,current_date,nullif(p_payload->>'notes',''))
    RETURNING id INTO v_id;
  ELSE
    SELECT stage INTO v_current_stage
      FROM public.deals
     WHERE id=v_id AND owner_id=v_sale;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error','Bạn chỉ được cập nhật giao dịch của mình');
    END IF;

    IF v_current_stage NOT IN ('booking','cancelled') THEN
      RETURN jsonb_build_object('ok',false,'error','Giao dịch đã qua bước Giữ chỗ. Sale chỉ được theo dõi; cọc, hợp đồng, thanh toán và hoàn tất phải đi qua quy trình Tài chính.');
    END IF;

    IF v_stage NOT IN ('booking','cancelled') THEN
      RETURN jsonb_build_object('ok',false,'error','Sale chỉ được giữ chỗ hoặc hủy giữ chỗ của mình.');
    END IF;

    UPDATE public.deals
       SET stage=v_stage,
           notes=nullif(p_payload->>'notes',''),
           updated_at=now()
     WHERE id=v_id AND owner_id=v_sale;
  END IF;

  RETURN jsonb_build_object('ok',true,'id',v_id);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','Mộ phần đã có giao dịch đang hoạt động');
  WHEN others THEN
    RETURN jsonb_build_object('ok',false,'error',SQLERRM);
END
$$;
