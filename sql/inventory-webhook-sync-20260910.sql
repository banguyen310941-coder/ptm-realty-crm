-- PTM CRM · Đồng bộ trạng thái giỏ mộ từ BẢNG GIÁ-DỰ ÁN QUẢNG NINH
-- Date: 2026-09-10
-- Secret values are provisioned separately in crm_integration_config; never commit plaintext secrets here.

CREATE OR REPLACE FUNCTION public.crm_inventory_sync_v1(p_secret text, p_rows jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb;
  v_code text;
  v_raw_status text;
  v_norm_status text;
  v_db_status text;
  v_source_sheet text;
  v_source_row integer;
  v_plot record;
  v_deal record;
  v_expected_internal text;
  v_has_contract boolean;
  v_has_payment boolean;
  v_seen integer := 0;
  v_changed integer := 0;
  v_conflict_count integer := 0;
  v_unknown_count integer := 0;
  v_invalid_count integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_unknown jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
  v_reason text;
  v_old_effective text;
  v_old_source text;
BEGIN
  IF NOT public.crm_integration_secret_ok('inventory_webhook', p_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_WEBHOOK_SECRET');
  END IF;

  IF jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROWS_MUST_BE_ARRAY');
  END IF;

  IF jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BATCH_TOO_LARGE', 'max_rows', 500);
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) LOOP
    v_seen := v_seen + 1;
    v_code := trim(coalesce(v_row->>'code', v_row->>'Mã Sản Phẩm', v_row->>'ma_san_pham', ''));
    v_raw_status := trim(coalesce(v_row->>'status', v_row->>'Trạng thái', v_row->>'trang_thai', ''));
    v_source_sheet := nullif(trim(coalesce(v_row->>'source_sheet', v_row->>'sheet', '')), '');
    BEGIN
      v_source_row := nullif(trim(coalesce(v_row->>'source_row', v_row->>'row', '')), '')::integer;
    EXCEPTION WHEN OTHERS THEN
      v_source_row := NULL;
    END;

    IF v_code = '' OR v_raw_status = '' THEN
      v_invalid_count := v_invalid_count + 1;
      IF jsonb_array_length(v_invalid) < 50 THEN
        v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
          'code', nullif(v_code, ''),
          'status', nullif(v_raw_status, ''),
          'reason', 'MISSING_CODE_OR_STATUS'
        ));
      END IF;
      CONTINUE;
    END IF;

    v_norm_status := lower(regexp_replace(v_raw_status, '\s+', ' ', 'g'));
    v_db_status := CASE
      WHEN v_norm_status IN ('mở bán','mo ban','available') THEN 'available'
      WHEN v_norm_status IN ('giữ chỗ','giu cho','hold','reserved','giữ chổ') THEN 'hold'
      WHEN v_norm_status IN ('đặt cọc','dat coc','deposit','cọc','coc') THEN 'deposit'
      WHEN v_norm_status IN ('đã bán','da ban','sold','bán','ban') THEN 'sold'
      WHEN v_norm_status IN ('khóa','khoá','khoa','locked','lock') THEN 'locked'
      ELSE NULL
    END;

    IF v_db_status IS NULL THEN
      v_invalid_count := v_invalid_count + 1;
      IF jsonb_array_length(v_invalid) < 50 THEN
        v_invalid := v_invalid || jsonb_build_array(jsonb_build_object(
          'code', v_code,
          'status', v_raw_status,
          'reason', 'UNKNOWN_SOURCE_STATUS'
        ));
      END IF;
      CONTINUE;
    END IF;

    SELECT p.id, p.code, p.sales_status, p.status, p.source_status, p.source_sheet, p.source_row
    INTO v_plot
    FROM public.properties p
    WHERE p.project = 'Thiên Phúc Vĩnh Hằng Viên'
      AND upper(p.code) = upper(v_code)
    LIMIT 1;

    IF v_plot.id IS NULL THEN
      v_unknown_count := v_unknown_count + 1;
      IF jsonb_array_length(v_unknown) < 50 THEN
        v_unknown := v_unknown || jsonb_build_array(jsonb_build_object(
          'code', v_code,
          'status', v_raw_status,
          'source_sheet', v_source_sheet,
          'source_row', v_source_row
        ));
      END IF;
      CONTINUE;
    END IF;

    v_old_effective := coalesce(v_plot.sales_status, '');
    v_old_source := coalesce(v_plot.source_status, '');

    SELECT d.id, d.stage, d.lead_id, d.owner_id
    INTO v_deal
    FROM public.deals d
    WHERE d.property_id = v_plot.id
      AND d.stage <> 'cancelled'
    ORDER BY d.updated_at DESC, d.created_at DESC
    LIMIT 1;

    v_expected_internal := CASE
      WHEN v_deal.id IS NULL THEN NULL
      WHEN v_deal.stage = 'booking' THEN 'hold'
      WHEN v_deal.stage IN ('deposit','negotiation','contract') THEN 'deposit'
      WHEN v_deal.stage = 'completed' THEN 'sold'
      ELSE NULL
    END;

    SELECT EXISTS(
      SELECT 1
      FROM public.crm_contracts c
      WHERE c.property_id = v_plot.id
        AND c.status <> 'cancelled'
    ) INTO v_has_contract;

    SELECT EXISTS(
      SELECT 1
      FROM public.crm_payments pay
      LEFT JOIN public.crm_contracts c ON c.id = pay.contract_id
      LEFT JOIN public.deals d ON d.id = pay.deal_id
      WHERE pay.status <> 'cancelled'
        AND (c.property_id = v_plot.id OR d.property_id = v_plot.id)
    ) INTO v_has_payment;

    v_reason := NULL;

    -- External source may not reopen a plot while PTM still has an active business relation.
    IF v_db_status = 'available'
       AND (v_deal.id IS NOT NULL OR v_has_contract OR v_has_payment) THEN
      v_reason := concat_ws(',',
        CASE WHEN v_deal.id IS NOT NULL THEN 'ACTIVE_DEAL' END,
        CASE WHEN v_has_contract THEN 'ACTIVE_CONTRACT' END,
        CASE WHEN v_has_payment THEN 'ACTIVE_PAYMENT' END
      );

      IF v_plot.source_status IS DISTINCT FROM v_raw_status
         OR (v_source_sheet IS NOT NULL AND v_plot.source_sheet IS DISTINCT FROM v_source_sheet)
         OR (v_source_row IS NOT NULL AND v_plot.source_row IS DISTINCT FROM v_source_row) THEN
        UPDATE public.properties
        SET source_status = v_raw_status,
            source_sheet = coalesce(v_source_sheet, source_sheet),
            source_row = coalesce(v_source_row, source_row),
            inventory_source = 'BẢNG GIÁ-DỰ ÁN QUẢNG NINH',
            inventory_updated_at = now(),
            updated_at = now()
        WHERE id = v_plot.id;
      END IF;

      v_conflict_count := v_conflict_count + 1;
      IF jsonb_array_length(v_conflicts) < 100 THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', v_plot.code,
          'external', v_db_status,
          'internal', v_old_effective,
          'deal_stage', v_deal.stage,
          'reason', v_reason
        ));
      END IF;

      IF v_old_source IS DISTINCT FROM v_raw_status THEN
        INSERT INTO public.crm_notifications(user_id, notification_type, title, body, entity_type, entity_id)
        SELECT u.id,
               'warning',
               left('Xung đột giỏ mộ · ' || v_plot.code, 180),
               left('Nguồn chủ đầu tư chuyển về Mở bán nhưng CRM đang có '
                 || replace(v_reason, ',', ', ')
                 || '. CRM giữ nguyên trạng thái nội bộ để tránh mở bán nhầm.', 1000),
               'property',
               v_plot.id
        FROM public.users u
        WHERE u.active = true
          AND u.role IN ('ceo','admin','manager')
          AND NOT EXISTS (
            SELECT 1
            FROM public.crm_notifications n
            WHERE n.user_id = u.id
              AND n.entity_type = 'property'
              AND n.entity_id = v_plot.id
              AND n.title = left('Xung đột giỏ mộ · ' || v_plot.code, 180)
              AND n.created_at > now() - interval '6 hours'
          );
      END IF;
      CONTINUE;
    END IF;

    -- A restrictive source status wins to prevent duplicate selling, but mismatches are reported.
    IF v_db_status <> 'available'
       AND v_expected_internal IS NOT NULL
       AND v_expected_internal IS DISTINCT FROM v_db_status THEN
      v_reason := 'EXTERNAL_INTERNAL_STATUS_MISMATCH';
      v_conflict_count := v_conflict_count + 1;

      IF jsonb_array_length(v_conflicts) < 100 THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', v_plot.code,
          'external', v_db_status,
          'internal_expected', v_expected_internal,
          'deal_stage', v_deal.stage,
          'reason', v_reason
        ));
      END IF;

      IF v_old_source IS DISTINCT FROM v_raw_status
         OR v_old_effective IS DISTINCT FROM v_db_status THEN
        INSERT INTO public.crm_notifications(user_id, notification_type, title, body, entity_type, entity_id)
        SELECT u.id,
               'warning',
               left('Giỏ mộ đổi trạng thái · ' || v_plot.code, 180),
               left('Nguồn chủ đầu tư: ' || v_raw_status
                 || '; CRM đang có giao dịch giai đoạn ' || coalesce(v_deal.stage, '—')
                 || '. CRM ưu tiên trạng thái hạn chế từ nguồn để tránh bán trùng.', 1000),
               'property',
               v_plot.id
        FROM public.users u
        WHERE u.active = true
          AND u.role IN ('ceo','admin','manager')
          AND NOT EXISTS (
            SELECT 1
            FROM public.crm_notifications n
            WHERE n.user_id = u.id
              AND n.entity_type = 'property'
              AND n.entity_id = v_plot.id
              AND n.title = left('Giỏ mộ đổi trạng thái · ' || v_plot.code, 180)
              AND n.created_at > now() - interval '6 hours'
          );
      END IF;
    END IF;

    IF v_plot.sales_status IS DISTINCT FROM v_db_status
       OR v_plot.source_status IS DISTINCT FROM v_raw_status
       OR (v_source_sheet IS NOT NULL AND v_plot.source_sheet IS DISTINCT FROM v_source_sheet)
       OR (v_source_row IS NOT NULL AND v_plot.source_row IS DISTINCT FROM v_source_row) THEN
      UPDATE public.properties
      SET sales_status = v_db_status,
          status = CASE
            WHEN v_db_status = 'available' THEN 'available'
            WHEN v_db_status IN ('hold','deposit') THEN 'reserved'
            WHEN v_db_status = 'sold' THEN 'sold'
            ELSE 'locked'
          END,
          source_status = v_raw_status,
          source_sheet = coalesce(v_source_sheet, source_sheet),
          source_row = coalesce(v_source_row, source_row),
          inventory_source = 'BẢNG GIÁ-DỰ ÁN QUẢNG NINH',
          inventory_updated_at = now(),
          updated_at = now()
      WHERE id = v_plot.id;

      INSERT INTO public.activity_log(user_id, action, entity_type, entity_id, detail)
      VALUES(
        NULL,
        'cemetery.inventory.sync',
        'property',
        v_plot.id::text,
        jsonb_build_object(
          'code', v_plot.code,
          'old_sales_status', v_old_effective,
          'new_sales_status', v_db_status,
          'source_status', v_raw_status,
          'source_sheet', v_source_sheet,
          'source_row', v_source_row
        )::text
      );
      v_changed := v_changed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'seen', v_seen,
    'changed', v_changed,
    'conflict_count', v_conflict_count,
    'unknown_count', v_unknown_count,
    'invalid_count', v_invalid_count,
    'conflicts', v_conflicts,
    'unknown', v_unknown,
    'invalid', v_invalid
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END
$function$;

REVOKE ALL ON FUNCTION public.crm_inventory_sync_v1(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_inventory_sync_v1(text,jsonb) TO anonymous, authenticated;
