# PTM Enterprise CRM Roadmap

Mục tiêu: xây dựng CRM điều hành bất động sản toàn diện cho Phúc Trường Minh, theo mô hình module của các CRM doanh nghiệp như Getfly nhưng tối ưu riêng cho bất động sản và quy trình phân lead của PTM.

## Phase 1 — CRM Core (đã code, database đang chờ áp dụng)

- Customer 360°: hồ sơ khách, lead score, custom profile, lịch sử chăm sóc, lịch hẹn tiếp theo
- Tags & segmentation: nhãn/phân nhóm khách hàng
- Opportunity pipeline: Kanban từ Đánh giá → Tư vấn → Đi xem → Booking → Cọc → Hợp đồng → Thành công/Thất bại
- Marketing campaigns: kênh, ngân sách, UTM, mục tiêu lead, conversion
- Ticket CSKH + SLA
- KPI realtime: lead, hoạt động, cuộc hẹn, đi xem dự án, cơ hội, doanh số, công việc
- Executive reports: Sales / Marketing / CSKH
- Automation rules: lưu trữ kịch bản sự kiện → hành động
- Notification center
- Giữ nguyên hệ thống điểm danh + phân lead 10 phút + chuông thông báo
- RBAC: CEO / Admin / Marketing / Sale / Kế toán

## Phase 2 — Automation & Omnichannel

- Automation engine thực thi 24/7
- Facebook Lead Ads → CRM tự động
- Zalo OA / ZNS
- Email Marketing
- SMS
- Web form / Landing form → CRM
- Webhook / API nhận lead từ website, đối tác, portal
- Call center integration và lịch sử cuộc gọi
- Lead scoring tự động theo hành vi
- Duplicate detection / merge khách hàng

## Phase 3 — Real Estate Operations

- Dự án → block/tòa → tầng → căn → chính sách giá
- Giỏ hàng realtime, giữ chỗ/lock căn
- Booking, đặt cọc, hợp đồng, thanh toán theo đợt
- Hồ sơ & tài liệu khách hàng
- Công nợ, doanh thu, hoa hồng nhiều cấp
- Chính sách thưởng Sale / team / cộng tác viên
- Approval workflow cho chiết khấu và booking

## Phase 4 — Management & HRM

- Phòng ban, sơ đồ tổ chức
- Chấm công GPS/IP, nghỉ phép
- KPI cá nhân/phòng ban
- Workstream / thông báo nội bộ
- Audit log quản trị
- Dashboard CEO tùy chỉnh

## Phase 5 — Mobile & AI

- PWA/mobile-first
- Push notification
- Trợ lý AI tóm tắt Customer 360°
- AI gợi ý khách cần chăm sóc hôm nay
- AI chấm điểm lead
- AI soạn tin nhắn/email theo lịch sử khách
- AI báo cáo ngày/tuần cho Giám đốc

## Nguyên tắc kỹ thuật

- PostgreSQL/Neon là nguồn dữ liệu trung tâm.
- Browser không có quyền SELECT/UPDATE trực tiếp trên bảng nghiệp vụ mở rộng; mọi thao tác đi qua RPC có RBAC.
- Sale chỉ thao tác dữ liệu được phân cho mình.
- Marketing không nhận dữ liệu tài chính nhạy cảm qua API.
- Các thao tác quan trọng có lịch sử/audit.
- Module được tách riêng để có thể thay đổi/triển khai độc lập.
