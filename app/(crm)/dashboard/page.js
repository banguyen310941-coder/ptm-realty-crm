import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDashboard } from "@/lib/data";
import { shortMoney, leadStatus } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboard(user);
  const maxSource = Math.max(1, ...data.sources.map(x => x.count));

  return (
    <>
      <div className="page-title">
        <div><h1>Tổng quan</h1><p>Xin chào {user.name}. Đây là tình hình kinh doanh hiện tại.</p></div>
      </div>

      <section className="metric-grid">
        <article className="metric-card"><span>Khách đang chăm sóc</span><strong>{data.leads.active}</strong><em>{data.leads.new_count} khách mới</em></article>
        <article className="metric-card"><span>Giá trị pipeline</span><strong>{shortMoney(data.leads.pipeline)}</strong><em>Nhóm khách quan tâm trở lên</em></article>
        <article className="metric-card"><span>Giá trị giao dịch</span><strong>{shortMoney(data.deals.value)}</strong><em>{data.deals.total} giao dịch</em></article>
        <article className="metric-card"><span>Hoa hồng dự kiến</span><strong>{shortMoney(data.deals.commission)}</strong><em>{data.tasks.open} việc cần xử lý</em></article>
      </section>

      <section className="two-col section-gap">
        <article className="panel">
          <div className="panel-head"><div><h2>Khách cần chăm sóc</h2><p>Cập nhật gần nhất</p></div><Link className="text-link" href="/leads">Xem tất cả →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Khách hàng</th><th>Nhu cầu</th><th>Ngân sách</th><th>Trạng thái</th><th>Sale</th></tr></thead>
              <tbody>
                {data.recentLeads.map(x => (
                  <tr key={x.id}>
                    <td><b>{x.name}</b><small>{x.phone}</small></td>
                    <td>{x.need || "—"}<small>{x.project || ""}</small></td>
                    <td className="money">{shortMoney(x.budget)}</td>
                    <td><span className={`badge status-${x.status}`}>{leadStatus[x.status]}</span></td>
                    <td>{x.owner_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head"><div><h2>Nguồn khách hàng</h2><p>Phân bổ lead hiện tại</p></div></div>
          <div className="source-list">
            {data.sources.length ? data.sources.map(x => (
              <div className="source-row" key={x.source}>
                <span>{x.source}</span>
                <div className="bar-track"><i style={{width:`${Math.max(7,(x.count/maxSource)*100)}%`}} /></div>
                <b>{x.count}</b>
              </div>
            )) : <div className="empty">Chưa có dữ liệu.</div>}
          </div>
          <div className="task-summary">
            <div><strong>{data.tasks.open}</strong><span>Chưa hoàn tất</span></div>
            <div><strong>{data.tasks.done}</strong><span>Đã hoàn tất</span></div>
          </div>
        </article>
      </section>
    </>
  );
}
