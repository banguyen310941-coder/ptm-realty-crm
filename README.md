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
| **Marketing** | Toàn bộ, tạo/sửa/phân lead | Chỉ xem | Xem trạng thái, ẩn số tiền/hoa hồng | Của mình | Không xem |
| **Sale** | Chỉ lead của mình | Chỉ xem | Chỉ giao dịch của mình, xem hoa hồng cá nhân | Của mình | Không xem |
| **Kế toán** | Chỉ xem toàn bộ | Chỉ xem | Toàn bộ tài chính, cập nhật hoa hồng/trạng thái | Của mình | Xem |

Backend RBAC là lớp quyết định quyền thật. Giao diện chỉ ẩn/hiện module và nút theo quyền backend trả về; không dùng việc ẩn giao diện làm cơ chế bảo mật chính.

## Điểm danh & phân lead tự động
- Giờ hành chính: **08:30 - 17:30** theo giờ Việt Nam.
- Trong giờ hành chính, lead công ty được chia đều cho các Sale đang có ca điểm danh hợp lệ.
- Thuật toán ưu tiên người có ít lead nhất trong ca; nếu bằng nhau, ưu tiên người lâu nhất chưa nhận lead.
- Ngoài giờ hành chính, chỉ Sale đang điểm danh và bật **làm buổi tối** mới được đưa vào nhóm nhận lead; trong nhóm này vẫn chia đều.
- Nếu không có Sale đủ điều kiện, lead giữ trạng thái **chờ phân** thay vì giao cho người đang nghỉ.
- Nhân viên ra ngoài gặp khách phải chọn chế độ **Gặp khách** và có ảnh xác thực; thiếu ảnh thì database từ chối điểm danh.
- Ảnh được nén ở trình duyệt trong bản local. Trước production nên chuyển ảnh sang Cloudinary/Neon Storage và chỉ lưu URL trong PostgreSQL.
- Giám đốc/Admin có bảng theo dõi ai đang điểm danh, ai làm tối và Sale nào đang đủ điều kiện nhận lead.

## Chức năng
- Đăng nhập CRM
- Dashboard doanh số / pipeline theo phạm vi quyền
- Quản lý lead, nguồn lead và phân lead cho Sale
- Điểm danh nhân viên và kiểm soát điều kiện nhận lead
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

Project đang theo hướng **local-first**. Chưa cần đưa lên Vercel cho tới khi giao diện, nghiệp vụ và ma trận phân quyền được duyệt hoàn chỉnh.
