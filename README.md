# PTM Realty CRM

CRM bất động sản online cho Công ty Phúc Trường Minh.

## Stack
- Next.js App Router
- React
- Neon PostgreSQL
- Server Actions
- JWT session cookie bằng `jose`
- PBKDF2-SHA256 cho mật khẩu
- Vercel

## Phân quyền
- **Admin:** toàn quyền, quản lý tài khoản, khách hàng, sản phẩm, giao dịch, công việc.
- **Manager:** xem toàn bộ dữ liệu bán hàng, quản lý giỏ hàng và phân công.
- **Sale:** chỉ thấy khách hàng, giao dịch và công việc được giao cho mình.

## Chức năng
- Đăng nhập và session bảo mật bằng httpOnly cookie
- Dashboard doanh số/pipeline
- Quản lý lead và trạng thái chăm sóc
- Quản lý giỏ hàng bất động sản
- Quản lý booking/giao dịch/hoa hồng
- Quản lý công việc
- Quản lý tài khoản nhân viên
- Nhật ký hoạt động trong database
- Responsive desktop/mobile

## Biến môi trường
Tạo:
```env
DATABASE_URL=...
SESSION_SECRET=...
```

## Chạy local
```bash
npm install
npm run dev
```

## Production
Deploy repo này lên Vercel và cấu hình 2 biến môi trường trên cho Production/Preview.
