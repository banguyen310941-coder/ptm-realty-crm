"use client";

import { useState } from "react";
import { cemeteryRpc, compactMoney, fmtDate, SESSION_KEY } from "@/lib/crm-client";

const STAGES = [
  ["qualify", "Đánh giá", 10], ["consult", "Tư vấn", 25], ["visit", "Đi xem", 45], ["booking", "Giữ chỗ", 65],
  ["deposit", "Đặt cọc", 80], ["contract", "Hợp đồng", 90], ["won", "Thành công", 100], ["lost", "Thất bại", 0]
];

function chooseLead(rows, title) {
  if (!rows.length) return null;
  const text = rows.slice(0, 50).map((x, i) => `${i + 1}. ${x.name}${x.phone ? ` · ${x.phone}` : ""}`).join("\n");
  const raw = prompt(`${title}:\n${text}`, "1");
  if (raw === null) return null;
  return rows[Number(raw) - 1] || null;
}

function fallbackCemeteryAction(action, payload) {
  let token = "";
  try { token = JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.token || ""; } catch {}
  if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  return cemeteryRpc(token, action, payload);
}

export function OpportunitiesModule({ data, full, permissions, fullMutate, cemeteryAction }) {
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState("");
  const opportunities = full.opportunities || [];
  const canManage = ["admin", "ceo", "manager", "sale"].includes(data.user.role);
  const cemetery = cemeteryAction || fallbackCemeteryAction;

  async function createOpportunity() {
    if (!canManage) return;
    setError("");
    try {
      const name = prompt("Tên cơ hội", "Tư vấn Thiên Phúc"); if (!name) return;
      const lead = chooseLead(data.leads || [], "Chọn khách hàng"); if (!lead) return;
      const code = prompt("Mã mộ phần (để trống nếu khách chưa chọn)", ""); if (code === null) return;
      let plot = null;
      if (code.trim()) {
        const out = await cemetery("detail", { code: code.trim() });
        plot = out.plot || null;
        if (!plot) throw new Error(`Không tìm thấy mã mộ ${code.trim()}.`);
      }
      const suggested = Number(plot?.price_before_vat || 0) || Number(lead.budget || 0);
      const value = prompt("Giá trị cơ hội (VND)", String(suggested)); if (value === null) return;
      const close = prompt("Ngày dự kiến chốt (YYYY-MM-DD, có thể để trống)", ""); if (close === null) return;
      await fullMutate("opportunity.save", {
        name: name.trim(), lead_id: lead.id, property_id: plot?.id || "", owner_id: lead.owner_id || data.user.id,
        stage: "qualify", status: "open", value: Number(value || 0), probability: 10, expected_close_date: close || "", notes: ""
      });
    } catch (e) { setError(e?.message || "Không thể tạo cơ hội."); }
  }

  async function move(id, stage) {
    const item = opportunities.find((o) => o.id === id); if (!item || !canManage) return;
    setError("");
    try {
      const stageInfo = STAGES.find(([s]) => s === stage);
      const status = stage === "won" ? "won" : stage === "lost" ? "lost" : "open";
      await fullMutate("opportunity.save", { ...item, stage, status, probability: stageInfo?.[2] ?? item.probability, owner_id: item.owner_id || data.user.id });
    } catch (e) { setError(e?.message || "Không thể chuyển giai đoạn."); }
  }

  async function edit(item) {
    if (!canManage) return;
    setError("");
    try {
      const value = prompt("Giá trị cơ hội", item.value ?? 0); if (value === null) return;
      const probability = prompt("Xác suất (%)", item.probability ?? 10); if (probability === null) return;
      const close = prompt("Ngày dự kiến chốt YYYY-MM-DD", item.expected_close_date || ""); if (close === null) return;
      const notes = prompt("Ghi chú", item.notes || ""); if (notes === null) return;
      const p = Math.max(0, Math.min(100, Number(probability || 0)));
      await fullMutate("opportunity.save", { ...item, value: Number(value || 0), probability: p, expected_close_date: close, notes, owner_id: item.owner_id || data.user.id });
    } catch (e) { setError(e?.message || "Không thể cập nhật cơ hội."); }
  }

  return <div className="suite-page">
    <div className="suite-page-head"><div><h1>Cơ hội & Pipeline</h1><p>Kanban bán hàng từ đánh giá nhu cầu đến hợp đồng và thành công. Mộ phần được tra trực tiếp từ giỏ 9.392 mã.</p></div>{canManage && <button className="suite-btn primary" onClick={createOpportunity}>+ Cơ hội</button>}</div>
    {error && <div className="suite-error-banner">{error}</div>}
    <div className="suite-pipeline">{STAGES.map(([stage, label]) => {
      const rows = opportunities.filter((o) => o.stage === stage);
      const total = rows.reduce((s, o) => s + Number(o.value || 0), 0);
      return <section key={stage} className="suite-pipeline-col" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) move(dragId, stage); setDragId(null); }}>
        <div className="suite-pipeline-head"><div><b>{label}</b><span>{rows.length}</span></div><small>{permissions.finance_view ? compactMoney(total) : "Ẩn giá trị"}</small></div>
        <div className="suite-pipeline-cards">{rows.map((o) => <article key={o.id} draggable={canManage} onDragStart={() => setDragId(o.id)} onClick={() => edit(o)} className="suite-opportunity-card">
          <div className="suite-op-top"><b>{o.name}</b><span>{o.probability}%</span></div><p>{o.lead_name || "Chưa gắn khách"}</p><small>{o.property_name ? o.property_name.replace(/^Mộ phần\s+/i, "Mộ ") : "Chưa chọn mộ phần"}</small>{permissions.finance_view && <strong>{compactMoney(o.value)}</strong>}<footer><span>{o.owner_name || "—"}</span><span>{fmtDate(o.expected_close_date)}</span></footer>
        </article>)}</div>
      </section>;
    })}</div>
  </div>;
}
