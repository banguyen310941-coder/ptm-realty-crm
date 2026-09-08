import { requireUser, canManageAll } from "@/lib/auth";
import { getDeals, getLeads, getProperties, getUsers } from "@/lib/data";
import { createDealAction, deleteDealAction } from "@/lib/actions";
import { money, dealStage, dateOnly } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const user = await requireUser();
  const [deals, leads, properties, users] = await Promise.all([
    getDeals(user), getLeads(user), getProperties(), getUsers(true)
  ]);
  const total = deals.reduce((s,x) => s + Number(x.value || 0), 0);
  const commission = deals.reduce((s,x) => s + Number(x.commission || 0), 0);

  return (
    <>
      <div className="page-title">
        <div><h1>Giao dịch</h1><p>Booking, đặt cọc, hợp đồng và hoa hồng.</p></div>
        <details className="dialog">
          <summary className="btn primary">+ Thêm giao dịch</summary>
          <div className="dialog-card">
            <div className="panel-head"><div><h2>Giao dịch mới</h2><p>Liên kết khách hàng với sản phẩm.</p></div></div>
            <form action={createDealAction} className="form-grid">
              <label>Khách hàng<select name="lead_id"><option value="">— Chọn khách —</option>{leads.map(x=><option value={x.id} key={x.id}>{x.name} · {x.phone}</option>)}</select></label>
              <label>Sản phẩm<select name="property_id"><option value="">— Chọn sản phẩm —</option>{properties.map(x=><option value={x.id} key={x.id}>{x.code} · {x.name}</option>)}</select></label>
              <label>Giá trị giao dịch<input name="value" type="number" min="0" required /></label>
              <label>Hoa hồng dự kiến<input name="commission" type="number" min="0" defaultValue="0" /></label>
              <label>Giai đoạn<select name="stage">{Object.entries(dealStage).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
              <label>Ngày giao dịch<input name="deal_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></label>
              {canManageAll(user) ? <label>Sale phụ trách<select name="owner_id" defaultValue={user.id}>{users.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label> : null}
              <label className="full">Ghi chú<textarea name="notes" /></label>
              <div className="form-actions full"><button className="btn primary">Lưu giao dịch</button></div>
            </form>
          </div>
        </details>
      </div>

      <section className="metric-grid metric-grid-3">
        <article className="metric-card"><span>Tổng giá trị</span><strong>{money(total)}</strong></article>
        <article className="metric-card"><span>Hoa hồng dự kiến</span><strong>{money(commission)}</strong></article>
        <article className="metric-card"><span>Số giao dịch</span><strong>{deals.length}</strong></article>
      </section>

      <article className="panel section-gap">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Khách hàng</th><th>Sản phẩm</th><th>Giá trị</th><th>Hoa hồng</th><th>Giai đoạn</th><th>Sale</th><th>Ngày</th><th></th></tr></thead>
            <tbody>
              {deals.map(x => (
                <tr key={x.id}>
                  <td><b>{x.lead_name || "—"}</b></td>
                  <td>{x.property_name || "—"}</td>
                  <td className="money">{money(x.value)}</td>
                  <td>{money(x.commission)}</td>
                  <td><span className="badge status-deal">{dealStage[x.stage]}</span></td>
                  <td>{x.owner_name || "—"}</td>
                  <td>{dateOnly(x.deal_date)}</td>
                  <td><form action={deleteDealAction}><input type="hidden" name="id" value={x.id}/><button className="danger-link">Xóa</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!deals.length ? <div className="empty">Chưa có giao dịch.</div> : null}
        </div>
      </article>
    </>
  );
}
