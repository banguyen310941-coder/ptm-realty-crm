"use client";

import { useMemo, useState } from "react";
import { compactMoney, fmtDate, money } from "@/lib/crm-client";
import { roleLabel, ROLE_OPTIONS } from "@/lib/rbac";

export function TicketsModule({ data, full, fullMutate }) {
  const tickets = full.tickets || [];
  const canCreate = ["admin", "ceo", "manager", "sale", "marketing"].includes(data.user.role);
  async function save(t = {}) {
    const subject = prompt("Tiêu đề yêu cầu hỗ trợ", t.subject || ""); if (!subject) return;
    const lead = t.lead_id ? (data.leads || []).find((l) => l.id === t.lead_id) : choose(data.leads || [], "Chọn khách hàng", true);
    const priority = prompt("Mức độ: low/normal/high/urgent", t.priority || "normal") || "normal";
    const status = prompt("Trạng thái: open/processing/waiting_customer/resolved/closed", t.status || "open") || "open";
    const description = prompt("Mô tả", t.description || ""); if (description === null) return;
    const resolution = t.id ? prompt("Hướng xử lý / kết quả", t.resolution || "") : ""; if (resolution === null) return;
    const sla = prompt("Hạn SLA ISO (để trống nếu chưa đặt)", t.sla_due_at || "") || "";
    await fullMutate("ticket.save", { ...t, lead_id: lead?.id || "", subject, priority, status, category: t.category || "support", description, resolution, sla_due_at: sla, assigned_to: t.assigned_to || data.user.id });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Ticket chăm sóc khách hàng</h1><p>Ghi nhận khiếu nại, yêu cầu hỗ trợ và SLA để không bỏ sót khách sau bán.</p></div>{canCreate && <button className="suite-btn primary" onClick={() => save()}>+ Ticket</button>}</div>
    <div className="suite-ticket-board">{["open","processing","waiting_customer","resolved","closed"].map((status) => <section className="suite-ticket-col" key={status}><header><b>{ticketStatus(status)}</b><span>{tickets.filter((t) => t.status === status).length}</span></header>{tickets.filter((t) => t.status === status).map((t) => <article key={t.id} onClick={() => save(t)}><div><b>{t.code}</b><span className={`suite-priority priority-${t.priority}`}>{t.priority}</span></div><h3>{t.subject}</h3><p>{t.lead_name || "Không gắn khách"}</p><small>Phụ trách: {t.assigned_name || "—"}</small><footer><span>SLA {fmtDate(t.sla_due_at, true)}</span></footer></article>)}</section>)}</div>
  </div>;
}

function ticketStatus(v) {
  return ({ open: "Mới", processing: "Đang xử lý", waiting_customer: "Chờ khách", resolved: "Đã xử lý", closed: "Đóng" })[v] || v;
}

export function TasksModule({ data, coreMutate }) {
  const tasks = data.tasks || [];
  async function add() {
    const title = prompt("Nội dung công việc"); if (!title) return;
    const type = prompt("Loại: call/meeting/followup/admin", "followup") || "followup";
    const due = prompt("Thời hạn ISO", new Date(Date.now() + 3600000).toISOString()) || "";
    const priority = prompt("Ưu tiên: low/normal/high", "normal") || "normal";
    await coreMutate("save_task", { title, task_type: type, due_at: due, owner_id: data.user.id, lead_id: "", priority });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Công việc</h1><p>Giao việc, deadline và tiến độ cá nhân/phòng ban.</p></div><button className="suite-btn primary" onClick={add}>+ Công việc</button></div><section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Hoàn tất</th><th>Công việc</th><th>Loại</th><th>Deadline</th><th>Ưu tiên</th><th>Phụ trách</th><th /></tr></thead><tbody>{tasks.map((t) => <tr key={t.id}><td><button className={`suite-check ${t.done ? "done" : ""}`} onClick={() => coreMutate("toggle_task", { id: t.id })}>{t.done ? "✓" : ""}</button></td><td><b>{t.title}</b><small>{t.lead_name || ""}</small></td><td>{t.task_type}</td><td>{fmtDate(t.due_at, true)}</td><td><span className={`suite-priority priority-${t.priority}`}>{t.priority}</span></td><td>{t.owner_name || "—"}</td><td><button className="suite-link danger" onClick={() => confirm("Xóa công việc?") && coreMutate("delete_task", { id: t.id })}>Xóa</button></td></tr>)}</tbody></table></div></section></div>;
}

export function CalendarModule({ data, full }) {
  const items = useMemo(() => {
    const taskItems = (data.tasks || []).filter((t) => t.due_at && !t.done).map((t) => ({ id: `task-${t.id}`, at: t.due_at, type: "Công việc", title: t.title, person: t.lead_name || t.owner_name }));
    const followups = (full.lead_meta || []).filter((m) => m.next_follow_up_at).map((m) => {
      const l = (data.leads || []).find((x) => x.id === m.id);
      return { id: `follow-${m.id}`, at: m.next_follow_up_at, type: "Chăm sóc", title: l?.name || "Khách hàng", person: l?.phone };
    });
    const activityNext = (full.activities || []).filter((a) => a.next_action_at).map((a) => ({ id: `activity-${a.id}`, at: a.next_action_at, type: "Hẹn tiếp", title: a.lead_name, person: a.subject }));
    return [...taskItems, ...followups, ...activityNext].filter((x) => new Date(x.at) >= new Date(Date.now() - 86400000)).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, 100);
  }, [data.tasks, data.leads, full.lead_meta, full.activities]);
  const grouped = items.reduce((acc, item) => {
    const day = new Date(item.at).toLocaleDateString("vi-VN");
    (acc[day] ||= []).push(item); return acc;
  }, {});
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Lịch hẹn & chăm sóc</h1><p>Tổng hợp deadline, lịch chăm sóc và lịch hẹn khách hàng.</p></div></div><div className="suite-calendar">{Object.keys(grouped).length ? Object.entries(grouped).map(([day, rows]) => <section className="suite-panel" key={day}><div className="suite-calendar-day"><b>{day}</b><span>{rows.length} lịch</span></div>{rows.map((x) => <div className="suite-calendar-item" key={x.id}><time>{new Date(x.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</time><span className="suite-status">{x.type}</span><div><b>{x.title}</b><small>{x.person || ""}</small></div></div>)}</section>) : <div className="suite-panel suite-empty suite-empty-large">Chưa có lịch sắp tới.</div>}</div></div>;
}

export function PropertiesModule({ data, permissions, coreMutate }) {
  async function save(p = {}) {
    if (!permissions.properties_manage) return;
    const name = prompt("Tên sản phẩm", p.name || ""); if (!name) return;
    const code = prompt("Mã căn/sản phẩm", p.code || ""); if (!code) return;
    const project = prompt("Dự án", p.project || ""); if (!project) return;
    const type = prompt("Loại sản phẩm", p.property_type || "Căn hộ") || "Căn hộ";
    const price = prompt("Giá bán", p.price || 0); if (price === null) return;
    const area = prompt("Diện tích", p.area || 0) || 0;
    const bedrooms = prompt("Số phòng ngủ", p.bedrooms || 0) || 0;
    const status = prompt("available/reserved/sold/locked", p.status || "available") || "available";
    await coreMutate("save_property", { ...p, name, code, project, property_type: type, price, area, bedrooms, status, notes: p.notes || "" });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Dự án & giỏ hàng</h1><p>Quản lý căn, trạng thái giữ chỗ, giá bán và tồn kho dự án.</p></div>{permissions.properties_manage && <button className="suite-btn primary" onClick={() => save()}>+ Sản phẩm</button>}</div><div className="suite-property-grid">{(data.properties || []).map((p) => <article className="suite-property-card" key={p.id}><div className="suite-property-visual"><span>⌂</span><em className={`suite-status status-${p.status}`}>{p.status}</em></div><div><small>{p.project} · {p.code}</small><h2>{p.name}</h2><p>{p.property_type} · {p.area} m² · {p.bedrooms} PN</p><strong>{money(p.price)}</strong>{permissions.properties_manage && <footer><button onClick={() => save(p)}>Sửa</button><button className="danger" onClick={() => confirm("Xóa sản phẩm?") && coreMutate("delete_property", { id: p.id })}>Xóa</button></footer>}</div></article>)}</div></div>;
}

export function DealsModule({ data, permissions, coreMutate }) {
  const deals = data.deals || [];
  async function add() {
    if (!permissions.deals_create) return;
    const lead = choose(data.leads || [], "Chọn khách"); if (!lead) return;
    const property = choose(data.properties || [], "Chọn sản phẩm"); if (!property) return;
    const value = prompt("Giá trị giao dịch", property.price || 0); if (value === null) return;
    const commission = prompt("Hoa hồng dự kiến", "0") || "0";
    await coreMutate("save_deal", { lead_id: lead.id, property_id: property.id, value, commission, stage: "booking", owner_id: lead.owner_id || data.user.id, deal_date: new Date().toISOString().slice(0, 10), notes: "" });
  }
  async function edit(d) {
    if (!permissions.deals_update) return;
    const stage = prompt("booking/deposit/negotiation/contract/completed/cancelled", d.stage); if (!stage) return;
    const value = permissions.finance_view ? prompt("Giá trị giao dịch", d.value || 0) : d.value;
    if (permissions.finance_view && value === null) return;
    const commission = permissions.finance_view ? prompt("Hoa hồng", d.commission || 0) : d.commission;
    if (permissions.finance_view && commission === null) return;
    const notes = prompt("Ghi chú", d.notes || ""); if (notes === null) return;
    await coreMutate("save_deal", { ...d, stage, value, commission, notes, owner_id: d.owner_id || data.user.id, deal_date: d.deal_date || new Date().toISOString().slice(0, 10) });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Booking · Cọc · Hợp đồng</h1><p>Quản lý toàn bộ giao dịch, doanh thu và hoa hồng bất động sản.</p></div>{permissions.deals_create && <button className="suite-btn primary" onClick={add}>+ Giao dịch</button>}</div><section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Khách hàng</th><th>Sản phẩm</th><th>Giai đoạn</th><th>Sale</th>{permissions.finance_view && <><th>Giá trị</th><th>Hoa hồng</th></>}<th /></tr></thead><tbody>{deals.map((d) => <tr key={d.id}><td><b>{d.lead_name}</b></td><td>{d.property_name}</td><td><span className="suite-status">{d.stage}</span></td><td>{d.owner_name || "—"}</td>{permissions.finance_view && <><td>{money(d.value)}</td><td>{money(d.commission)}</td></>}<td>{permissions.deals_update && <button className="suite-link" onClick={() => edit(d)}>Sửa</button>} {permissions.deals_delete && <button className="suite-link danger" onClick={() => confirm("Xóa giao dịch?") && coreMutate("delete_deal", { id: d.id })}>Xóa</button>}</td></tr>)}</tbody></table></div></section></div>;
}

const KPI_METRICS = {
  new_leads: "Lead mới", activities: "Lượt chăm sóc", meetings: "Cuộc hẹn", visits: "Đi xem dự án", opportunities: "Cơ hội tạo mới", won_opportunities: "Cơ hội thành công", revenue: "Doanh số", tasks_done: "Công việc hoàn tất"
};

export function KpiModule({ data, full, fullMutate }) {
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const canSet = ["admin", "ceo", "manager"].includes(data.user.role);
  const targets = full.kpis || [];
  const sales = (data.users || []).filter((u) => u.role === "sale" && u.active !== false);
  function actual(userId, metric) {
    const monthKey = new Date().toISOString().slice(0, 7);
    if (metric === "new_leads") return (data.leads || []).filter((l) => (!userId || l.owner_id === userId) && String(l.created_at || "").startsWith(monthKey)).length;
    if (metric === "activities") return (full.activities || []).filter((a) => (!userId || a.user_id === userId) && String(a.happened_at || "").startsWith(monthKey)).length;
    if (metric === "meetings") return (full.activities || []).filter((a) => (!userId || a.user_id === userId) && a.activity_type === "meeting" && String(a.happened_at || "").startsWith(monthKey)).length;
    if (metric === "visits") return (full.activities || []).filter((a) => (!userId || a.user_id === userId) && a.activity_type === "site_visit" && String(a.happened_at || "").startsWith(monthKey)).length;
    if (metric === "opportunities") return (full.opportunities || []).filter((o) => (!userId || o.owner_id === userId) && String(o.created_at || "").startsWith(monthKey)).length;
    if (metric === "won_opportunities") return (full.opportunities || []).filter((o) => (!userId || o.owner_id === userId) && o.status === "won" && String(o.updated_at || "").startsWith(monthKey)).length;
    if (metric === "revenue") return (data.deals || []).filter((d) => (!userId || d.owner_id === userId) && d.stage === "completed" && String(d.deal_date || "").startsWith(monthKey)).reduce((s, d) => s + Number(d.value || 0), 0);
    if (metric === "tasks_done") return (data.tasks || []).filter((t) => (!userId || t.owner_id === userId) && t.done).length;
    return 0;
  }
  async function setTarget(user) {
    const metric = prompt(`Chỉ số KPI:\n${Object.entries(KPI_METRICS).map(([k,v]) => `${k} = ${v}`).join("\n")}`, "new_leads"); if (!metric || !KPI_METRICS[metric]) return;
    const target = prompt(`Mục tiêu ${KPI_METRICS[metric]} tháng này`, "10"); if (target === null) return;
    await fullMutate("kpi.save", { user_id: user.id, period_month: month, metric_key: metric, target_value: target, weight: 1 });
  }
  const displayUsers = sales.length ? sales : [data.user];
  return <div className="suite-page"><div className="suite-page-head"><div><h1>KPI realtime</h1><p>Mục tiêu cá nhân được đối chiếu tự động với hoạt động phát sinh trong CRM.</p></div></div><div className="suite-kpi-grid">{displayUsers.map((u) => {
    const rows = targets.filter((k) => k.user_id === u.id && String(k.period_month).startsWith(new Date().toISOString().slice(0,7)));
    return <section className="suite-panel suite-kpi-card" key={u.id}><header><div className="suite-avatar">{u.name.slice(0,2).toUpperCase()}</div><div><b>{u.name}</b><span>{roleLabel(u.role)}</span></div>{canSet && <button className="text-link" onClick={() => setTarget(u)}>+ KPI</button>}</header>{rows.length ? rows.map((k) => { const a = actual(u.id, k.metric_key); const target = Number(k.target_value || 0); const pct = target ? Math.min(150, Math.round(a / target * 100)) : 0; return <div className="suite-kpi-line" key={k.id}><div><b>{KPI_METRICS[k.metric_key] || k.metric_key}</b><span>{k.metric_key === "revenue" ? `${compactMoney(a)} / ${compactMoney(target)}` : `${a} / ${target}`}</span></div><div className="suite-progress"><i style={{ width: `${Math.min(100,pct)}%` }} /></div><strong>{pct}%</strong></div>; }) : <div className="suite-empty">Chưa thiết lập KPI tháng này.</div>}</section>;
  })}</div></div>;
}

export function TeamModule({ data, permissions, coreMutate }) {
  const users = data.users || [];
  const canManage = data.permissions?.users_manage === true;
  async function save(u = {}) {
    if (!canManage) return;
    const name = prompt("Họ tên", u.name || ""); if (!u.id && !name) return;
    const email = prompt(u.id ? "Email (để trống giữ nguyên)" : "Email đăng nhập", u.email || ""); if (!u.id && !email) return;
    const role = prompt(`Vai trò:\n${ROLE_OPTIONS.map(([k,v]) => `${k} = ${v}`).join("\n")}`, u.role || "sale"); if (!role) return;
    const password = prompt(u.id ? "Mật khẩu mới (để trống không đổi)" : "Mật khẩu ban đầu", ""); if (password === null) return;
    await coreMutate("save_user", { id: u.id || "", name: name || "", email: email || "", role, password });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Đội ngũ & phân quyền</h1><p>Quản lý tài khoản nhân viên và quyền theo vai trò.</p></div>{canManage && <button className="suite-btn primary" onClick={() => save()}>+ Nhân viên</button>}</div><section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Nhân viên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th /></tr></thead><tbody>{users.map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email || "—"}</td><td><span className={`role role-${u.role}`}>{roleLabel(u.role)}</span></td><td>{u.active === false ? "Đã khóa" : "Hoạt động"}</td><td>{canManage && <><button className="suite-link" onClick={() => save(u)}>Sửa</button> {u.id !== data.user.id && <button className="suite-link danger" onClick={() => coreMutate("toggle_user", { id: u.id })}>{u.active === false ? "Mở khóa" : "Khóa"}</button>}</>}</td></tr>)}</tbody></table></div></section></div>;
}

function choose(rows, title, allowEmpty = false) {
  if (!rows.length) return null;
  const text = rows.slice(0, 50).map((x, i) => `${i + 1}. ${x.name}${x.phone ? ` · ${x.phone}` : ""}`).join("\n");
  const raw = prompt(`${title}:\n${text}`, allowEmpty ? "" : "1");
  if (raw === null || (allowEmpty && raw === "")) return null;
  return rows[Number(raw) - 1] || null;
}
