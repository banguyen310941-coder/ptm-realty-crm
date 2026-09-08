import { requireUser, canManageAll } from "@/lib/auth";
import { getLeads, getUsers } from "@/lib/data";
import { createLeadAction, updateLeadAction, deleteLeadAction } from "@/lib/actions";
import { leadStatus, shortMoney, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function LeadForm({ users, user, lead, action }) {
  return (
    <form action={action} className="form-grid">
      {lead ? <input type="hidden" name="id" value={lead.id} /> : null}
      <label>Họ tên<input name="name" required defaultValue={lead?.name || ""} /></label>
      <label>Số điện thoại<input name="phone" required defaultValue={lead?.phone || ""} /></label>
      <label>Email<input name="email" type="email" defaultValue={lead?.email || ""} /></label>
      <label>Nguồn khách
        <select name="source" defaultValue={lead?.source || "Facebook"}>
          {["Facebook","TikTok","Website","Zalo","Giới thiệu","Sàn","Khác"].map(x => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>Nhu cầu<input name="need" defaultValue={lead?.need || ""} placeholder="Căn hộ 2PN, đầu tư..." /></label>
      <label>Ngân sách (VND)<input name="budget" type="number" min="0" defaultValue={lead?.budget || 0} /></label>
      <label>Dự án quan tâm<input name="project" defaultValue={lead?.project || ""} /></label>
      <label>Trạng thái
        <select name="status" defaultValue={lead?.status || "new"}>
          {Object.entries(leadStatus).map(([k,v]) => <option value={k} key={k}>{v}</option>)}
        </select>
      </label>
      {canManageAll(user) ? (
        <label>Sale phụ trách
          <select name="owner_id" defaultValue={lead?.owner_id || user.id}>
            {users.map(x => <option value={x.id} key={x.id}>{x.name} · {x.role}</option>)}
          </select>
        </label>
      ) : null}
      <label className="full">Ghi chú<textarea name="notes" defaultValue={lead?.notes || ""} /></label>
      <div className="form-actions full"><button className="btn primary">{lead ? "Lưu thay đổi" : "Thêm khách hàng"}</button></div>
    </form>
  );
}

export default async function LeadsPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = String(sp?.q || "").trim();
  const status = String(sp?.status || "").trim();
  const [leads, users] = await Promise.all([getLeads(user, q, status), getUsers(true)]);

  return (
    <>
      <div className="page-title">
        <div><h1>Khách hàng</h1><p>{leads.length} khách hàng phù hợp bộ lọc hiện tại.</p></div>
        <details className="dialog">
          <summary className="btn primary">+ Thêm khách hàng</summary>
          <div className="dialog-card">
            <div className="panel-head"><div><h2>Khách hàng mới</h2><p>Thông tin lead và nhu cầu.</p></div></div>
            <LeadForm users={users} user={user} action={createLeadAction} />
          </div>
        </details>
      </div>

      <article className="panel">
        <form className="filters">
          <input name="q" defaultValue={q} placeholder="Tìm tên, SĐT, dự án, nhu cầu..." />
          <select name="status" defaultValue={status}>
            <option value="">Tất cả trạng thái</option>
            {Object.entries(leadStatus).map(([k,v]) => <option value={k} key={k}>{v}</option>)}
          </select>
          <button className="btn secondary">Lọc</button>
          <a href="/leads" className="btn ghost">Xóa lọc</a>
        </form>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Khách hàng</th><th>Nhu cầu</th><th>Ngân sách</th><th>Trạng thái</th><th>Sale</th><th>Cập nhật</th><th></th></tr></thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id}>
                  <td><b>{lead.name}</b><small>{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</small></td>
                  <td>{lead.need || "—"}<small>{lead.project || lead.source}</small></td>
                  <td className="money">{shortMoney(lead.budget)}</td>
                  <td><span className={`badge status-${lead.status}`}>{leadStatus[lead.status]}</span></td>
                  <td>{lead.owner_name || "—"}</td>
                  <td>{dateTime(lead.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <details className="dialog">
                        <summary>Sửa</summary>
                        <div className="dialog-card">
                          <div className="panel-head"><div><h2>Cập nhật khách hàng</h2><p>{lead.name}</p></div></div>
                          <LeadForm users={users} user={user} lead={lead} action={updateLeadAction} />
                        </div>
                      </details>
                      {canManageAll(user) ? (
                        <form action={deleteLeadAction}>
                          <input type="hidden" name="id" value={lead.id} />
                          <button className="danger-link">Xóa</button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!leads.length ? <div className="empty">Không tìm thấy khách hàng.</div> : null}
        </div>
      </article>
    </>
  );
}
