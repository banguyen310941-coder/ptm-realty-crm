-- PTM CRM · Accounting deal workflow hardening
-- Accounting must use the Finance RPC workflow so deposit, contracts, payments,
-- reconciliation and audit logs are created together. Direct deal-stage edits are blocked.

CREATE OR REPLACE FUNCTION public.crm_accounting_save_deal_v2(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
WITH cu AS (
  SELECT u.id
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
    AND u.role='accounting'
  LIMIT 1
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object('ok',false,'error','Chỉ Kế toán được dùng thao tác này')
  ELSE jsonb_build_object('ok',false,'error','Kế toán xử lý cọc, hợp đồng, thanh toán và hoàn tất tại module Hợp đồng & Tài chính; không cập nhật giai đoạn giao dịch trực tiếp.')
END
$$;
