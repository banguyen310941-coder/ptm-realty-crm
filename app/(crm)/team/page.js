import { requireUser, canManageAll, isAdmin } from "@/lib/auth";
import { getUsers } from "@/lib/data";
import { createUserAction, toggleUserAction } from "@/lib/actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requireUser();
  if (!canManageAll(user)) redirect("/dashboard");
  const users = await getUsers(false);

  return (
    <>
      <div className="page-title">
        <div><h1>Đội ngũ</h1><p>Quản lý tài khoản và phân quyền truy cập CRM.</p></div>
        {isAdmin(user) ? (
          <details className="dialog">
            <summary className="btn primary">+ Thêm nhân viên</summary>
            <div className="dialog-card">
              <div className="panel-head"><div><h2>Tài khoản mới</h2><p>Admin, Trưởng phòng hoặc Sale.</p></div></div>
              <form action={createUserAction} className="form-grid">
                <label>Họ tên<input name="name" required /></label>
                <label>Email<input name="email" type="email" required /></label>
                <label>Mật khẩu ban đầu<input name="password" type="password" minLength="8" required /></label>
                <label>Vai trò<select name="role"><option value="sale">Sale</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
                <div className="form-actions full"><button className="btn primary">Tạo tài khoản</button></div>
              </form>
            </div>
          </details>
        ) : null}
      </div>

      <article className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nhân sự</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {users.map(x => (
                <tr key={x.id}>
                  <td><b>{x.name}</b></td>
                  <td>{x.email}</td>
                  <td><span className={`role role-${x.role}`}>{x.role}</span></td>
                  <td><span className={`badge ${x.active ? "status-deal" : ""}`}>{x.active ? "Đang hoạt động" : "Đã khóa"}</span></td>
                  <td>
                    {isAdmin(user) && x.id !== user.id ? (
                      <form action={toggleUserAction}><input type="hidden" name="id" value={x.id}/><button className="text-link">{x.active ? "Khóa" : "Mở khóa"}</button></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel section-gap permission-note">
        <h2>Phân quyền</h2>
        <div className="permission-grid">
          <div><b>Admin</b><span>Toàn quyền, quản lý tài khoản, dữ liệu và giỏ hàng.</span></div>
          <div><b>Manager</b><span>Xem toàn bộ khách, giao dịch; quản lý giỏ hàng và phân công.</span></div>
          <div><b>Sale</b><span>Chỉ thấy khách, giao dịch và công việc được giao cho mình.</span></div>
        </div>
      </article>
    </>
  );
}
