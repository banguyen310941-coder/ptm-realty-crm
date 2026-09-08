"use client";

import { useMemo, useState } from "react";
import { compactMoney, fmtDate, money } from "@/lib/crm-client";

const STAGES = [
  ["qualify", "Đánh giá", 10], ["consult", "Tư vấn", 25], ["visit", "Đi xem", 45], ["booking", "Booking", 65],
  ["deposit", "Đặt cọc", 80], ["contract", "Hợp đồng", 90], ["won", "Thành công", 100], ["lost", "Thất bại", 0]
];

export function OpportunitiesModule({ data, full, permissions, fullMutate }) {
  const [dragId, setDragId] = useState(null);
  const opportunities = full.opportunities || [];
  const canManage = ["admin", "ceo", "manager", "sale"].includes(data.user.role);

  async function createOpportunity() {
    if (!canManage) return;
    const name = prompt("Tên cơ hội", "Tư vấn BĐS"); if (!name) return;
    const lead = choose(data.leads || [], "Chọn khách hàng"); if (!lead) return;
    const property = choose(data.properties || [], "Chọn sản phẩm (Cancel để bỏ qua)", true);
    const value = prompt("Giá trị cơ hội (VND)", property?.price || lead.budget || 0); if (value === null) return;
    const close = prompt("Ngày dự kiến chốt YYYY-MM-DD", "") || "";
    await fullMutate("opportunity.save", { name, lead_id: lead.id, property_id: property?.id || "", owner_id: lead.owner_id || data.user.id, stage: "qualify", status: "open", value, probability: 10, expected_close_date: close, notes: "" });
  }

  async function move(id, stage) {
    const item = opportunities.find((o) => o.id === id); if (!item || !canManage) return;
    const stageInfo = STAGES.find(([s]) => s === stage);
    const status = stage === "won" ? "won" : stage === "lost" ? "lost" : "open";
    await fullMutate("opportunity.save", { ...item, stage, status, probability: stageInfo?.[2] ?? item.probability, owner_id: item.owner_id || data.user.id });
  }

  async function edit(item) {
    if (!canManage) return;
    const value = prompt("Giá trị cơ hội", item.value ?? 0); if (value === null) return;
    const probability = prompt("Xác suất (%)", item.probability ?? 10); if (probability === null) return;
    const close = prompt("Ngày dự kiến chốt YYYY-MM-DD", item.expected_close_date || ""); if (close === null) return;
    const notes = prompt("Ghi chú", item.notes || ""); if (notes === null) return;
    await fullMutate("opportunity.save", { ...item, value, probability, expected_close_date: close, notes, owner_id: item.owner_id || data.user.id });
  }

  return <div className="suite-page"><div className="suite-page-head"><div><h1>Cơ hội & Pipeline</h1><p>Kanban bán hàng từ đánh giá nhu cầu đến hợp đồng và thành công.</p></div>{canManage && <button className="suite-btn primary" onClick={createOpportunity}>+ Cơ hội</button>}</div>
    <div className="suite-pipeline">{STAGES.map(([stage, label]) => {
      const rows = opportunities.filter((o) => o.stage === stage);
      const total = rows.reduce((s, o) => s + Number(o.value || 0), 0);
      return <section key={stage} className="suite-pipeline-col" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) move(dragId, stage); setDragId(null); }}>
        <div className="suite-pipeline-head"><div><b>{label}</b><span>{rows.length}</span></div><small>{permissions.finance_view ? compactMoney(total) : "Ẩn giá trị"}</small></div>
        <div className="suite-pipeline-cards">{rows.map((o) => <article key={o.id} draggable={canManage} onDragStart={() => setDragId(o.id)} onClick={() => edit(o)} className="suite-opportunity-card"><div className="suite-op-top"><b>{o.name}</b><span>{o.probability}%</span></div><p>{o.lead_name || "Chưa gắn khách"}</p><small>{o.property_name || "Chưa chọn sản phẩm"}</small>{permissions.finance_view && <strong>{compactMoney(o.value)}</strong>}<footer><span>{o.owner_name || "—"}</span><span>{fmtDate(o.expected_close_date)}</span></footer></article>)}</div>
      </section>;
    })}</div>
  </div>;
}

function choose(rows, title, allowEmpty = false) {
  if (!rows.length) return null;
  const text = rows.slice(0, 50).map((x, i) => `${i + 1}. ${x.name}${x.phone ? ` · ${x.phone}` : ""}`).join("\n");
  const raw = prompt(`${title}:\n${text}`, allowEmpty ? "" : "1");
  if (raw === null || (allowEmpty && raw === "")) return null;
  const index = Number(raw) - 1;
  return rows[index] || null;
}

export function MarketingModule({ data, full, fullMutate }) {
  const campaigns = full.campaigns || [];
  const canManage = ["admin", "ceo", "manager", "marketing"].includes(data.user.role);
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => campaigns.filter((c) => status === "all" || c.status === status), [campaigns, status]);

  async function saveCampaign(c = {}) {
    if (!canManage) return;
    const name = prompt("Tên chiến dịch", c.name || ""); if (!name) return;
    const channel = prompt("Kênh: facebook/google/tiktok/zalo/website/event/referral/other", c.channel || "facebook") || "other";
    const campaignStatus = prompt("Trạng thái: draft/active/paused/completed/cancelled", c.status || "draft") || "draft";
    const budget = prompt("Ngân sách (VND)", c.budget || 0); if (budget === null) return;
    const target = prompt("Mục tiêu lead", c.target_leads || 0); if (target === null) return;
    const start = prompt("Ngày bắt đầu YYYY-MM-DD", c.start_date || "") || "";
    const end = prompt("Ngày kết thúc YYYY-MM-DD", c.end_date || "") || "";
    const utm = prompt("UTM campaign", c.utm_campaign || name.toLowerCase().replaceAll(" ", "-")) || "";
    await fullMutate("campaign.save", { ...c, name, campaign_type: "digital", channel, status: campaignStatus, budget, target_leads: target, start_date: start, end_date: end, utm_source: channel, utm_medium: "paid", utm_campaign: utm, notes: c.notes || "" });
  }

  async function addMember(c) {
    const lead = choose(data.leads || [], "Chọn khách đưa vào chiến dịch"); if (!lead) return;
    await fullMutate("campaign.add_member", { campaign_id: c.id, lead_id: lead.id, member_status: "new", source_detail: lead.source || "CRM" });
  }

  return <div className="suite-page"><div className="suite-page-head"><div><h1>Marketing</h1><p>Chiến dịch, nguồn lead, UTM và tỷ lệ chuyển đổi Marketing → Sales.</p></div>{canManage && <button className="suite-btn primary" onClick={() => saveCampaign()}>+ Chiến dịch</button>}</div>
    <div className="suite-toolbar"><select className="suite-input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="draft">Nháp</option><option value="active">Đang chạy</option><option value="paused">Tạm dừng</option><option value="completed">Hoàn tất</option></select><span>{rows.length} chiến dịch</span></div>
    <div className="suite-campaign-grid">{rows.map((c) => {
      const rate = Number(c.member_count) ? Math.round(Number(c.converted_count || 0) / Number(c.member_count) * 100) : 0;
      const progress = Number(c.target_leads) ? Math.min(100, Math.round(Number(c.member_count || 0) / Number(c.target_leads) * 100)) : 0;
      return <article className="suite-campaign-card" key={c.id}><header><span className={`suite-status status-${c.status}`}>{c.status}</span><b>{c.channel}</b></header><h2>{c.name}</h2><p>{fmtDate(c.start_date)} → {fmtDate(c.end_date)}</p><div className="suite-campaign-metrics"><div><strong>{c.member_count || 0}</strong><span>Lead</span></div><div><strong>{c.converted_count || 0}</strong><span>Chuyển đổi</span></div><div><strong>{rate}%</strong><span>Tỷ lệ</span></div></div><div className="suite-progress"><i style={{ width: `${progress}%` }} /></div><small>Mục tiêu {c.target_leads || 0} lead · {c.budget !== null ? money(c.budget) : "Ngân sách ẩn"}</small>{canManage && <footer><button onClick={() => saveCampaign(c)}>Sửa</button><button onClick={() => addMember(c)}>+ Lead</button></footer>}</article>;
    })}</div>
  </div>;
}

const EVENTS = [
  ["lead_created", "Lead mới được tạo"], ["lead_assigned", "Lead được phân Sale"], ["lead_accepted", "Sale nhận lead"],
  ["lead_status_changed", "Khách đổi trạng thái"], ["followup_due", "Đến hạn chăm sóc"], ["opportunity_stage_changed", "Cơ hội đổi giai đoạn"],
  ["ticket_created", "Ticket được tạo"], ["deal_completed", "Giao dịch hoàn tất"]
];
const ACTIONS = [
  ["create_task", "Tạo công việc"], ["notify_user", "Thông báo nhân viên"], ["update_lead_status", "Đổi trạng thái khách"],
  ["add_tag", "Gắn nhãn"], ["send_email", "Gửi email (connector sau)"], ["send_zalo", "Gửi Zalo/ZNS (connector sau)"]
];

export function AutomationModule({ data, full, fullMutate }) {
  const canManage = ["admin", "ceo", "manager", "marketing"].includes(data.user.role);
  async function createRule() {
    if (!canManage) return;
    const name = prompt("Tên kịch bản automation"); if (!name) return;
    const event = prompt(`Sự kiện:\n${EVENTS.map(([v, l]) => `${v} = ${l}`).join("\n")}`, "lead_created"); if (!event) return;
    const action = prompt(`Hành động:\n${ACTIONS.map(([v, l]) => `${v} = ${l}`).join("\n")}`, "create_task"); if (!action) return;
    const delay = prompt("Trì hoãn bao nhiêu phút?", "0") || "0";
    await fullMutate("automation.save", { name, event_type: event, conditions: {}, actions: [{ type: action, delay_minutes: Number(delay) }], enabled: true });
  }
  async function toggle(r) {
    await fullMutate("automation.save", { ...r, enabled: !r.enabled });
  }
  return <div className="suite-page"><div className="suite-page-head"><div><h1>Marketing & Sales Automation</h1><p>Kịch bản tự động chăm sóc, nhắc việc, gắn nhãn và chuyển giai đoạn theo sự kiện.</p></div>{canManage && <button className="suite-btn primary" onClick={createRule}>+ Kịch bản</button>}</div>
    <div className="suite-automation-list">{(full.automations || []).length ? (full.automations || []).map((r) => <article className="suite-panel suite-automation-row" key={r.id}><div className={`suite-automation-icon ${r.enabled ? "on" : ""}`}>⚡</div><div><b>{r.name}</b><p>Khi <strong>{EVENTS.find(([v]) => v === r.event_type)?.[1] || r.event_type}</strong></p><small>{Array.isArray(r.actions) ? r.actions.map((a) => ACTIONS.find(([v]) => v === a.type)?.[1] || a.type).join(" → ") : "Chưa cấu hình hành động"}</small></div><button className={`suite-switch ${r.enabled ? "on" : ""}`} onClick={() => toggle(r)}>{r.enabled ? "Đang bật" : "Đã tắt"}</button></article>) : <div className="suite-panel suite-empty suite-empty-large">Chưa có kịch bản. Tạo kịch bản đầu tiên để tự động hóa chăm sóc khách.</div>}</div>
  </div>;
}
