"use client";

import { useMemo, useState } from "react";
import { compactMoney, fmtDate } from "@/lib/crm-client";

const STATUS = {
  new: "Khách mới",
  contact: "Đã liên hệ",
  hot: "Quan tâm",
  visit: "Đi xem",
  deal: "Chốt cọc",
  lost: "Không nhu cầu"
};

const STATUS_OPTIONS = Object.entries(STATUS);
const SOURCE_OPTIONS = ["Facebook", "TikTok", "Google", "Website", "Zalo", "Giới thiệu", "Sự kiện", "Hotline", "Walk-in", "Khác"];
const EMPTY_CUSTOMER = {
  id: "",
  name: "",
  phone: "",
  email: "",
  source: "Facebook",
  need: "",
  budget: "",
  status: "new",
  project: "",
  owner_id: "",
  notes: ""
};

const ACTIVITY_TYPES = [
  ["call", "Cuộc gọi"], ["meeting", "Cuộc hẹn"], ["message", "Tin nhắn"], ["email", "Email"],
  ["note", "Ghi chú"], ["site_visit", "Đi xem dự án"], ["status_change", "Đổi trạng thái"], ["other", "Khác"]
];

function normalizeLead(lead = {}) {
  return {
    id: lead.id || "",
    name: lead.name || "",
    phone: lead.phone || "",
    email: lead.email || "",
    source: lead.source || "Facebook",
    need: lead.need || "",
    budget: lead.budget ?? "",
    status: lead.status || "new",
    project: lead.project || "",
    owner_id: lead.owner_id || "",
    notes: lead.notes || ""
  };
}

export function CustomersModule({ data, full, permissions, coreMutate, fullMutate }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(EMPTY_CUSTOMER);
  const [customerError, setCustomerError] = useState("");
  const [activity, setActivity] = useState({ activity_type: "call", subject: "", content: "", outcome: "", next_action_at: "" });

  const rows = useMemo(() => (data.leads || []).filter((l) => {
    const text = `${l.name} ${l.phone || ""} ${l.email || ""} ${l.project || ""} ${l.source || ""} ${STATUS[l.status] || l.status || ""}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  }), [data.leads, query]);

  const selected = (data.leads || []).find((l) => l.id === selectedId) || null;
  const meta = selected ? (full.lead_meta || []).find((m) => m.id === selected.id) || {} : {};
  const selectedTagIds = selected ? (full.lead_tags || []).filter((x) => x.lead_id === selected.id).map((x) => x.tag_id) : [];
  const timeline = selected ? (full.activities || []).filter((a) => a.lead_id === selected.id) : [];
  const opps = selected ? (full.opportunities || []).filter((o) => o.lead_id === selected.id) : [];
  const tickets = selected ? (full.tickets || []).filter((t) => t.lead_id === selected.id) : [];
  const sales = (data.users || []).filter((u) => u.role === "sale" && u.active !== false);

  function openCreateCustomer() {
    setCustomerDraft({ ...EMPTY_CUSTOMER });
    setCustomerError("");
    setCustomerOpen(true);
  }

  function openEditCustomer() {
    if (!selected) return;
    setCustomerDraft(normalizeLead(selected));
    setCustomerError("");
    setCustomerOpen(true);
  }

  async function saveCustomer(e) {
    e.preventDefault();
    setCustomerError("");
    if (!customerDraft.name.trim()) return setCustomerError("Vui lòng nhập họ tên khách hàng.");
    if (!customerDraft.phone.trim()) return setCustomerError("Vui lòng nhập số điện thoại khách hàng.");

    const payload = {
      ...(customerDraft.id ? { id: customerDraft.id } : {}),
      name: customerDraft.name.trim(),
      phone: customerDraft.phone.trim(),
      email: customerDraft.email.trim(),
      source: customerDraft.source || "Khác",
      need: customerDraft.need.trim(),
      budget: customerDraft.budget || 0,
      status: customerDraft.status || "new",
      project: customerDraft.project.trim(),
      owner_id: permissions.leads_assign ? (customerDraft.owner_id || "") : (selected?.owner_id || ""),
      notes: customerDraft.notes.trim()
    };

    try {
      await coreMutate("save_lead", payload);
      setCustomerOpen(false);
    } catch (err) {
      setCustomerError(err?.message || "Không thể lưu khách hàng.");
    }
  }

  async function changeStatus(status) {
    if (!selected || !permissions.leads_update) return;
    await coreMutate("save_lead", { ...normalizeLead(selected), status });
  }

  async function updateCustomerMeta() {
    if (!selected) return;
    const score = prompt("Điểm tiềm năng 0-100", String(meta.score ?? 0)); if (score === null) return;
    const follow = prompt("Ngày chăm sóc tiếp theo (ISO hoặc để trống)", meta.next_follow_up_at || ""); if (follow === null) return;
    const company = prompt("Công ty / đơn vị", meta.profile?.company || ""); if (company === null) return;
    const occupation = prompt("Nghề nghiệp", meta.profile?.occupation || ""); if (occupation === null) return;
    const preferredArea = prompt("Khu vực ưu tiên", meta.profile?.preferred_area || ""); if (preferredArea === null) return;
    await fullMutate("customer.update_meta", {
      lead_id: selected.id,
      score,
      next_follow_up_at: follow,
      profile: { ...(meta.profile || {}), company, occupation, preferred_area: preferredArea }
    });
  }

  async function submitActivity(e) {
    e.preventDefault();
    if (!selected || (!activity.subject && !activity.content)) return;
    await fullMutate("activity.create", { lead_id: selected.id, ...activity });
    setActivity({ activity_type: "call", subject: "", content: "", outcome: "", next_action_at: "" });
  }

  async function toggleTag(tag) {
    if (!selected) return;
    await fullMutate("tag.attach", { lead_id: selected.id, tag_id: tag.id, remove: selectedTagIds.includes(tag.id) });
  }

  async function createTag() {
    const name = prompt("Tên nhãn khách hàng"); if (!name) return;
    await fullMutate("tag.save", { name, color: "#0f766e" });
  }

  return <div className="suite-page">
    <div className="suite-page-head">
      <div><h1>Khách hàng 360°</h1><p>Nhập thông tin khách, tình trạng chăm sóc, hành trình, nhãn và cơ hội trên một màn hình.</p></div>
      {permissions.leads_create && <button className="suite-btn primary" onClick={openCreateCustomer}>+ Khách hàng</button>}
    </div>

    <div className="suite-customer-layout">
      <section className="suite-panel suite-customer-list">
        <div className="suite-toolbar"><input className="suite-input" placeholder="Tìm tên, SĐT, dự án, nguồn, tình trạng..." value={query} onChange={(e) => setQuery(e.target.value)} /><span>{rows.length} khách</span></div>
        <div className="suite-customer-rows">{rows.map((l) => {
          const lm = (full.lead_meta || []).find((m) => m.id === l.id) || {};
          const tags = (full.lead_tags || []).filter((x) => x.lead_id === l.id).map((x) => (full.tags || []).find((t) => t.id === x.tag_id)).filter(Boolean);
          return <button key={l.id} className={`suite-customer-row ${selectedId === l.id ? "active" : ""}`} onClick={() => setSelectedId(l.id)}>
            <div className="suite-avatar">{l.name?.slice(0, 2).toUpperCase()}</div>
            <div className="suite-customer-main"><b>{l.name}</b><span>{l.phone} · {l.project || "Chưa có dự án"}</span><div>{tags.slice(0, 3).map((t) => <em key={t.id}>{t.name}</em>)}</div></div>
            <div className="suite-customer-side"><strong>{lm.score ?? 0}</strong><small>điểm</small><span className={`suite-status status-${l.status}`}>{STATUS[l.status] || l.status}</span></div>
          </button>;
        })}</div>
      </section>

      <section className="suite-panel suite-customer-detail">{!selected ? <div className="suite-empty suite-empty-large">Chọn một khách hàng để xem hồ sơ 360° hoặc bấm “+ Khách hàng” để nhập khách mới.</div> : <>
        <div className="suite-detail-head">
          <div><span className="eyebrow">{meta.customer_code || "CUSTOMER 360"}</span><h2>{selected.name}</h2><p>{selected.phone} {selected.email ? `· ${selected.email}` : ""}</p></div>
          <div className="suite-score"><strong>{meta.score ?? 0}</strong><span>Lead score</span></div>
        </div>

        <div className="suite-action-row">
          <a className="suite-btn" href={`tel:${selected.phone}`}>☎ Gọi</a>
          {permissions.leads_update && <button className="suite-btn" onClick={openEditCustomer}>Sửa thông tin khách</button>}
          <button className="suite-btn" onClick={updateCustomerMeta}>Sửa hồ sơ 360°</button>
        </div>

        <div className="customer-detail-status">
          <span>Tình trạng khách</span>
          <select className="customer-status-select" value={selected.status || "new"} disabled={!permissions.leads_update} onChange={(e) => changeStatus(e.target.value)}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="suite-info-grid section-gap">
          <div><span>Nguồn</span><b>{selected.source || "—"}</b></div><div><span>Tình trạng</span><b>{STATUS[selected.status] || selected.status || "—"}</b></div>
          <div><span>Dự án quan tâm</span><b>{selected.project || "—"}</b></div><div><span>Nhu cầu</span><b>{selected.need || "—"}</b></div>
          <div><span>Ngân sách</span><b>{compactMoney(selected.budget)}</b></div><div><span>Sale phụ trách</span><b>{selected.owner_name || "Chưa giao"}</b></div>
          <div><span>Lần chăm sóc cuối</span><b>{fmtDate(meta.last_contact_at, true)}</b></div><div><span>Chăm sóc tiếp theo</span><b>{fmtDate(meta.next_follow_up_at, true)}</b></div>
          <div><span>Công ty</span><b>{meta.profile?.company || "—"}</b></div><div><span>Khu vực ưu tiên</span><b>{meta.profile?.preferred_area || "—"}</b></div>
          <div><span>Ghi chú</span><b>{selected.notes || "—"}</b></div><div><span>Email</span><b>{selected.email || "—"}</b></div>
        </div>

        <div className="suite-subsection"><div className="suite-subhead"><h3>Nhãn & phân nhóm</h3>{["admin","ceo","manager","marketing"].includes(data.user.role) && <button className="text-link" onClick={createTag}>+ Tạo nhãn</button>}</div><div className="suite-tag-cloud">{(full.tags || []).length ? (full.tags || []).map((t) => <button key={t.id} className={selectedTagIds.includes(t.id) ? "selected" : ""} onClick={() => toggleTag(t)}>{t.name}</button>) : <span>Chưa có nhãn. Marketing/Admin có thể tạo nhãn mới.</span>}</div></div>

        <div className="suite-grid suite-grid-2 suite-mini-summary"><div><span>Cơ hội</span><strong>{opps.length}</strong><small>{compactMoney(opps.reduce((s, o) => s + Number(o.value || 0), 0))}</small></div><div><span>Ticket CSKH</span><strong>{tickets.length}</strong><small>{tickets.filter((t) => !["resolved","closed"].includes(t.status)).length} đang mở</small></div></div>

        <div className="suite-subsection"><h3>Ghi nhận tương tác</h3><form className="suite-activity-form" onSubmit={submitActivity}><select value={activity.activity_type} onChange={(e) => setActivity({ ...activity, activity_type: e.target.value })}>{ACTIVITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><input placeholder="Tiêu đề" value={activity.subject} onChange={(e) => setActivity({ ...activity, subject: e.target.value })} /><textarea placeholder="Nội dung trao đổi / nhu cầu / phản hồi" value={activity.content} onChange={(e) => setActivity({ ...activity, content: e.target.value })} /><input placeholder="Kết quả" value={activity.outcome} onChange={(e) => setActivity({ ...activity, outcome: e.target.value })} /><label>Chăm sóc tiếp<input type="datetime-local" value={activity.next_action_at} onChange={(e) => setActivity({ ...activity, next_action_at: e.target.value })} /></label><button className="suite-btn primary">Lưu tương tác</button></form></div>

        <div className="suite-subsection"><h3>Lịch sử chăm sóc</h3><div className="suite-timeline">{timeline.length ? timeline.map((a) => <div key={a.id}><i /><div><b>{a.subject || ACTIVITY_TYPES.find(([v]) => v === a.activity_type)?.[1] || a.activity_type}</b><p>{a.content || a.outcome || "Không có nội dung"}</p><small>{a.user_name || "Hệ thống"} · {fmtDate(a.happened_at, true)}{a.next_action_at ? ` · Hẹn tiếp ${fmtDate(a.next_action_at, true)}` : ""}</small></div></div>) : <div className="suite-empty">Chưa có tương tác nào.</div>}</div></div>
      </>}</section>
    </div>

    {customerOpen && <div className="customer-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setCustomerOpen(false)}>
      <section className="customer-modal">
        <header><div><span className="eyebrow">CRM KHÁCH HÀNG</span><h2>{customerDraft.id ? "Sửa thông tin khách hàng" : "Thêm khách hàng mới"}</h2></div><button className="customer-modal-close" type="button" onClick={() => setCustomerOpen(false)}>×</button></header>
        <form className="customer-form" onSubmit={saveCustomer}>
          {customerError && <div className="customer-form-error">{customerError}</div>}
          <div className="customer-form-grid">
            <label>Họ tên <span className="customer-required">*</span><input autoFocus required value={customerDraft.name} onChange={(e) => setCustomerDraft({ ...customerDraft, name: e.target.value })} placeholder="Nguyễn Văn A" /></label>
            <label>Số điện thoại <span className="customer-required">*</span><input required inputMode="tel" value={customerDraft.phone} onChange={(e) => setCustomerDraft({ ...customerDraft, phone: e.target.value })} placeholder="0909 123 456" /></label>
            <label>Email<input type="email" value={customerDraft.email} onChange={(e) => setCustomerDraft({ ...customerDraft, email: e.target.value })} placeholder="khachhang@email.com" /></label>
            <label>Nguồn khách<select value={customerDraft.source} onChange={(e) => setCustomerDraft({ ...customerDraft, source: e.target.value })}>{SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
            <label>Tình trạng khách<select value={customerDraft.status} onChange={(e) => setCustomerDraft({ ...customerDraft, status: e.target.value })}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="customer-helper">Dùng để theo dõi tiến độ chăm sóc và phễu bán hàng.</span></label>
            <label>Dự án quan tâm<input value={customerDraft.project} onChange={(e) => setCustomerDraft({ ...customerDraft, project: e.target.value })} placeholder="The Global City..." /></label>
            <label>Nhu cầu<input value={customerDraft.need} onChange={(e) => setCustomerDraft({ ...customerDraft, need: e.target.value })} placeholder="Căn hộ 2PN, đầu tư, ở thực..." /></label>
            <label>Ngân sách dự kiến<input type="number" min="0" step="1000000" value={customerDraft.budget} onChange={(e) => setCustomerDraft({ ...customerDraft, budget: e.target.value })} placeholder="3000000000" /></label>
            {permissions.leads_assign && <label>Sale phụ trách<select value={customerDraft.owner_id} onChange={(e) => setCustomerDraft({ ...customerDraft, owner_id: e.target.value })}><option value="">Chưa phân / hệ thống tự phân</option>{sales.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
            <label className="customer-form-wide">Ghi chú<textarea value={customerDraft.notes} onChange={(e) => setCustomerDraft({ ...customerDraft, notes: e.target.value })} placeholder="Ghi chú thêm về nhu cầu, thời gian dự kiến mua, nguồn giới thiệu..." /></label>
          </div>
          <div className="customer-form-actions"><button type="button" className="suite-btn" onClick={() => setCustomerOpen(false)}>Hủy</button><button className="suite-btn primary">{customerDraft.id ? "Lưu thay đổi" : "Tạo khách hàng"}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}
