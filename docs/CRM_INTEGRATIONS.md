# PTM CRM — Tích hợp Lead & Automation

## Kiến trúc bảo mật hiện tại

CRM dùng Neon Data API + các RPC `SECURITY DEFINER` cho lead intake và automation. Vercel **không cần `DATABASE_URL`** và không giữ mật khẩu Postgres.

Secret webhook được lưu trong Neon dưới dạng **SHA-256 hash**, không lưu giá trị gốc trong source code. API Vercel chỉ nhận token từ bên gửi và chuyển sang RPC Neon để kiểm tra.

## Endpoint nhận lead

Production:

`POST /api/leads/intake?source=website|facebook|tiktok|zalo|google|hotline`

Header bảo mật:

`x-ptm-webhook-secret: <WEBHOOK_SECRET>`

Có thể dùng `Authorization: Bearer <WEBHOOK_SECRET>` thay cho header trên.

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

CRM tự chuẩn hóa nguồn, chống trùng SĐT/email và ghi attribution vào `leads.profile.attribution`. Lead mới đi qua trigger phân Sale 10 phút hiện có; lead trùng chỉ bổ sung thông tin còn thiếu và attribution, không xóa lịch sử chăm sóc.

## Facebook / Meta webhook

GET `/api/leads/intake` hỗ trợ verify `hub.verify_token` + `hub.challenge`. Token verify được kiểm tra bằng hash lưu trong Neon.

Nếu Meta chỉ gửi `leadgen_id`, CRM trả HTTP 202 với `LEAD_DETAILS_REQUIRED`. Khi đó cần Meta Graph API credential/bridge để đổi `leadgen_id` thành thông tin khách đầy đủ rồi POST lại payload có SĐT.

## Automation engine

Endpoints:

- `POST /api/automation/event` — phát sự kiện từ app, yêu cầu CRM session bearer token.
- `POST /api/automation/run` — sweep follow-up đến hạn và xử lý offer lead hết hạn, yêu cầu CRM session bearer token.

RPC Neon:

- `crm_automation_event_v1`
- `crm_automation_sweep_v1`
- `crm_automation_event_internal` — helper nội bộ, đã thu hồi quyền EXECUTE từ PUBLIC.

Action nội bộ đang chạy thật:

- `create_task`
- `notify_user`
- `update_lead_status`
- `add_tag`

Email/Zalo chỉ được bật khi đã kết nối credential/provider doanh nghiệp.

Engine dùng `crm_automation_rules` làm nguồn cấu hình và chống tạo lặp task/thông báo trong cửa sổ 12 giờ.

## Cấu hình integration trong Neon

Bảng `crm_integration_config` chỉ chứa hash secret và đã thu hồi quyền truy cập trực tiếp từ PUBLIC.

Các RPC công khai chỉ trả trạng thái hoặc kết quả kiểm tra, không trả secret:

- `crm_integration_status_v1()`
- `crm_webhook_verify_v1(...)`
- `crm_lead_intake_v1(...)`

## Biến môi trường còn cần khi kết nối kênh ngoài

Không commit giá trị thật vào GitHub.

```text
# Email qua Resend (khi doanh nghiệp kết nối)
RESEND_API_KEY=...
PTM_EMAIL_FROM=PTM CRM <crm@your-domain.vn>

# Zalo / ZNS bridge của doanh nghiệp (khi kết nối)
PTM_ZALO_BRIDGE_URL=https://...
PTM_ZALO_BRIDGE_SECRET=...
PTM_ZALO_DEFAULT_TEMPLATE=crm_notification
```

`DATABASE_URL`, webhook secret và Meta verify token không còn bắt buộc trên Vercel cho luồng intake/automation lõi.

## Trạng thái tích hợp

`GET /api/integrations/status`

Endpoint chỉ trả boolean readiness, không trả secret. Màn Automation trong CRM đọc endpoint này để hiển thị kênh nào đã sẵn sàng.

## Nguyên tắc vận hành

1. Website/form/bridge gửi lead về intake endpoint.
2. RPC Neon xác thực webhook secret bằng hash.
3. CRM chống trùng và lưu attribution.
4. Trigger database đưa lead mới vào bộ chia Sale 10 phút.
5. Sale nhận lead → automation tạo công việc chăm sóc.
6. Khi tới `next_follow_up_at`, automation sweep tạo cảnh báo/công việc theo rule.
7. Khi có credential doanh nghiệp, có thể bật Email/Zalo qua adapter server-side.
