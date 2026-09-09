"use client";

import { useEffect, useMemo, useState } from "react";
import { integrationStatus } from "@/lib/crm-client";

const EVENTS = [
  { value:"lead_created", label:"Khách hàng mới được tạo", group:"Tiếp nhận khách", icon:"◎", description:"Kích hoạt khi một khách mới được thêm thủ công, import hoặc đổ về CRM." },
  { value:"lead_assigned", label:"Khách được giao cho Sale", group:"Phân lead", icon:"→", description:"Kích hoạt khi khách đã có nhân viên Sale phụ trách." },
  { value:"lead_accepted", label:"Sale xác nhận nhận khách", group:"Phân lead", icon:"✓", description:"Kích hoạt khi Sale nhận lead được hệ thống phân." },
  { value:"lead_status_changed", label:"Tình trạng khách thay đổi", group:"Chăm sóc", icon:"↻", description:"Ví dụ: Khách mới → Đã liên hệ → Quan tâm → Đi xem → Chốt cọc." },
  { value:"followup_due", label:"Đến hạn chăm sóc khách", group:"Chăm sóc", icon:"◷", description:"Dùng để nhắc nhân viên khi tới lịch gọi lại hoặc chăm sóc tiếp theo." },
  { value:"opportunity_stage_changed", label:"Cơ hội bán hàng đổi giai đoạn", group:"Bán hàng", icon:"◇", description:"Kích hoạt khi cơ hội chuyển bước trong Pipeline." },
  { value:"ticket_created", label:"Có yêu cầu CSKH mới", group:"CSKH", icon:"◉", description:"Kích hoạt khi phát sinh ticket cần xử lý." },
  { value:"deal_completed", label:"Giao dịch hoàn tất", group:"Bán hàng", icon:"₫", description:"Kích hoạt khi giao dịch Thiên Phúc được hoàn tất." }
];

const ACTIONS = [
  { value:"create_task", label:"Tạo công việc cho nhân viên", icon:"✓" },
  { value:"notify_user", label:"Gửi thông báo trong CRM", icon:"♢" },
  { value:"update_lead_status", label:"Cập nhật tình trạng khách", icon:"↻" },
  { value:"add_tag", label:"Gắn nhãn khách hàng", icon:"#" },
  { value:"send_email", label:"Gửi Email tự động", icon:"@", channel:"email" },
  { value:"send_zalo", label:"Gửi Zalo/ZNS tự động", icon:"Z", channel:"zalo" }
];

const TEMPLATES = [
  {
    key:"assigned-10m",
    name:"Lead được giao → Sale liên hệ ngay",
    category:"Phân lead",
    event_type:"lead_assigned",
    description:"Thông báo cho Sale và tạo công việc liên hệ khách ngay sau khi được giao lead.",
    actions:[{ type:"notify_user", delay_minutes:0 },{ type:"create_task", delay_minutes:0 }]
  },
  {
    key:"accepted-followup",
    name:"Sale nhận lead → tạo việc chăm sóc",
    category:"Chăm sóc",
    event_type:"lead_accepted",
    description:"Ngay khi Sale nhận khách, CRM tạo công việc chăm sóc để tránh bỏ quên lead.",
    actions:[{ type:"create_task", delay_minutes:0 }]
  },
  {
    key:"followup-due",
    name:"Đến hạn chăm sóc → nhắc Sale",
    category:"Chăm sóc",
    event_type:"followup_due",
    description:"Nhắc nhân viên khi tới lịch chăm sóc khách và tạo công việc cần xử lý.",
    actions:[{ type:"notify_user", delay_minutes:0 },{ type:"create_task", delay_minutes:0 }]
  },
  {
    key:"status-change",
    name:"Khách đổi tình trạng → thông báo phụ trách",
    category:"Bán hàng",
    event_type:"lead_status_changed",
    description:"Giúp Sale và quản lý theo dõi khách đang tiến triển trong phễu bán hàng.",
    actions:[{ type:"notify_user", delay_minutes:0 }]
  },
  {
    key:"pipeline-next-step",
    name:"Cơ hội đổi giai đoạn → tạo việc tiếp theo",
    category:"Pipeline",
    event_type:"opportunity_stage_changed",
    description:"Tạo công việc kế tiếp khi cơ hội chuyển từ tư vấn sang đi xem, booking, đặt cọc hoặc hợp đồng.",
    actions:[{ type:"create_task", delay_minutes:0 }]
  },
  {
    key:"deal-completed",
    name:"Giao dịch hoàn tất → thông báo nội bộ",
    category:"Giao dịch",
    event_type:"deal_completed",
    description:"Thông báo khi giao dịch hoàn tất để Sale, Kế toán và quản lý tiếp tục xử lý hậu mãi/hoa hồng.",
    actions:[{ type:"notify_user", delay_minutes:0 }]
  }
];

function eventMeta(value) { return EVENTS.find((x) => x.value === value) || { label:value, group:"Khác", icon:"⚡", description:"" }; }
function actionMeta(value) { return ACTIONS.find((x) => x.value === value) || { label:value, icon:"•" }; }
function delayLabel(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "Ngay lập tức";
  if (value < 60) return `Sau ${value} phút`;
  if (value % 1440 === 0) return `Sau ${value / 1440} ngày`;
  if (value % 60 === 0) return `Sau ${value / 60} giờ`;
  return `Sau ${value} phút`;
}

const EMPTY_FORM = { id:"", name:"", event_type:"lead_assigned", action_type:"create_task", delay_minutes:0, enabled:true };
const EMPTY_CHANNELS = { database:false,lead_webhook:false,email:false,zalo:false,facebook_verify:false,providers:{} };

export function AutomationModule({ data, full, fullMutate }) {
  const rules = full.automations || [];
  const canManage = ["admin","ceo","manager","marketing"].includes(data.user.role);
  const [tab,setTab] = useState("templates");
  const [formOpen,setFormOpen] = useState(false);
  const [form,setForm] = useState(EMPTY_FORM);
  const [saving,setSaving] = useState(false);
  const [filter,setFilter] = useState("all");
  const [channels,setChannels] = useState(EMPTY_CHANNELS);

  useEffect(()=>{let stopped=false;integrationStatus().then(out=>{if(!stopped)setChannels({...EMPTY_CHANNELS,...out})}).catch(()=>{});return()=>{stopped=true}},[]);

  const enabledCount = rules.filter((r) => r.enabled).length;
  const visibleRules = useMemo(() => rules.filter((r) => filter === "all" || eventMeta(r.event_type).group === filter), [rules,filter]);
  const groups = [...new Set(EVENTS.map((e) => e.group))];
  const externalReady = [channels.lead_webhook,channels.email,channels.zalo].filter(Boolean).length;
  const actionReady = (action) => !action.channel || Boolean(channels[action.channel]);

  async function saveRule(e) {
    e.preventDefault();
    if (!canManage || !form.name.trim()) return;
    setSaving(true);
    try {
      await fullMutate("automation.save", {
        ...(form.id ? { id:form.id } : {}),
        name:form.name.trim(),
        event_type:form.event_type,
        conditions:{},
        actions:[{ type:form.action_type, delay_minutes:Number(form.delay_minutes || 0) }],
        enabled:form.enabled
      });
      setFormOpen(false);
      setForm(EMPTY_FORM);
    } finally { setSaving(false); }
  }

  async function installTemplate(t) {
    if (!canManage || rules.some((r) => r.name === t.name)) return;
    await fullMutate("automation.save", { name:t.name, event_type:t.event_type, conditions:{}, actions:t.actions, enabled:true });
    setTab("rules");
  }

  async function toggle(rule) {
    if (!canManage) return;
    await fullMutate("automation.save", { ...rule, enabled:!rule.enabled });
  }

  function edit(rule) {
    if (!canManage) return;
    const first = Array.isArray(rule.actions) ? rule.actions[0] : null;
    setForm({
      id:rule.id,
      name:rule.name || "",
      event_type:rule.event_type || "lead_assigned",
      action_type:first?.type || "create_task",
      delay_minutes:first?.delay_minutes || 0,
      enabled:rule.enabled !== false
    });
    setFormOpen(true);
  }

  return <div className="suite-page automation-page">
    <div className="suite-page-head">
      <div>
        <h1>Tự động hóa Marketing & Bán hàng</h1>
        <p>Chuẩn hóa quy trình theo nguyên tắc: <b>Khi xảy ra sự kiện → CRM tự thực hiện hành động</b>.</p>
      </div>
      {canManage && <button className="suite-btn primary" onClick={() => { setForm(EMPTY_FORM); setFormOpen(true); }}>+ Kịch bản tùy chỉnh</button>}
    </div>

    <div className="automation-explainer">
      <div><span>1</span><b>Sự kiện</b><small>Khách mới, được giao Sale, tới lịch chăm sóc...</small></div>
      <i>→</i>
      <div><span>2</span><b>Điều kiện</b><small>Áp dụng đúng nhóm khách hoặc trạng thái cần xử lý.</small></div>
      <i>→</i>
      <div><span>3</span><b>Hành động</b><small>Tạo việc, thông báo, đổi trạng thái, gắn nhãn.</small></div>
      <i>→</i>
      <div><span>4</span><b>Theo dõi</b><small>Engine server thực thi và sweep khách tới hạn khi CRM đang hoạt động.</small></div>
    </div>

    <div className="automation-metrics">
      <div><span>Kịch bản đã tạo</span><strong>{rules.length}</strong></div>
      <div><span>Đang bật cấu hình</span><strong>{enabledCount}</strong></div>
      <div><span>Mẫu chuẩn Thiên Phúc</span><strong>{TEMPLATES.length}</strong></div>
      <div><span>Kênh ngoài CRM</span><strong className={externalReady?"":"automation-muted"}>{externalReady}/3 sẵn sàng</strong><small>Lead webhook · Email · Zalo</small></div>
    </div>

    <div className="automation-engine-note">
      <b>Automation engine</b>
      <span>{channels.database?"Engine server đã kết nối database và có thể thực thi rule thật.":"Engine đã được triển khai nhưng server chưa thấy DATABASE_URL; các rule nội bộ qua RPC vẫn hoạt động, cần cấu hình database server để bật webhook/engine đầy đủ."}</span>
    </div>

    <div className="automation-tabs">
      <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Mẫu chuẩn</button>
      <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>Kịch bản của CRM <em>{rules.length}</em></button>
      <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>Kênh & Lead intake</button>
    </div>

    {tab === "templates" && <div className="automation-template-grid">
      {TEMPLATES.map((t) => {
        const installed = rules.some((r) => r.name === t.name);
        const ev = eventMeta(t.event_type);
        return <article className="suite-panel automation-template-card" key={t.key}>
          <header><span>{t.category}</span><i>{ev.icon}</i></header>
          <h3>{t.name}</h3>
          <p>{t.description}</p>
          <div className="automation-flow-mini"><b>{ev.label}</b><span>→</span><b>{t.actions.map((a) => actionMeta(a.type).label).join(" + ")}</b></div>
          <button className={`suite-btn ${installed ? "" : "primary"}`} disabled={!canManage || installed} onClick={() => installTemplate(t)}>{installed ? "✓ Đã thêm" : "+ Dùng mẫu này"}</button>
        </article>;
      })}
    </div>}

    {tab === "rules" && <>
      <div className="automation-toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Tất cả nhóm</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <span>{visibleRules.length} kịch bản</span>
      </div>
      <div className="suite-automation-list automation-rule-list">
        {visibleRules.length ? visibleRules.map((r) => {
          const ev = eventMeta(r.event_type);
          const actions = Array.isArray(r.actions) ? r.actions : [];
          return <article className="suite-panel automation-rule" key={r.id}>
            <div className={`suite-automation-icon ${r.enabled ? "on" : ""}`}>{ev.icon}</div>
            <div className="automation-rule-main">
              <div className="automation-rule-title"><b>{r.name}</b><span>{ev.group}</span></div>
              <p><small>KHI</small> <strong>{ev.label}</strong></p>
              <div className="automation-action-row">{actions.length ? actions.map((a,i) => <span key={`${a.type}-${i}`}><i>{actionMeta(a.type).icon}</i>{actionMeta(a.type).label}<small>{delayLabel(a.delay_minutes)}</small></span>) : <em>Chưa có hành động</em>}</div>
            </div>
            <div className="automation-rule-controls">
              {canManage && <button className="text-link" onClick={() => edit(r)}>Sửa</button>}
              <button disabled={!canManage} className={`suite-switch ${r.enabled ? "on" : ""}`} onClick={() => toggle(r)}>{r.enabled ? "Đang bật" : "Đã tắt"}</button>
            </div>
          </article>;
        }) : <div className="suite-panel suite-empty suite-empty-large">Chưa có kịch bản trong nhóm này. Chọn “Mẫu chuẩn” để tạo nhanh.</div>}
      </div>
    </>}

    {tab === "channels" && <div className="automation-channel-grid">
      <article className={`suite-panel ${channels.lead_webhook?"ready":"pending"}`}><div>⇩</div><h3>Lead đa nguồn</h3><p>Webhook chuẩn hóa Website · Facebook · TikTok · Zalo · Google · Hotline vào một luồng chống trùng.</p><span>{channels.lead_webhook?"Đã bật webhook":"Chờ cấu hình secret"}</span></article>
      <article className="suite-panel ready"><div>♢</div><h3>Thông báo trong CRM</h3><p>Engine tạo thông báo nội bộ cho nhân viên theo sự kiện.</p><span>Đang hoạt động</span></article>
      <article className="suite-panel ready"><div>✓</div><h3>Công việc CRM</h3><p>Tự tạo nhiệm vụ và deadline để Sale không bỏ quên khách.</p><span>Đang hoạt động</span></article>
      <article className={`suite-panel ${channels.email?"ready":"pending"}`}><div>@</div><h3>Email</h3><p>Adapter gửi email tự động qua tài khoản doanh nghiệp đã được cấu hình.</p><span>{channels.email?"Đã kết nối":"Chờ RESEND_API_KEY"}</span></article>
      <article className={`suite-panel ${channels.zalo?"ready":"pending"}`}><div>Z</div><h3>Zalo / ZNS</h3><p>Cầu nối server gửi dữ liệu sang Zalo OA/ZNS bridge và template được phê duyệt.</p><span>{channels.zalo?"Đã kết nối bridge":"Chờ Zalo bridge"}</span></article>
    </div>}

    {formOpen && <div className="automation-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setFormOpen(false)}>
      <section className="automation-modal">
        <header><div><span className="eyebrow">KỊCH BẢN TỰ ĐỘNG</span><h2>{form.id ? "Sửa kịch bản" : "Tạo kịch bản mới"}</h2></div><button onClick={() => setFormOpen(false)}>×</button></header>
        <form onSubmit={saveRule}>
          <label>Tên kịch bản<input autoFocus required value={form.name} onChange={(e) => setForm({...form,name:e.target.value})} placeholder="Ví dụ: Đến hạn chăm sóc → nhắc Sale"/></label>
          <label>Khi nào chạy?<select value={form.event_type} onChange={(e) => setForm({...form,event_type:e.target.value})}>{EVENTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select><small>{eventMeta(form.event_type).description}</small></label>
          <label>CRM sẽ làm gì?<select value={form.action_type} onChange={(e) => setForm({...form,action_type:e.target.value})}>{ACTIONS.map((a) => <option key={a.value} value={a.value} disabled={!actionReady(a)}>{a.label}{!actionReady(a) ? " — cần kết nối" : ""}</option>)}</select></label>
          <label>Thời gian chờ<select value={form.delay_minutes} onChange={(e) => setForm({...form,delay_minutes:Number(e.target.value)})}><option value={0}>Ngay lập tức</option><option value={10}>10 phút</option><option value={30}>30 phút</option><option value={60}>1 giờ</option><option value={180}>3 giờ</option><option value={1440}>1 ngày</option><option value={2880}>2 ngày</option><option value={4320}>3 ngày</option></select></label>
          <label className="automation-checkbox"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({...form,enabled:e.target.checked})}/><span>Bật kịch bản sau khi lưu</span></label>
          <footer><button type="button" className="suite-btn" onClick={() => setFormOpen(false)}>Hủy</button><button className="suite-btn primary" disabled={saving}>{saving ? "Đang lưu..." : "Lưu kịch bản"}</button></footer>
        </form>
      </section>
    </div>}
  </div>;
}
