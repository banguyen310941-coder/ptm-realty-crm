# PTM Realty CRM

CRM bất động sản nội bộ cho Công ty Phúc Trường Minh.

## Stack
- Next.js App Router + React
- Neon PostgreSQL
- Neon Data API / PostgreSQL RPC
- Session token CRM lưu ở PostgreSQL
- PBKDF2-SHA256 cho mật khẩu
- Chạy local trước, chưa yêu cầu triển khai Vercel

## Phân quyền công ty

| Vai trò | Khách hàng | Sản phẩm | Giao dịch & tài chính | Công việc | Đội ngũ |
| --- | --- | --- | --- | --- | --- |
| **Giám đốc điều hành** | Toàn bộ, phân lead, xóa | Quản lý | Toàn bộ, xem KPI/hoa hồng | Toàn đội | Xem |
| **Admin** | Toàn bộ, phân lead, xóa | Quản lý | Toàn bộ | Toàn đội | Tạo tài khoản, đổi role, khóa/mở |
| **Marketing** | Toàn bộ, tạo/sửa lead | Chỉ xem | Xem trạng thái, ẩn số tiền/hoa hồng | Của mình | Không xem |
| **Sale** | Chỉ lead của mình | Chỉ xem | Chỉ giao dịch của mình, xem hoa hồng cá nhân | Của mình | Không xem |
| **Kế toán** | Chỉ xem toàn bộ | Chỉ xem | Toàn bộ tài chính, cập nhật hoa hồng/trạng thái | Của mình | Xem |

Backend RBAC là lớp quyết định quyền thật. Giao diện chỉ ẩn/hiện module và nút theo quyền backend trả về; không dùng việc ẩn giao diện làm cơ chế bảo mật chính.

## Điểm danh & phân lead tự động
- Giờ hành chính: **08:30 - 17:30** theo giờ Việt Nam.
- Sale chỉ nằm trong vòng nhận lead khi có ca điểm danh đang mở trong ngày.
- **Sau 17:30 không cần đăng ký làm tối.** Sale chưa check-out vẫn tiếp tục được nhận lead.
- Nhân viên ra ngoài gặp khách phải chọn chế độ **Gặp khách** và có ảnh xác thực; thiếu ảnh thì database từ chối điểm danh.
- Lead mới đi qua bộ chia tự động ở backend; giao diện không quyết định Sale nhận lead.
- Thuật toán ưu tiên Sale có ít lượt nhận lead nhất trong ca; nếu bằng nhau, ưu tiên người lâu nhất chưa được nhận lead.
- Nếu không có Sale đủ điều kiện, lead giữ trạng thái **chờ phân** thay vì giao cho người đang nghỉ.
- Heartbeat sẽ thử lấy **1 lead đang chờ mỗi khoảng 5 giây**. Khi Sale bắt đầu điểm danh, hàng chờ sẽ tự được phân dần theo cùng thuật toán chia đều.

## Quy tắc nhận lead 10 phút
- Mỗi lần hệ thống phân lead sẽ tạo một **lead offer** có hạn 10 phút.
- Sale nhận được banner nổi với tên khách, SĐT, dự án và đồng hồ đếm ngược 10:00 → 00:00.
- Sale phải bấm **Nhận khách** trong thời hạn.
- Quá 10 phút chưa nhận: offer chuyển `expired`, lead bị thu hồi và phân sang Sale tiếp theo đang điểm danh.
- Người vừa bỏ lỡ lượt được loại khỏi lần phân lại ngay tiếp theo để tránh giao lại chính người đó.
- Lịch sử offer được lưu theo từng vòng để biết lead đã giao cho ai, lúc nào, có nhận hay để hết hạn.
- CRM phát chuông Web Audio 3 nhịp và nhắc lại định kỳ cho tới khi Sale nhận khách hoặc offer hết hạn.
- Sale có nút **🔔 Bật chuông lead** để mở quyền phát âm thanh của trình duyệt. Nếu cho phép Notifications, hệ thống có thể hiện thêm thông báo hệ thống.

## Heartbeat local
Project hiện đang chạy theo hướng local-first. Neon project hiện không có `pg_cron`, vì vậy trong giai đoạn local việc kiểm tra offer hết 10 phút và giải phóng hàng chờ được thực hiện bằng heartbeat khoảng **5 giây** từ các phiên CRM đang mở.

Khi ít nhất một máy đang mở CRM, offer quá hạn được thu hồi/phân lại trong khoảng 10:00–10:05. Khi đưa production, cần gắn scheduler nền để cơ chế này chạy 24/7 ngay cả khi không có trình duyệt mở.

## Ảnh điểm danh
Ảnh gặp khách hiện được nén ở trình duyệt trong bản local. Trước production nên chuyển ảnh sang Cloudinary hoặc Neon Storage và chỉ lưu URL trong PostgreSQL để tránh database tăng dung lượng nhanh.

## Chức năng
- Đăng nhập CRM
- Dashboard doanh số / pipeline theo phạm vi quyền
- Quản lý lead và nguồn lead
- Điểm danh nhân viên và kiểm soát điều kiện nhận lead
- Phân lead tự động + xác nhận nhận khách trong 10 phút
- Chuông/thông báo lead mới cho Sale
- Quản lý giỏ hàng bất động sản
- Booking / đặt cọc / hợp đồng / hoa hồng
- Công việc và lịch chăm sóc
- Quản lý tài khoản nhân viên cho Admin
- Responsive desktop/mobile

## Chạy local

Yêu cầu Node.js LTS. Trong thư mục project:

```bash
npm install
npm run dev
```

Sau đó mở:

```text
http://localhost:3000
```

## Trạng thái triển khai

Project đang theo hướng **local-first**. Backend Neon chính đã có RBAC 5 vai trò, điểm danh, phân lead tự động, offer 10 phút, thu hồi/phân lại và hàng chờ. Chưa cần đưa lên Vercel cho tới khi giao diện, nghiệp vụ và ma trận phân quyền được duyệt hoàn chỉnh.
