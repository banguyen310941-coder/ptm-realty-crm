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

## Chat Fanpage / Meta Messenger

CRM có module **Chat Fanpage** ngay trong giao diện, theo mô hình inbox tập trung giống các công cụ social CRM:

- Nhận tin nhắn Messenger qua webhook Meta và lưu hội thoại trong CRM.
- Kiểm tra chữ ký `X-Hub-Signature-256` bằng Meta App Secret ở server.
- Tự nhận diện số điện thoại Việt Nam khi khách gửi trong nội dung chat.
- Tự ghép với khách hàng cũ theo SĐT; nếu chưa có thì tạo lead nguồn **Facebook**.
- Lead mới tự đi qua trigger phân Sale 10 phút hiện có, không tạo cơ chế chia khách thứ hai.
- Sale được phân khách có thể xem và trả lời hội thoại ngay trong CRM.
- Hiển thị tin chưa đọc, Sale phụ trách, trạng thái khách và cửa sổ phản hồi 24 giờ.
- Hỗ trợ nhiều Fanpage qua cấu hình `PTM_META_PAGES_JSON`.
- Chống ghi trùng bằng Meta Message ID.

Endpoint:

- `GET|POST /api/facebook/webhook` — Meta webhook verify + nhận Messenger event.
- `GET|POST /api/facebook/inbox` — danh sách hội thoại, nội dung chat, đánh dấu đã đọc.
- `POST /api/facebook/send` — gửi phản hồi Messenger từ CRM.

Biến môi trường server-side cần cấu hình trên Vercel:

- `PTM_META_APP_SECRET`
- `PTM_META_PAGE_ID` + `PTM_META_PAGE_ACCESS_TOKEN` cho một Fanpage; hoặc `PTM_META_PAGES_JSON` cho nhiều Fanpage.
- `PTM_META_GRAPH_VERSION` — mặc định `v26.0`.

Database cần chạy migration `sql/facebook-inbox-20260912.sql`. Sau đó provision hash của Meta App Secret vào `crm_integration_config` với key `meta_app_secret`, và giữ verify token webhook Meta ở key `meta_verify`. Không commit secret thật vào GitHub.

> Messenger không cung cấp tùy ý số điện thoại riêng tư của người dùng cho Page. CRM chỉ tự bắt SĐT khi khách chủ động gửi số trong hội thoại, hoặc khi dữ liệu lead/form hợp lệ đã cung cấp số qua luồng lead intake.

## Kịch bản trả lời tự động & AI đề xuất

Trong **Chat Fanpage → Kịch bản & AI**, quản lý có thể:

- Tạo kịch bản tự động theo: tin nhắn đầu tiên, từ khóa, chưa có SĐT, đã có SĐT hoặc mọi tin nhắn.
- Xếp ưu tiên và cooldown để tránh gửi trùng/spam.
- Bật/tắt/sửa/xóa kịch bản mà không sửa code.
- Dùng AI để đề xuất 3 kịch bản dựa trên mục tiêu, kịch bản hiện có và hội thoại đang chọn.
- AI **không tự bật** kịch bản; người quản lý phải chọn và lưu trước khi hệ thống có thể tự gửi.
- Tin tự động gửi thành công được ghi vào lịch sử Messenger trong CRM.
- Mỗi webhook được claim nguyên tử trước khi gửi để tránh bot trả lời trùng khi Meta retry hoặc gửi đồng thời.
- Khi Sale trả lời thủ công, bot tự tạm dừng 8 giờ; Sale có thể bật lại hoặc tạm dừng thủ công từ hồ sơ hội thoại.
- Dashboard kịch bản hiển thị số gửi thành công/lỗi 24 giờ và 7 ngày, kèm lỗi gần nhất.
- Trong từng hội thoại, Sale có nút **AI gợi ý trả lời**; AI chỉ điền bản nháp, không tự gửi.
- SĐT và email trong lịch sử chat được che trước khi gửi ngữ cảnh sang AI Gateway.

AI dùng Vercel AI Gateway. Trên Vercel có thể xác thực qua OIDC; biến `AI_GATEWAY_API_KEY` chỉ là phương án tùy chọn. Model mặc định là `openai/gpt-5.6-sol` và có thể đổi bằng `PTM_AI_MODEL`. Runtime sẽ kiểm tra danh sách model hiện có của AI Gateway và tự chọn fallback nếu model cấu hình không còn khả dụng.

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
- `GET /api/integrations/status` — readiness của lead webhook, Meta Messenger, Email, Zalo
- `POST /api/automation/event` — phát automation event từ phiên CRM hợp lệ
- `POST /api/automation/run` — sweep automation từ phiên CRM hợp lệ
- `GET|POST /api/leads/intake` — verify/nhận lead đa nguồn
- `GET|POST /api/facebook/webhook` — webhook Messenger
- `GET|POST /api/facebook/inbox` — inbox Fanpage trong CRM
- `POST /api/facebook/send` — gửi tin Messenger từ CRM

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
