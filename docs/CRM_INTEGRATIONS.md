# PTM CRM — Tích hợp Lead & Automation

## Endpoint nhận lead

Production:

`POST /api/leads/intake?source=website|facebook|tiktok|zalo|google|hotline`

Header bảo mật:

`x-ptm-webhook-secret: <LEAD_WEBHOOK_SECRET>`

Có thể dùng `Authorization: Bearer <LEAD_WEBHOOK_SECRET>` thay cho header trên.

Payload tối thiểu:

```json
{
  "name": "Nguyễn Văn A",
  "phone": "0901234567",
  "email": "a@example.com",
  "need": "Tìm mộ gia đình khu C1 hướng Đông Nam",
  "budget": 500000000,
  "project": "Thiên Phúc Vĩnh Hằng Viên",
  "utm_source": "facebook",
  "utm_medium": "paid",
  "utm_campaign": "thien-phuc-lead"
}
```

CRM tự chuẩn hóa nguồn, chống trùng SĐT/email và ghi attribution vào `leads.profile.attribution`. Lead mới đi qua cơ chế phân Sale hiện có; lead trùng chỉ cập nhật phần thông tin còn thiếu và attribution, không xóa lịch sử chăm sóc.

## Facebook / Meta webhook

GET `/api/leads/intake` hỗ trợ cơ chế verify `hub.verify_token` + `hub.challenge`.

Nếu Meta chỉ gửi `leadgen_id`, CRM trả HTTP 202 với `LEAD_DETAILS_REQUIRED`. Khi đó cần bridge/provider credential để lấy chi tiết lead từ Meta Graph API rồi POST lại payload có SĐT vào endpoint intake.

## Automation engine

Endpoints:

- `POST /api/automation/event` — phát sự kiện từ app, yêu cầu CRM session bearer token.
- `POST /api/automation/run` — sweep follow-up đến hạn và xử lý offer lead hết hạn. Có thể gọi bằng CRM session hoặc `CRON_SECRET`.

Action hỗ trợ:

- `create_task`
- `notify_user`
- `update_lead_status`
- `add_tag`
- `send_email`
- `send_zalo`

Engine dùng `crm_automation_rules` làm nguồn cấu hình và chống tạo lặp thông báo/công việc trong cửa sổ 12 giờ.

## Biến môi trường

Không commit giá trị thật vào GitHub.

```text
DATABASE_URL=postgresql://...
LEAD_WEBHOOK_SECRET=...
META_WEBHOOK_VERIFY_TOKEN=...
CRON_SECRET=...

# Email qua Resend
RESEND_API_KEY=...
PTM_EMAIL_FROM=PTM CRM <crm@your-domain.vn>

# Zalo / ZNS bridge của doanh nghiệp
PTM_ZALO_BRIDGE_URL=https://...
PTM_ZALO_BRIDGE_SECRET=...
PTM_ZALO_DEFAULT_TEMPLATE=crm_notification
```

## Trạng thái tích hợp

`GET /api/integrations/status`

Endpoint chỉ trả boolean readiness, không trả secret. Màn Automation trong CRM đọc endpoint này để hiển thị kênh nào đã sẵn sàng.

## Nguyên tắc vận hành

1. Website/form/bridge gửi lead về intake endpoint.
2. CRM chống trùng và lưu attribution.
3. Trigger database đưa lead mới vào bộ chia Sale 10 phút.
4. Sale nhận lead → automation tạo công việc chăm sóc.
5. Khi tới `next_follow_up_at`, automation sweep tạo cảnh báo/công việc theo rule.
6. Khi có credential, rule có thể gửi Email hoặc Zalo qua adapter server-side.
