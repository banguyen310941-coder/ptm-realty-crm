"use client";

import { useEffect, useMemo, useState } from "react";
import { SESSION_KEY, coreRpc, fullRpc, loginRpc } from "@/lib/crm-client";
import { getPermissions, roleLabel } from "@/lib/rbac";
import { ExecutiveDashboard, ReportsModule } from "@/components/crm-suite/dashboard-reports";
import { CustomersModule } from "@/components/crm-suite/customers";
import { OpportunitiesModule, MarketingModule, AutomationModule } from "@/components/crm-suite/sales-marketing";
import { TicketsModule, TasksModule, CalendarModule, PropertiesModule, DealsModule, KpiModule, TeamModule } from "@/components/crm-suite/operations";

const EMPTY_FULL = { lead_meta: [], tags: [], lead_tags: [], activities: [], opportunities: [], campaigns: [], tickets: [], kpis: [], automations: [], notifications: [] };

const NAV = [
  { id: "dashboard", icon: "▦", label: "Tổng quan", group: "CRM" },
  { id: "customers", icon: "◎", label: "Khách hàng 360°", group: "CRM" },
  { id: "opportunities", icon: "◇", label: "Cơ hội & Pipeline", group: "CRM" },
  { id: "marketing", icon: "◈", label: "Marketing", group: "Tăng trưởng" },
  { id: "tasks", icon: "✓", label: "Công việc", group: "Vận hành" },
  { id: "calendar", icon: "□", label: "Lịch hẹn", group: "Vận hành" },
  { id: "tickets", icon: "◉", label: "Ticket CSKH", group: "Vận hành" },
  { id: "properties", icon: "⌂", label: "Dự án & giỏ hàng", group: "Bất động sản" },
  { id: "deals", icon: "₫", label: "Giao dịch", group: "Bất động sản" },
  { id: "kpi", icon: "▲", label: "KPI", group: "Quản trị" },
  { id: "reports", icon: "▥", label: "Báo cáo", group: "Quản trị" },
  { id: "automation", icon: "⚡", label: "Automation", group: "Quản trị" },
  { id: "team", icon: "♟", label: "Đội ngũ", group: "Quản trị" }
];

function allowed(item, data, permissions) {
  const role = data?.user?.role;
  if (item.id === "customers") return permissions.leads_view !== false;
  if (item.id === "opportunities") return permissions.deals_view !== false;
  if (item.id === "marketing") return ["admin", "ceo", "manager", "marketing"].includes(role);
  if (item.id === "tasks" || item.id === "calendar") return permissions.tasks_view !== false;
  if (item.id === "tickets") return ["admin", "ceo", "manager", "marketing", "sale"].includes(role);
  if (item.id === "properties") return permissions.properties_view !== false;
  if (item.id === "deals") return permissions.deals_view !== false;
  if (item.id === "automation") return ["admin", "ceo", "manager", "marketing"].includes(role);
  if (item.id === "team") return permissions.team_view !== false;
  return true;
}

export default function FullCRMApp() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [full, setFull] = useState(EMPTY_FULL);
  const [fullReady, setFullReady] = useState(true);
  const [view, setView] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState({ email: "admin@ptm.vn", password: "" });
  const [noticeOpen, setNoticeOpen] = useState(false);

  const permissions = getPermissions(data || { user: session?.user });
  const visibleNav = useMemo(() => NAV.filter((n) => data ? allowed(n, data, permissions) : true), [data, permissions]);
  const unread = (full.notifications || []).filter((n) => !n.read_at).length;

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      setSession(s);
      load(s.token);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    const refresh = () => session?.token && load(session.token, true);
    window.addEventListener("ptm-crm-refresh", refresh);
    return () => window.removeEventListener("ptm-crm-refresh", refresh);
  }, [session?.token]);

  useEffect(() => {
    if (data && !visibleNav.some((n) => n.id === view)) setView("dashboard");
  }, [data, visibleNav, view]);

  async function load(token = session?.token, quiet = false) {
    if (!token) return;
    if (!quiet) setBusy(true);
    setError("");
    try {
      const core = await coreRpc(token, "bootstrap", {});
      setData(core);
      try {
        const extended = await fullRpc(token, "bootstrap", {});
        setFull({ ...EMPTY_FULL, ...extended });
        setFullReady(true);
      } catch (e) {
        if (e.code === "FULL_CRM_NOT_READY" || /chưa được kích hoạt/i.test(e.message)) {
          setFull(EMPTY_FULL);
          setFullReady(false);
        } else throw e;
      }
    } catch (e) {
      setError(e.message);
      if (/hết hạn|UNAUTHENTICATED/i.test(e.message)) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null); setData(null); setFull(EMPTY_FULL);
      }
    } finally { if (!quiet) setBusy(false); }
  }

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const out = await loginRpc(login.email, login.password);
      const s = { token: out.token, user: out.user };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      await load(out.token);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await coreRpc(session?.token, "logout", {}); } catch {}
    localStorage.removeItem(SESSION_KEY);
    setSession(null); setData(null); setFull(EMPTY_FULL); setView("dashboard");
  }

  async function coreMutate(action, payload = {}) {
    setBusy(true); setError("");
    try { await coreRpc(session?.token, action, payload); await load(session?.token, true); }
    catch (e) { setError(e.message); throw e; }
    finally { setBusy(false); }
  }

  async function fullMutate(action, payload = {}) {
    setBusy(true); setError("");
    try { await fullRpc(session?.token, action, payload); await load(session?.token, true); }
    catch (e) { setError(e.message); throw e; }
    finally { setBusy(false); }
  }

  async function readNotification(n) {
    if (n.read_at || !fullReady) return;
    try { await fullRpc(session?.token, "notification.read", { id: n.id }); await load(session?.token, true); } catch {}
  }

  if (!session) return <LoginScreen login={login} setLogin={setLogin} signIn={signIn} busy={busy} error={error} />;
  if (!data) return <div className="suite-loading"><div className="brand-mark">PTM</div><b>PTM Realty CRM</b><p>{error || "Đang tải dữ liệu doanh nghiệp..."}</p><button className="suite-btn primary" onClick={() => load()}>Tải lại</button></div>;

  const groups = [...new Set(visibleNav.map((n) => n.group))];
  return <div className="suite-shell">
    <aside className="suite-sidebar">
      <div className="suite-brand"><div className="brand-mark">PTM</div><div><b>Phúc Trường Minh</b><span>Enterprise CRM</span></div></div>
      <div className="suite-menu">{groups.map((group) => <div key={group} className="suite-menu-group"><small>{group}</small>{visibleNav.filter((n) => n.group === group).map((n) => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}><i>{n.icon}</i><span>{n.label}</span></button>)}</div>)}</div>
      <div className="suite-sidebar-user"><div className="suite-avatar">{data.user.name.slice(0, 2).toUpperCase()}</div><div><b>{data.user.name}</b><span>{roleLabel(data.user.role)}</span></div><button onClick={signOut}>↪</button></div>
    </aside>

    <main className="suite-main">
      <header className="suite-topbar"><div><span className="eyebrow">PTM CRM</span><b>{NAV.find((n) => n.id === view)?.label}</b></div><div className="suite-top-actions"><button className="suite-icon-btn" onClick={() => load()} title="Làm mới">↻</button><div className="suite-notification"><button className="suite-icon-btn" onClick={() => setNoticeOpen(!noticeOpen)}>♢{unread > 0 && <em>{unread}</em>}</button>{noticeOpen && <div className="suite-notification-pop"><header><b>Thông báo</b><span>{unread} chưa đọc</span></header>{(full.notifications || []).length ? (full.notifications || []).slice(0, 15).map((n) => <button key={n.id} className={n.read_at ? "" : "unread"} onClick={() => readNotification(n)}><b>{n.title}</b><span>{n.body || ""}</span><small>{new Date(n.created_at).toLocaleString("vi-VN")}</small></button>) : <div className="suite-empty">Chưa có thông báo.</div>}</div>}</div><div className="suite-user-chip"><span>{data.user.name}</span><small>{roleLabel(data.user.role)}</small></div></div></header>
      {!fullReady && <div className="suite-system-banner">CRM lõi đang hoạt động. Các module Customer 360°, Cơ hội, Marketing, Ticket, KPI và Automation đang chờ kích hoạt migration database.</div>}
      {error && <div className="suite-error-banner">{error}</div>}
      {busy && <div className="suite-sync">Đang đồng bộ…</div>}
      <section className="suite-content">
        {view === "dashboard" && <ExecutiveDashboard data={data} full={full} permissions={permissions} />}
        {view === "customers" && <CustomersModule data={data} full={full} permissions={permissions} coreMutate={coreMutate} fullMutate={fullMutate} />}
        {view === "opportunities" && <OpportunitiesModule data={data} full={full} permissions={permissions} fullMutate={fullMutate} />}
        {view === "marketing" && <MarketingModule data={data} full={full} fullMutate={fullMutate} />}
        {view === "tasks" && <TasksModule data={data} coreMutate={coreMutate} />}
        {view === "calendar" && <CalendarModule data={data} full={full} />}
        {view === "tickets" && <TicketsModule data={data} full={full} fullMutate={fullMutate} />}
        {view === "properties" && <PropertiesModule data={data} permissions={permissions} coreMutate={coreMutate} />}
        {view === "deals" && <DealsModule data={data} permissions={permissions} coreMutate={coreMutate} />}
        {view === "kpi" && <KpiModule data={data} full={full} fullMutate={fullMutate} />}
        {view === "reports" && <ReportsModule data={data} full={full} permissions={permissions} />}
        {view === "automation" && <AutomationModule data={data} full={full} fullMutate={fullMutate} />}
        {view === "team" && <TeamModule data={data} permissions={permissions} coreMutate={coreMutate} />}
      </section>
    </main>
  </div>;
}

function LoginScreen({ login, setLogin, signIn, busy, error }) {
  return <main className="suite-login"><section className="suite-login-brand"><div className="brand-mark">PTM</div><span>PHÚC TRƯỜNG MINH</span><h1>CRM điều hành<br/>bất động sản</h1><p>Một nền tảng cho Marketing · Sales · CSKH · Kế toán · Ban giám đốc</p><div className="suite-login-features"><b>Customer 360°</b><b>Pipeline & Automation</b><b>KPI realtime</b><b>Phân lead thông minh</b></div></section><section className="suite-login-form"><form onSubmit={signIn}><span className="eyebrow">PTM ENTERPRISE CRM</span><h2>Đăng nhập hệ thống</h2><p>Sử dụng tài khoản nhân viên được cấp bởi công ty.</p><label>Email<input type="email" required value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label><label>Mật khẩu<input type="password" required autoFocus value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>{error && <div className="suite-login-error">{error}</div>}<button className="suite-btn primary wide" disabled={busy}>{busy ? "Đang xác thực..." : "Đăng nhập"}</button><small>Giám đốc · Admin · Marketing · Sale · Kế toán</small></form></section></main>;
}
