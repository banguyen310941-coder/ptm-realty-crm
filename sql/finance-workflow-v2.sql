-- PTM CRM: Sales-to-cash workflow v2
-- Giữ chỗ -> Phiếu cọc -> Hợp đồng -> Thanh toán -> Hoa hồng

CREATE OR REPLACE FUNCTION public.crm_finance_reconcile_deal(p_deal uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stage text;
  v_value numeric(18,2);
  v_expected_commission numeric(18,2);
  v_owner uuid;
  v_contract uuid;
  v_contract_status text;
  v_total numeric(18,2) := 0;
  v_paid numeric(18,2) := 0;
  v_deposit_paid numeric(18,2) := 0;
  v_deposit_ready boolean := false;
  v_commission_created boolean := false;
  v_rows integer := 0;
BEGIN
  SELECT d.stage,d.value,d.commission,d.owner_id
  INTO v_stage,v_value,v_expected_commission,v_owner
  FROM public.deals d
  WHERE d.id=p_deal
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','Giao dịch không tồn tại.');
  END IF;

  SELECT coalesce(sum(CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END),0)
  INTO v_paid
  FROM public.crm_payments pay
  WHERE pay.deal_id=p_deal AND pay.status='paid';

  SELECT coalesce(sum(pay.amount),0)
  INTO v_deposit_paid
  FROM public.crm_payments pay
  WHERE pay.deal_id=p_deal AND pay.status='paid' AND pay.payment_type='deposit';

  v_deposit_ready := v_deposit_paid>0 OR EXISTS(
    SELECT 1 FROM public.crm_contracts c
    WHERE c.deal_id=p_deal AND c.contract_type='deposit' AND c.status IN ('signed','completed')
  );

  SELECT c.id,c.status,c.total_value
  INTO v_contract,v_contract_status,v_total
  FROM public.crm_contracts c
  WHERE c.deal_id=p_deal AND c.contract_type='sale' AND c.status<>'cancelled'
  ORDER BY CASE c.status WHEN 'completed' THEN 4 WHEN 'signed' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END DESC,c.updated_at DESC
  LIMIT 1;

  IF v_stage<>'cancelled' THEN
    IF v_contract IS NOT NULL
       AND v_contract_status IN ('signed','completed')
       AND coalesce(v_total,0)>0
       AND v_paid>=v_total THEN
      UPDATE public.crm_contracts
      SET status='completed',updated_at=now()
      WHERE id=v_contract AND status<>'cancelled';
      UPDATE public.deals
      SET stage='completed',updated_at=now()
      WHERE id=p_deal AND stage<>'completed';
      v_stage:='completed';
    ELSIF v_contract IS NOT NULL
       AND v_contract_status IN ('signed','completed')
       AND v_stage IN ('booking','deposit','negotiation') THEN
      UPDATE public.deals SET stage='contract',updated_at=now() WHERE id=p_deal;
      v_stage:='contract';
    ELSIF v_deposit_ready AND v_stage='booking' THEN
      UPDATE public.deals SET stage='deposit',updated_at=now() WHERE id=p_deal;
      v_stage:='deposit';
    END IF;
  END IF;

  IF v_stage='completed'
     AND coalesce(v_expected_commission,0)>0
     AND v_owner IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=v_owner AND u.role='sale') THEN
    INSERT INTO public.crm_commissions(deal_id,user_id,basis_amount,rate,amount,status,notes)
    VALUES(
      p_deal,
      v_owner,
      coalesce(v_value,0),
      CASE WHEN coalesce(v_value,0)>0 THEN round(v_expected_commission*100/v_value,4) ELSE 0 END,
      v_expected_commission,
      'pending',
      'Tự động tạo khi giao dịch thanh toán đủ'
    )
    ON CONFLICT(deal_id,user_id) DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    v_commission_created:=v_rows>0;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'deal_id',p_deal,
    'stage',v_stage,
    'paid_total',v_paid,
    'contract_total',coalesce(v_total,0),
    'balance',greatest(coalesce(v_total,0)-v_paid,0),
    'deposit_paid',v_deposit_paid,
    'commission_created',v_commission_created
  );
END
$function$;

REVOKE ALL ON FUNCTION public.crm_finance_reconcile_deal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_finance_api_v2(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_result jsonb;
  v_workflows jsonb;
  v_sync jsonb;
  v_id uuid;
  v_deal uuid;
  v_lead uuid;
  v_property uuid;
  v_contract uuid;
  v_payment uuid;
  v_amount numeric(18,2);
  v_deal_stage text;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.','code','UNAUTHENTICATED');
  END IF;

  IF p_action='bootstrap' THEN
    v_result:=public.crm_finance_api(p_token,p_action,p_payload);
    IF coalesce((v_result->>'ok')::boolean,false)=false THEN RETURN v_result; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'deal_id',d.id,
      'stage',d.stage,
      'deal_value',d.value,
      'commission_expected',d.commission,
      'lead_id',d.lead_id,
      'lead_name',l.name,
      'property_id',d.property_id,
      'property_name',p.name,
      'property_code',p.code,
      'owner_id',d.owner_id,
      'owner_name',u.name,
      'deposit_contract_id',dc.id,
      'deposit_contract_code',dc.code,
      'deposit_contract_status',dc.status,
      'deposit_paid',coalesce(dep.deposit_paid,0),
      'sale_contract_id',sc.id,
      'sale_contract_code',sc.code,
      'sale_contract_status',sc.status,
      'sale_contract_total',coalesce(sc.total_value,0),
      'paid_total',coalesce(pay.paid_total,0),
      'balance',greatest(coalesce(sc.total_value,0)-coalesce(pay.paid_total,0),0),
      'commission_id',cm.id,
      'commission_status',cm.status,
      'commission_amount',coalesce(cm.amount,0)
    ) ORDER BY d.updated_at DESC),'[]'::jsonb)
    INTO v_workflows
    FROM public.deals d
    LEFT JOIN public.leads l ON l.id=d.lead_id
    LEFT JOIN public.properties p ON p.id=d.property_id
    LEFT JOIN public.users u ON u.id=d.owner_id
    LEFT JOIN LATERAL (
      SELECT c.id,c.code,c.status,c.total_value
      FROM public.crm_contracts c
      WHERE c.deal_id=d.id AND c.contract_type='deposit' AND c.status<>'cancelled'
      ORDER BY c.updated_at DESC LIMIT 1
    ) dc ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(x.amount),0) deposit_paid
      FROM public.crm_payments x
      WHERE x.deal_id=d.id AND x.status='paid' AND x.payment_type='deposit'
    ) dep ON true
    LEFT JOIN LATERAL (
      SELECT c.id,c.code,c.status,c.total_value
      FROM public.crm_contracts c
      WHERE c.deal_id=d.id AND c.contract_type='sale' AND c.status<>'cancelled'
      ORDER BY CASE c.status WHEN 'completed' THEN 4 WHEN 'signed' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END DESC,c.updated_at DESC
      LIMIT 1
    ) sc ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(CASE WHEN x.payment_type='refund' THEN -x.amount ELSE x.amount END),0) paid_total
      FROM public.crm_payments x
      WHERE x.deal_id=d.id AND x.status='paid'
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT c.id,c.status,c.amount
      FROM public.crm_commissions c
      WHERE c.deal_id=d.id
      ORDER BY (c.user_id=d.owner_id) DESC,c.updated_at DESC
      LIMIT 1
    ) cm ON true
    WHERE d.stage<>'cancelled'
      AND (v_role<>'sale' OR d.owner_id=v_uid OR l.owner_id=v_uid);

    RETURN jsonb_set(v_result,'{workflows}',v_workflows,true);
  END IF;

  IF p_action='workflow.deposit.confirm' THEN
    IF v_role NOT IN ('admin','ceo','manager','accounting') THEN
      RETURN jsonb_build_object('ok',false,'error','Chỉ Kế toán/Giám đốc/Admin được xác nhận tiền cọc.');
    END IF;

    v_deal:=nullif(p_payload->>'deal_id','')::uuid;
    v_amount:=coalesce(nullif(p_payload->>'amount','')::numeric,0);
    IF v_deal IS NULL OR v_amount<=0 THEN
      RETURN jsonb_build_object('ok',false,'error','Vui lòng chọn giao dịch và nhập số tiền cọc lớn hơn 0.');
    END IF;

    SELECT d.lead_id,d.property_id,d.stage
    INTO v_lead,v_property,v_deal_stage
    FROM public.deals d
    WHERE d.id=v_deal
    FOR UPDATE;

    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Giao dịch không tồn tại.'); END IF;
    IF v_deal_stage IN ('cancelled','completed') THEN RETURN jsonb_build_object('ok',false,'error','Giao dịch đã đóng, không thể xác nhận cọc.'); END IF;
    IF v_lead IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Giao dịch chưa gắn khách hàng.'); END IF;

    SELECT c.id INTO v_contract
    FROM public.crm_contracts c
    WHERE c.deal_id=v_deal AND c.contract_type='deposit' AND c.status<>'cancelled'
    ORDER BY c.updated_at DESC LIMIT 1
    FOR UPDATE;

    IF v_contract IS NULL THEN
      INSERT INTO public.crm_contracts(deal_id,lead_id,property_id,contract_type,status,total_value,signed_at,effective_date,notes,created_by)
      VALUES(v_deal,v_lead,v_property,'deposit','signed',v_amount,current_date,current_date,nullif(p_payload->>'notes',''),v_uid)
      RETURNING id INTO v_contract;
    ELSE
      UPDATE public.crm_contracts
      SET lead_id=v_lead,property_id=v_property,status='signed',total_value=v_amount,
          signed_at=coalesce(signed_at,current_date),effective_date=coalesce(effective_date,current_date),
          notes=CASE WHEN p_payload ? 'notes' THEN nullif(p_payload->>'notes','') ELSE notes END,
          updated_at=now()
      WHERE id=v_contract;
    END IF;

    SELECT pay.id INTO v_payment
    FROM public.crm_payments pay
    WHERE pay.deal_id=v_deal AND pay.payment_type='deposit' AND pay.status<>'cancelled'
    ORDER BY pay.updated_at DESC LIMIT 1
    FOR UPDATE;

    IF v_payment IS NULL THEN
      INSERT INTO public.crm_payments(contract_id,deal_id,lead_id,payment_type,amount,due_date,paid_at,status,reference,notes,created_by)
      VALUES(v_contract,v_deal,v_lead,'deposit',v_amount,current_date,coalesce(nullif(p_payload->>'paid_at','')::timestamptz,now()),'paid',nullif(p_payload->>'reference',''),nullif(p_payload->>'notes',''),v_uid)
      RETURNING id INTO v_payment;
    ELSE
      UPDATE public.crm_payments
      SET contract_id=v_contract,lead_id=v_lead,amount=v_amount,status='paid',
          paid_at=coalesce(nullif(p_payload->>'paid_at','')::timestamptz,paid_at,now()),
          reference=CASE WHEN p_payload ? 'reference' THEN nullif(p_payload->>'reference','') ELSE reference END,
          notes=CASE WHEN p_payload ? 'notes' THEN nullif(p_payload->>'notes','') ELSE notes END,
          updated_at=now()
      WHERE id=v_payment;
    END IF;

    v_sync:=public.crm_finance_reconcile_deal(v_deal);
    INSERT INTO public.activity_log(user_id,action,entity_type,entity_id,detail)
    VALUES(v_uid,'finance.deposit.confirm','deal',v_deal,jsonb_build_object('amount',v_amount,'contract_id',v_contract,'payment_id',v_payment));

    RETURN jsonb_build_object('ok',true,'contract_id',v_contract,'payment_id',v_payment,'workflow',v_sync);
  END IF;

  IF p_action IN ('contract.save','payment.save') THEN
    v_result:=public.crm_finance_api(p_token,p_action,p_payload);
    IF coalesce((v_result->>'ok')::boolean,false)=false THEN RETURN v_result; END IF;
    v_id:=nullif(v_result->>'id','')::uuid;
    IF p_action='contract.save' THEN
      SELECT c.deal_id INTO v_deal FROM public.crm_contracts c WHERE c.id=v_id;
    ELSE
      SELECT pay.deal_id INTO v_deal FROM public.crm_payments pay WHERE pay.id=v_id;
    END IF;
    IF v_deal IS NOT NULL THEN v_sync:=public.crm_finance_reconcile_deal(v_deal); END IF;
    RETURN v_result || jsonb_build_object('workflow',coalesce(v_sync,'{}'::jsonb));
  END IF;

  RETURN public.crm_finance_api(p_token,p_action,p_payload);
END
$function$;

GRANT EXECUTE ON FUNCTION public.crm_finance_api_v2(text,text,jsonb) TO anon, authenticated;
