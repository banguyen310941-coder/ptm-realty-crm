# PTM Realty CRM

CRM bất động sản nội bộ cho Công ty Phúc Trường Minh, đang chạy production trên Vercel và dùng Neon làm backend dữ liệu.

## Production

- App: `https://ptm-realty-crm.vercel.app`
- Frontend/API: Next.js App Router trên Vercel
- Database: Neon PostgreSQL
- Kết nối ứng dụng: Neon Data API + PostgreSQL RPC
- Auth CRM: session token lưu trong PostgreSQL
- Backend nghiệp vụ nhạy cảm: PostgreSQL `SECURITY DEFINER` RPC
- Múi giờ nghiệp vụ: Việt Nam (`Asia/Ho_Chi_Minh`)

Core production **không cần `DATABASE_URL` trên Vercel**. Các route server gọi RPC qua Neon Data API, giúp tránh đưa mật khẩu PostgreSQL vào runtime ứng dụng.

## Luồng kinh doanh chính

`Lead → Phân Sale → Khách hàng 360° → Nhu cầu → Gợi ý mộ phần → Cơ hội → Giữ chỗ/Cọc → Hợp đồng → Thanh toán/Hoa hồng → CSKH`

### Khách hàng 360°

Một hồ sơ khách tập trung các phần:

- Tổng quan và điểm tiềm năng
- Nhu cầu, ngân sách, khu/hướng/loại mộ
- Lịch sử chăm sóc và lịch tiếp theo
- Mộ phần quan tâm và gợi ý phù hợp
- Cơ hội, giao dịch và công việc
- Hợp đồng, thanh toán và công nợ
- Ticket CSKH

### Phân lead 10 phút

- Lead mới được đưa vào cơ chế phân Sale ở backend.
- Sale đủ điều kiện nhận lead sẽ nhận một `lead offer` có hạn 10 phút.
- Sale phải bấm **Nhận khách** trong thời hạn.
- Quá hạn, offer được thu hồi và hệ thống thử chuyển sang Sale tiếp theo phù hợp.
- Lịch sử offer được lưu để truy vết ai nhận, ai bỏ lỡ và thời điểm xử lý.

### Lead đa nguồn

Endpoint production:

`POST /api/leads/intake?source=website|facebook|tiktok|zalo|google|hotline`

CRM hỗ trợ:

- Website/form
- Facebook/Meta
- TikTok
- Zalo
- Google
- Hotline
- Chuẩn hóa nguồn và attribution
- Chống trùng theo số điện thoại/email
- Giữ lịch sử khách cũ khi lead trùng quay lại
- Facebook/Meta webhook verification

Webhook secret và Meta verify token chỉ được lưu dạng **SHA-256 hash trong Neon**, không commit secret thật vào GitHub.

## Automation

Automation được cấu hình từ `crm_automation_rules` và chạy qua RPC bảo mật.

Các event hiện hỗ trợ:

- `lead_created`
- `lead_assigned`
- `lead_accepted`
- `lead_status_changed`
- `followup_due`
- `opportunity_stage_changed`
- `ticket_created`
- `deal_completed`

Các action nội bộ đang hỗ trợ:

- Tạo công việc
- Tạo thông báo CRM
- Đổi trạng thái khách
- Gắn nhãn khách

Hệ thống có chống tạo lặp công việc/thông báo trong cửa sổ 12 giờ.

Email và Zalo/ZNS là kênh mở rộng, chỉ bật khi có credential doanh nghiệp tương ứng.

## Dashboard CEO

Dashboard quản lý tập trung các chỉ số và cảnh báo quan trọng:

- Khách nóng
- Lead chưa phân Sale
- Việc quá hạn
- Ticket khẩn
- Công nợ
- Pipeline
- Sales leaderboard
- Chuyển đổi theo nguồn
- Rủi ro chăm sóc/SLA

## Phân quyền

| Vai trò | Phạm vi chính |
| --- | --- |
| CEO/Giám đốc | Toàn bộ dữ liệu, báo cáo, duyệt/xóa nghiệp vụ quan trọng |
| Admin | Quản trị dữ liệu và tài khoản |
| Marketing | Lead, nguồn khách, chiến dịch, báo cáo marketing |
| Sale | Khách được giao, công việc, cơ hội và giao dịch của mình |
| Kế toán | Hợp đồng, thanh toán, công nợ, hoa hồng |

Quyền thật được kiểm tra ở backend/RPC; việc ẩn nút trên giao diện không được dùng làm lớp bảo mật duy nhất.

## Giỏ mộ phần Thiên Phúc

Kho mộ phần là dữ liệu sản phẩm thật và được giữ tách biệt với dữ liệu demo. Customer 360 có thể tìm/gợi ý sản phẩm phù hợp và tạo bước giữ chỗ từ hồ sơ khách.

## API kiểm tra vận hành

- `GET /api/health` — database/auth readiness
- `GET /api/integrations/status` — readiness của lead webhook, Meta, Email, Zalo
- `POST /api/automation/event` — phát automation event từ phiên CRM hợp lệ
- `POST /api/automation/run` — sweep automation từ phiên CRM hợp lệ
- `GET|POST /api/leads/intake` — verify/nhận lead đa nguồn

## SQL versioned

Các thay đổi backend quan trọng được lưu trong thư mục `sql/`.

Đặc biệt:

- `sql/lead-offer-10-minute-routing.sql`
- `sql/attendance-auto-lead-trigger.sql`
- `sql/finance-workflow-v2.sql`
- `sql/integration-automation-rpc-v1.sql`

File integration/automation **không chứa secret thật**. Secret production phải được provision riêng và chỉ lưu hash.

## Legacy routes

Các URL giao diện cũ như `/dashboard`, `/leads`, `/properties`, `/deals`, `/tasks`, `/team` đã được khóa ở layout và chuyển về CRM chính tại `/`. Điều này tránh chạy lại kiến trúc server cũ phụ thuộc PostgreSQL connection string.

## Chạy local

```bash
npm install
npm run dev
```

Sau đó mở `http://localhost:3000`.

Phần giao diện CRM chính dùng Neon Data API giống production. Không thêm mật khẩu PostgreSQL vào source hoặc file Git-tracked.

## Quy tắc bảo mật

1. Không commit connection string, API key, access token hoặc webhook secret.
2. Ưu tiên RPC `SECURITY DEFINER` có kiểm tra session/quyền cho nghiệp vụ nhạy cảm.
3. Webhook secret chỉ lưu hash.
4. Không xóa hoặc thay đổi dữ liệu sản phẩm thật khi xử lý dữ liệu demo.
5. Mọi thay đổi production phải qua build/CI trước khi deploy.
