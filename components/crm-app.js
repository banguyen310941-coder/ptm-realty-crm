"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@neondatabase/neon-js";
import { getPermissions, NAV_PERMISSION, roleLabel, ROLE_OPTIONS } from "@/lib/rbac";

const DB_URL = "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";
const client = createClient(DB_URL, { auth: { allowAnonymous: true } });
const SESSION_KEY = "ptm_crm_session_v3";

const nav = [
  ["dashboard", "▦", "Tổng quan"],
  ["leads", "◎", "Khách hàng"],
  ["properties", "⌂", "Sản phẩm"],
  ["deals", "₫", "Giao dịch"],
  ["tasks", "✓", "Công việc"],
  ["team", "◉", "Đội ngũ"]
];

const labels = {
  new: "Khách mới", contact: "Đã liên hệ", hot: "Quan tâm", visit: "Đi xem", deal: "Chốt cọc", lost: "Không nhu cầu",
  available: "Đang bán", reserved: "Giữ chỗ", sold: "Đã bán", locked: "Tạm khóa",
  booking: "Booking", deposit: "Đặt cọc", negotiation: "Thương lượng", contract: "Chờ ký HĐ", completed: "Hoàn tất", cancelled: "Hủy"
};

function money(v) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(v || 0));
}
function shortMoney(v) {
  v = Number(v || 0);
  return v >= 1e9 ? `${(v / 1e9).toFixed(v % 1e9 ? 1 : 0)} tỷ` : v >= 1e6 ? `${Math.round(v / 1e6)} tr` : money(v);
}
function unwrap(data) { return Array.isArray(data) ? data[0] : data; }
function missingV2(err) {
  return err?.code === "PGRST202" || /crm_api_v2|schema cache|could not find the function/i.test(err?.message || "");
}
function promptRole(current = "sale") {
  const list = ROLE_OPTIONS.map(([key, text]) => `${key} = ${text}`).join("\n");
  const value = prompt(`Chọn vai trò:\n${list}`, current);
  if (value === null) return null;
  return ROLE_OPTIONS.some(([key]) => key === value) ? value : null;
}
function chooseSale(data, currentId = "") {
  const sales = (data.users || []).filter((u) => u.role === "sale" && u.active !== false);
  if (!sales.length) return currentId || "";
  const lines = ["0. Chưa giao", ...sales.map((u, i) => `${i + 1}. ${u.name}`)].join("\n");
  const current = sales.findIndex((u) => u.id === currentId);
  const answer = prompt(`Giao lead cho Sale nào?\n${lines}`, current >= 0 ? String(current + 1) : "0");
  if (answer === null) return currentId || "";
  const index = Number(answer);
  return index > 0 && sales[index - 1] ? sales[index - 1].id : "";
}

export default function CRMApp() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState({ email: "admin@ptm.vn", password: "" });

  const permissions = getPermissions(data || { user: session?.user });
  const visibleNav = nav.filter(([id]) => permissions[NAV_PERMISSION[id]] !== false);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        setSession(s);
        load(s.token);
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (data && !visibleNav.some(([id]) => id === view)) setView("dashboard");
  }, [data, view]);

  async function rpc(action, payload = {}, token = session?.token) {
    let response = await client.rpc("crm_api_v2", { p_token: token || "", p_action: action, p_payload: payload });
    if (response.error && missingV2(response.error)) {
      response = await client.rpc("crm_api", { p_token: token || "", p_action: action, p_payload: payload });
    }
    if (response.error) throw new Error(response.error.message || "Không kết nối được CRM");
    const out = unwrap(response.data);
    if (!out?.ok) throw new Error(out?.error || "Thao tác thất bại");
    return out;
  }

  async function load(token = session?.token) {
    if (!token) return;
    setBusy(true); setError("");
    try {
      const out = await rpc("bootstrap", {}, token);
      setData(out);
    } catch (e) {
      setError(e.message);
      if (/hết hạn|UNAUTHENTICATED/i.test(e.message)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null); setData(null);
      }
    } finally { setBusy(false); }
  }

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const { data: res, error: err } = await client.rpc("crm_login", { p_email: login.email, p_password: login.password });
      if (err) throw new Error(err.message || "Không thể đăng nhập");
      const out = unwrap(res);
      if (!out?.ok) throw new Error(out?.error || "Email hoặc mật khẩu không đúng");
      const s = { token: out.token, user: out.user };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      await load(out.token);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await rpc("logout"); } catch {}
    localStorage.removeItem(SESSION_KEY);
    setSession(null); setData(null); setView("dashboard");
  }

  async function mutate(action, payload) {
    setBusy(true); setError("");
    try { await rpc(action, payload); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!session) return <Login login={login} setLogin={setLogin} signIn={signIn} busy={busy} error={error} />;
  if (!data) return <div className="center-screen"><div><b>PTM Realty CRM</b><p>{error || "Đang tải dữ liệu..."}</p><button className="btn primary" onClick={() => load()}>Tải lại</button></div></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">PTM</div><div><strong>Phúc Trường Minh</strong><span>Realty CRM</span></div></div>
      <nav>{visibleNav.map(([id, ic, tx]) => <button key={id} className={`nav-item nav-btn ${view === id ? "active" : ""}`} onClick={() => setView(id)}><span>{ic}</span>{tx}</button>)}</nav>
      <div className="sidebar-footer">
        <div className="user-card"><div className="avatar">{data.user.name.slice(0, 2).toUpperCase()}</div><div><strong>{data.user.name}</strong><span>{roleLabel(data.user.role)}</span></div></div>
        <button className="logout" onClick={signOut}>Đăng xuất</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">CRM nội bộ</span><strong>{nav.find((x) => x[0] === view)?.[2]}</strong></div><div className="top-user"><span>{busy ? "Đang đồng bộ…" : roleLabel(data.user.role)}</span><button className="btn ghost" onClick={() => load()}>↻ Làm mới</button></div></header>
      {error && <div className="global-alert">{error}</div>}
      <section className="page-wrap">
        {view === "dashboard" && <Dashboard data={data} permissions={permissions} />}
        {view === "leads" && <Leads data={data} permissions={permissions} mutate={mutate} />}
        {view === "properties" && <Properties data={data} permissions={permissions} mutate={mutate} />}
        {view === "deals" && <Deals data={data} permissions={permissions} mutate={mutate} />}
        {view === "tasks" && <Tasks data={data} permissions={permissions} mutate={mutate} />}
        {view === "team" && <Team data={data} permissions={permissions} mutate={mutate} />}
      </section>
    </main>
  </div>;
}

function Login({ login, setLogin, signIn, busy, error }) {
  return <main className="login-shell"><section className="login-brand"><div className="brand-badge">PTM</div><h1>Phúc Trường Minh</h1><p>Realty CRM</p><div className="login-points"><span>Phân quyền theo chức vụ</span><span>Quản lý khách hàng & pipeline</span><span>Giao dịch, hoa hồng & công việc</span></div></section><section className="login-card"><div><span className="eyebrow">CRM nội bộ</span><h2>Đăng nhập</h2><p>Quyền truy cập được kiểm tra theo tài khoản nhân viên.</p></div><form className="form-stack" onSubmit={signIn}><label>Email<input type="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} required /></label><label>Mật khẩu<input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} required autoFocus /></label>{error && <div className="alert">{error}</div>}<button className="btn primary wide" disabled={busy}>{busy ? "Đang đăng nhập..." : "Đăng nhập"}</button></form><small>Giám đốc · Admin · Marketing · Sale · Kế toán</small></section></main>;
}

function Dashboard({ data, permissions }) {
  const leads = data.leads || [], deals = data.deals || [], tasks = data.tasks || [];
  const pipeline = leads.filter((x) => ["hot", "visit", "deal"].includes(x.status)).reduce((s, x) => s + Number(x.budget || 0), 0);
  const commission = deals.reduce((s, x) => s + Number(x.commission || 0), 0);
  const active = leads.filter((x) => x.status !== "lost").length;
  const hot = leads.filter((x) => ["hot", "visit", "deal"].includes(x.status)).length;
  return <><div className="page-title"><div><h1>Tổng quan</h1><p>Dữ liệu hiển thị theo quyền của {roleLabel(data.user.role)}.</p></div></div>
    <div className="metric-grid">
      <Metric n={active} t="Khách đang chăm sóc" />
      <Metric n={leads.length} t="Tổng khách hàng" />
      {permissions.finance_view ? <><Metric n={shortMoney(pipeline)} t="Giá trị cơ hội" /><Metric n={shortMoney(commission)} t="Hoa hồng dự kiến" /></> : <><Metric n={hot} t="Lead tiềm năng" /><Metric n={deals.length} t="Giao dịch chuyển đổi" /></>}
    </div>
    <div className="two-col section-gap"><div className="panel"><div className="panel-head"><div><h2>Khách hàng gần đây</h2><p>5 lead cập nhật mới nhất</p></div></div><LeadTable rows={leads.slice(0, 5)} /></div><div className="panel"><div className="panel-head"><div><h2>Công việc</h2><p>{tasks.filter((x) => !x.done).length} việc chưa hoàn tất</p></div></div>{tasks.slice(0, 5).map((t) => <div className={`task-mini ${t.done ? "done" : ""}`} key={t.id}><b>{t.title}</b><span>{t.owner_name || "Chưa giao"}</span></div>)}</div></div>
  </>;
}
function Metric({ n, t }) { return <div className="metric-card"><span>{t}</span><strong>{n}</strong><em>Theo quyền truy cập</em></div>; }

function Leads({ data, permissions, mutate }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => (data.leads || []).filter((x) => !q || `${x.name} ${x.phone} ${x.project || ""}`.toLowerCase().includes(q.toLowerCase())), [data.leads, q]);
  async function edit(x = {}) {
    if (x.id && !permissions.leads_update) return;
    if (!x.id && !permissions.leads_create) return;
    const name = prompt("Họ tên", x.name || ""); if (!name) return;
    const phone = prompt("Số điện thoại", x.phone || ""); if (!phone) return;
    const project = prompt("Dự án quan tâm", x.project || "") || "";
    const budget = prompt("Ngân sách (VND)", x.budget || 0) || 0;
    const status = prompt("Trạng thái: new/contact/hot/visit/deal/lost", x.status || "new") || "new";
    let owner_id = data.user.role === "sale" ? data.user.id : (x.owner_id || "");
    if (permissions.leads_assign) owner_id = chooseSale(data, owner_id);
    await mutate("save_lead", { ...x, name, phone, project, budget: String(budget), status, owner_id, source: x.source || "Khác", email: x.email || "", need: x.need || "", notes: x.notes || "" });
  }
  const canAct = permissions.leads_update || permissions.leads_delete;
  return <><div className="page-title"><div><h1>Khách hàng</h1><p>{permissions.leads_scope === "own" ? "Chỉ khách hàng được giao cho bạn." : "Danh sách khách hàng theo phạm vi được cấp."}</p></div>{permissions.leads_create && <button className="btn primary" onClick={() => edit()}>+ Thêm khách</button>}</div><div className="panel"><div className="filters"><input placeholder="Tìm tên, SĐT, dự án..." value={q} onChange={(e) => setQ(e.target.value)} /></div><LeadTable rows={rows} actions={canAct ? (x) => <span className="row-actions">{permissions.leads_update && <button onClick={() => edit(x)}>Sửa</button>}{permissions.leads_delete && <button className="danger-link" onClick={() => confirm("Xóa khách này?") && mutate("delete_lead", { id: x.id })}>Xóa</button>}</span> : null} /></div></>;
}
function LeadTable({ rows, actions }) { return <div className="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Nguồn</th><th>Dự án</th><th>Ngân sách</th><th>Trạng thái</th><th>Sale</th>{actions && <th />}</tr></thead><tbody>{rows.map((x) => <tr key={x.id}><td><b>{x.name}</b><small>{x.phone}</small></td><td>{x.source}</td><td>{x.project || "—"}</td><td className="money">{shortMoney(x.budget)}</td><td><span className={`badge status-${x.status}`}>{labels[x.status] || x.status}</span></td><td>{x.owner_name || "Chưa giao"}</td>{actions && <td>{actions(x)}</td>}</tr>)}</tbody></table></div>; }

function Properties({ data, permissions, mutate }) {
  async function edit(x = {}) {
    if (!permissions.properties_manage) return;
    const name = prompt("Tên sản phẩm", x.name || ""); if (!name) return;
    const code = prompt("Mã căn", x.code || ""); if (!code) return;
    const project = prompt("Dự án", x.project || ""); if (!project) return;
    const price = prompt("Giá bán", x.price || 0) || 0;
    const area = prompt("Diện tích m²", x.area || 0) || 0;
    const status = prompt("available/reserved/sold/locked", x.status || "available") || "available";
    await mutate("save_property", { ...x, name, code, project, price: String(price), area: String(area), bedrooms: String(x.bedrooms || 0), status, property_type: x.property_type || "Căn hộ", notes: x.notes || "" });
  }
  return <><div className="page-title"><div><h1>Sản phẩm BĐS</h1><p>{permissions.properties_manage ? "Bạn có quyền quản lý giỏ hàng." : "Giỏ hàng ở chế độ chỉ xem."}</p></div>{permissions.properties_manage && <button className="btn primary" onClick={() => edit()}>+ Thêm sản phẩm</button>}</div><div className="property-grid">{(data.properties || []).map((x) => <div className="property-card" key={x.id}><div className="property-visual">⌂ <em><span className={`badge property-${x.status}`}>{labels[x.status] || x.status}</span></em></div><div className="property-body"><small>{x.code}</small><h2>{x.name}</h2><p>{x.project} · {x.area} m² · {x.bedrooms} PN</p><strong className="property-price">{money(x.price)}</strong>{permissions.properties_manage && <div className="row-actions property-actions"><button onClick={() => edit(x)}>Sửa</button><button className="danger-link" onClick={() => confirm("Xóa sản phẩm?") && mutate("delete_property", { id: x.id })}>Xóa</button></div>}</div></div>)}</div></>;
}

function Deals({ data, permissions, mutate }) {
  async function add() {
    if (!permissions.deals_create) return;
    if (!data.leads.length || !data.properties.length) return alert("Cần có khách hàng và sản phẩm trước.");
    const lead = data.leads[0], prop = data.properties[0];
    const value = prompt(`Giá trị giao dịch cho ${lead.name} / ${prop.name}`, prop.price || 0); if (value === null) return;
    const commission = prompt("Hoa hồng dự kiến", 0) || 0;
    const owner_id = data.user.role === "sale" ? data.user.id : (chooseSale(data, "") || data.user.id);
    await mutate("save_deal", { lead_id: lead.id, property_id: prop.id, value: String(value), commission: String(commission), stage: "booking", owner_id, deal_date: new Date().toISOString().slice(0, 10), notes: "" });
  }
  async function edit(x) {
    if (!permissions.deals_update) return;
    const stage = prompt("Giai đoạn: booking/deposit/negotiation/contract/completed/cancelled", x.stage || "booking"); if (!stage) return;
    let value = x.value ?? "", commission = x.commission ?? "";
    if (permissions.finance_view) {
      value = prompt("Giá trị giao dịch", x.value ?? 0); if (value === null) return;
      commission = prompt("Hoa hồng", x.commission ?? 0); if (commission === null) return;
    }
    const notes = prompt("Ghi chú", x.notes || ""); if (notes === null) return;
    await mutate("save_deal", { ...x, value: String(value ?? ""), commission: String(commission ?? ""), stage, notes, owner_id: x.owner_id || data.user.id, deal_date: x.deal_date || new Date().toISOString().slice(0, 10) });
  }
  const canAct = permissions.deals_update || permissions.deals_delete;
  return <><div className="page-title"><div><h1>Giao dịch</h1><p>{permissions.finance_view ? "Booking, đặt cọc, hợp đồng và hoa hồng." : "Marketing chỉ xem trạng thái chuyển đổi, số tiền được ẩn."}</p></div>{permissions.deals_create && <button className="btn primary" onClick={add}>+ Giao dịch</button>}</div><div className="panel"><div className="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Sản phẩm</th><th>Giá trị</th><th>Hoa hồng</th><th>Giai đoạn</th><th>Sale</th>{canAct && <th />}</tr></thead><tbody>{(data.deals || []).map((x) => <tr key={x.id}><td>{x.lead_name || "—"}</td><td>{x.property_name || "—"}</td><td className="money">{permissions.finance_view ? money(x.value) : "Ẩn theo quyền"}</td><td>{permissions.finance_view ? money(x.commission) : "Ẩn theo quyền"}</td><td><span className="badge">{labels[x.stage] || x.stage}</span></td><td>{x.owner_name || "—"}</td>{canAct && <td><span className="row-actions">{permissions.deals_update && <button onClick={() => edit(x)}>Sửa</button>}{permissions.deals_delete && <button className="danger-link" onClick={() => confirm("Xóa giao dịch?") && mutate("delete_deal", { id: x.id })}>Xóa</button>}</span></td>}</tr>)}</tbody></table></div></div></>;
}

function Tasks({ data, permissions, mutate }) {
  async function add() {
    if (!permissions.tasks_create) return;
    const title = prompt("Nội dung công việc"); if (!title) return;
    const due = prompt("Thời hạn ISO, ví dụ 2026-09-08T15:00:00+07:00", new Date(Date.now() + 3600000).toISOString()) || "";
    await mutate("save_task", { title, task_type: "call", due_at: due, owner_id: data.user.id, lead_id: "", priority: "normal" });
  }
  return <><div className="page-title"><div><h1>Công việc</h1><p>{permissions.tasks_scope === "own" ? "Bạn chỉ thao tác trên công việc của mình." : "Bạn có thể theo dõi công việc toàn đội."}</p></div>{permissions.tasks_create && <button className="btn primary" onClick={add}>+ Công việc</button>}</div><div className="panel task-panel">{(data.tasks || []).map((t) => <div className={`task-row ${t.done ? "done" : ""}`} key={t.id}>{permissions.tasks_update ? <button className="task-check" onClick={() => mutate("toggle_task", { id: t.id })}>{t.done ? "✓" : ""}</button> : <span /> }<div><strong>{t.title}</strong><span>{t.lead_name || "Không gắn khách"}</span></div><span className={`badge priority-${t.priority}`}>{t.priority}</span><span>{t.owner_name || "—"}</span>{permissions.tasks_delete ? <button className="danger-link" onClick={() => confirm("Xóa công việc?") && mutate("delete_task", { id: t.id })}>×</button> : <span />}</div>)}</div></>;
}

function Team({ data, permissions, mutate }) {
  const backendUserAdmin = data.permissions?.users_manage === true;
  async function saveUser(u = {}) {
    if (!backendUserAdmin) return;
    const name = prompt("Họ tên nhân viên", u.name || ""); if (!u.id && !name) return;
    const email = prompt(u.id ? "Email mới (để trống nếu giữ nguyên)" : "Email đăng nhập", u.email || ""); if (!u.id && !email) return;
    const role = promptRole(u.role || "sale"); if (!role) return;
    const password = prompt(u.id ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu ban đầu - tối thiểu 8 ký tự", ""); if (password === null) return;
    await mutate("save_user", { id: u.id || "", name: name || "", email: email || "", role, password });
  }
  return <><div className="page-title"><div><h1>Đội ngũ & phân quyền</h1><p>Vai trò hiện tại: {roleLabel(data.user.role)}.</p></div>{backendUserAdmin && <button className="btn primary" onClick={() => saveUser()}>+ Tạo tài khoản</button>}</div>
    <div className="panel"><div className="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th>{backendUserAdmin && <th />}</tr></thead><tbody>{(data.users || []).map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td>{u.email || "—"}</td><td><span className={`role role-${u.role}`}>{roleLabel(u.role)}</span></td><td>{u.active === false ? "Đã khóa" : "Hoạt động"}</td>{backendUserAdmin && <td><span className="row-actions"><button onClick={() => saveUser(u)}>Sửa quyền</button>{u.id !== data.user.id && <button className="danger-link" onClick={() => mutate("toggle_user", { id: u.id })}>{u.active === false ? "Mở khóa" : "Khóa"}</button>}</span></td>}</tr>)}</tbody></table></div>{permissions.users_manage && !backendUserAdmin && <div className="alert section-gap">Backend RBAC chưa được kích hoạt trên database chính nên quản lý tài khoản đang ở chế độ chỉ xem.</div>}</div>
    <PermissionGuide />
  </>;
}

function PermissionGuide() {
  return <div className="panel permission-note section-gap"><h2>Ma trận quyền đề xuất</h2><div className="permission-grid">
    <div><b>Giám đốc điều hành</b><span>Xem và điều hành toàn bộ kinh doanh, KPI, tài chính, phân lead và giỏ hàng.</span></div>
    <div><b>Admin</b><span>Quản trị tài khoản, vai trò, khóa/mở nhân viên và toàn bộ dữ liệu hệ thống.</span></div>
    <div><b>Marketing</b><span>Tạo và phân lead, theo dõi nguồn/chuyển đổi; không xem giá trị giao dịch và hoa hồng.</span></div>
    <div><b>Sale</b><span>Chỉ khách hàng, giao dịch, công việc của mình; được xem giỏ hàng và hoa hồng cá nhân.</span></div>
    <div><b>Kế toán</b><span>Xem tài chính toàn bộ giao dịch, cập nhật hoa hồng/trạng thái; không xóa dữ liệu kinh doanh.</span></div>
  </div></div>;
}
