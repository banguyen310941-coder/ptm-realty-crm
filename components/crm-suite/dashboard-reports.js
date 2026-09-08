"use client";

import { compactMoney, money } from "@/lib/crm-client";

const LEAD_STAGES = [
  ["new", "Khách mới"],
  ["contact", "Đã liên hệ"],
  ["hot", "Quan tâm"],
  ["visit", "Đi xem"],
  ["deal", "Chốt cọc"],
  ["lost", "Mất"]
];

const OPPORTUNITY_STAGES = [
  ["qualify", "Đánh giá"],
  ["consult", "Tư vấn"],
  ["visit", "Đi xem"],
  ["booking", "Booking"],
  ["deposit", "Đặt cọc"],
  ["contract", "Hợp đồng"],
  ["won", "Thành công"],
  ["lost", "Thất bại"]
];

function Metric({ label, value, note }) {
  return <div className="suite-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function ExecutiveDashboard({ data, full, permissions }) {
  const leads = data.leads || [];
  const deals = data.deals || [];
  const tasks = data.tasks || [];
  const opportunities = full.opportunities || [];
  const activities = full.activities || [];
  const tickets = full.tickets || [];
  const openOpp = opportunities.filter((o) => o.status === "open");
  const pipeline = openOpp.reduce((sum, o) => sum + Number(o.value || 0), 0);
  const weighted = openOpp.reduce((sum, o) => sum + Number(o.value || 0) * Number(o.probability || 0) / 100, 0);
  const won = opportunities.filter((o) => o.status === "won").length;
  const conversion = leads.length ? Math.round((won / leads.length) * 100) : 0;
  const today = new Date().toDateString();
  const todayActivities = activities.filter((a) => new Date(a.happened_at).toDateString() === today).length;
  const overdue = tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < new Date()).length;
  const urgentTickets = tickets.filter((t) => ["open", "processing"].includes(t.status) && t.priority === "urgent").length;

  return <div className="suite-page">
    <div className="suite-page-head"><div><h1>Trung tâm điều hành</h1><p>Toàn cảnh khách hàng, pipeline, hoạt động và chất lượng chăm sóc theo thời gian thực.</p></div><span className="suite-live">● Dữ liệu trực tiếp</span></div>
    <div className="suite-metric-grid">
      <Metric label="Khách hàng" value={leads.length} note={`${leads.filter((l) => l.status !== "lost").length} đang chăm sóc`} />
      <Metric label="Cơ hội đang mở" value={openOpp.length} note={permissions.finance_view ? compactMoney(pipeline) : "Giá trị được ẩn theo quyền"} />
      <Metric label="Tỷ lệ chuyển đổi" value={`${conversion}%`} note={`${won} cơ hội thành công`} />
      <Metric label="Hoạt động hôm nay" value={todayActivities} note={`${overdue} việc quá hạn`} />
      {permissions.finance_view && <Metric label="Pipeline trọng số" value={compactMoney(weighted)} note="Giá trị × xác suất" />}
      <Metric label="Ticket khẩn" value={urgentTickets} note={`${tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length} ticket đang mở`} />
    </div>

    <div className="suite-grid suite-grid-2 section-gap">
      <section className="suite-panel"><div className="suite-panel-head"><div><h2>Phễu khách hàng</h2><p>Tỷ trọng khách theo từng trạng thái</p></div></div><div className="suite-funnel">{LEAD_STAGES.map(([key, label]) => {
        const count = leads.filter((l) => l.status === key).length;
        const width = leads.length ? Math.max(5, Math.round(count / leads.length * 100)) : 5;
        return <div className="suite-bar-row" key={key}><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><b>{count}</b></div>;
      })}</div></section>
      <section className="suite-panel"><div className="suite-panel-head"><div><h2>Pipeline cơ hội</h2><p>Số cơ hội theo giai đoạn bán hàng</p></div></div><div className="suite-funnel">{OPPORTUNITY_STAGES.map(([key, label]) => {
        const count = opportunities.filter((o) => o.stage === key).length;
        const max = Math.max(1, ...OPPORTUNITY_STAGES.map(([s]) => opportunities.filter((o) => o.stage === s).length));
        return <div className="suite-bar-row" key={key}><span>{label}</span><div><i style={{ width: `${Math.max(5, Math.round(count / max * 100))}%` }} /></div><b>{count}</b></div>;
      })}</div></section>
    </div>

    <div className="suite-grid suite-grid-2 section-gap">
      <SourcePerformance leads={leads} />
      <ActivityFeed rows={activities.slice(0, 8)} />
    </div>
  </div>;
}

function SourcePerformance({ leads }) {
  const map = leads.reduce((acc, l) => {
    const key = l.source || "Khác";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return <section className="suite-panel"><div className="suite-panel-head"><div><h2>Hiệu quả nguồn lead</h2><p>Dữ liệu đầu vào theo kênh</p></div></div><div className="suite-funnel">{rows.length ? rows.map(([name, count]) => <div className="suite-bar-row" key={name}><span>{name}</span><div><i style={{ width: `${Math.round(count / max * 100)}%` }} /></div><b>{count}</b></div>) : <div className="suite-empty">Chưa có dữ liệu nguồn.</div>}</div></section>;
}

function ActivityFeed({ rows }) {
  const type = { call: "☎", meeting: "◫", message: "✉", email: "@", note: "✎", site_visit: "⌂", status_change: "↻", other: "•" };
  return <section className="suite-panel"><div className="suite-panel-head"><div><h2>Dòng hoạt động</h2><p>Tương tác khách hàng mới nhất</p></div></div><div className="suite-feed">{rows.length ? rows.map((a) => <div key={a.id} className="suite-feed-item"><span>{type[a.activity_type] || "•"}</span><div><b>{a.lead_name || "Khách hàng"}</b><p>{a.subject || a.content || a.activity_type}</p><small>{a.user_name || "Hệ thống"} · {new Date(a.happened_at).toLocaleString("vi-VN")}</small></div></div>) : <div className="suite-empty">Chưa có lịch sử tương tác.</div>}</div></section>;
}

export function ReportsModule({ data, full, permissions }) {
  const leads = data.leads || [];
  const opportunities = full.opportunities || [];
  const campaigns = full.campaigns || [];
  const deals = data.deals || [];
  const bySale = (data.users || []).filter((u) => u.role === "sale").map((u) => {
    const saleLeads = leads.filter((l) => l.owner_id === u.id);
    const saleOpp = opportunities.filter((o) => o.owner_id === u.id);
    return {
      id: u.id,
      name: u.name,
      leads: saleLeads.length,
      open: saleOpp.filter((o) => o.status === "open").length,
      won: saleOpp.filter((o) => o.status === "won").length,
      value: saleOpp.filter((o) => o.status === "won").reduce((s, o) => s + Number(o.value || 0), 0)
    };
  });

  return <div className="suite-page"><div className="suite-page-head"><div><h1>Báo cáo quản trị</h1><p>Báo cáo Sales, Marketing và CSKH trên cùng một nguồn dữ liệu.</p></div></div>
    <div className="suite-grid suite-grid-3">
      <section className="suite-panel"><h2>Khách hàng</h2><strong className="suite-big-number">{leads.length}</strong><p>{leads.filter((l) => l.status === "deal").length} khách đã chốt cọc</p></section>
      <section className="suite-panel"><h2>Marketing</h2><strong className="suite-big-number">{campaigns.length}</strong><p>{campaigns.filter((c) => c.status === "active").length} chiến dịch đang chạy</p></section>
      <section className="suite-panel"><h2>Giao dịch</h2><strong className="suite-big-number">{deals.length}</strong><p>{permissions.finance_view ? money(deals.reduce((s, d) => s + Number(d.value || 0), 0)) : "Giá trị ẩn theo quyền"}</p></section>
    </div>
    <section className="suite-panel section-gap"><div className="suite-panel-head"><div><h2>Hiệu suất Sales</h2><p>Từ lead → cơ hội → thành công</p></div></div><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Nhân viên</th><th>Lead</th><th>Cơ hội mở</th><th>Thành công</th><th>Tỷ lệ</th>{permissions.finance_view && <th>Giá trị thắng</th>}</tr></thead><tbody>{bySale.map((r) => <tr key={r.id}><td><b>{r.name}</b></td><td>{r.leads}</td><td>{r.open}</td><td>{r.won}</td><td>{r.leads ? Math.round(r.won / r.leads * 100) : 0}%</td>{permissions.finance_view && <td>{money(r.value)}</td>}</tr>)}</tbody></table></div></section>
    <section className="suite-panel section-gap"><div className="suite-panel-head"><div><h2>Hiệu quả chiến dịch</h2><p>Lead tham gia và tỷ lệ chuyển đổi</p></div></div><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Chiến dịch</th><th>Kênh</th><th>Trạng thái</th><th>Lead</th><th>Chuyển đổi</th><th>Tỷ lệ</th></tr></thead><tbody>{campaigns.map((c) => <tr key={c.id}><td><b>{c.name}</b></td><td>{c.channel}</td><td>{c.status}</td><td>{c.member_count || 0}</td><td>{c.converted_count || 0}</td><td>{Number(c.member_count) ? Math.round(Number(c.converted_count || 0) / Number(c.member_count) * 100) : 0}%</td></tr>)}</tbody></table></div></section>
  </div>;
}
