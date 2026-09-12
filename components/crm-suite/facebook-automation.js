"use client";

import { useCallback, useEffect, useState } from "react";

const TRIGGER_LABELS = {
  first_message:"Tin nhắn đầu tiên",
  keyword:"Có từ khóa",
  no_phone:"Chưa có SĐT",
  has_phone:"Đã có SĐT",
  always:"Mọi tin nhắn"
};

function emptyScenario() {
  return {
    id:"",
    name:"",
    trigger_type:"keyword",
    keywords:[],
    response_text:"",
    enabled:true,
    priority:50,
    cooldown_minutes:120
  };
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers:{
      ...(options.headers || {}),
      Authorization:`Bearer ${token}`,
      ...(options.body ? { "Content-Type":"application/json" } : {})
    },
    cache:"no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "Không xử lý được kịch bản.");
    error.code = data?.code || response.status;
    throw error;
  }
  return data;
}

export function FacebookAutomationPanel({ open, onClose, sessionToken, conversationId }) {
  const [scenarios,setScenarios] = useState([]);
  const [editing,setEditing] = useState(emptyScenario());
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [goal,setGoal] = useState("");
  const [aiLoading,setAiLoading] = useState(false);
  const [suggestions,setSuggestions] = useState([]);
  const [aiStatus,setAiStatus] = useState(null);

  const load = useCallback(async () => {
    if (!open || !sessionToken) return;
    setLoading(true);
    try {
      const [automation,ai] = await Promise.all([
        requestJson("/api/facebook/automation", sessionToken),
        requestJson("/api/facebook/ai-suggest", sessionToken).catch(() => ({ ai:null }))
      ]);
      setScenarios(Array.isArray(automation?.scenarios) ? automation.scenarios : []);
      setAiStatus(ai?.ai || null);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  },[open,sessionToken]);

  useEffect(() => { load(); },[load]);

  if (!open) return null;

  function edit(item) {
    setEditing({
      id:item?.id || "",
      name:item?.name || "",
      trigger_type:item?.trigger_type || "keyword",
      keywords:Array.isArray(item?.keywords) ? item.keywords : [],
      response_text:item?.response_text || "",
      enabled:item?.enabled !== false,
      priority:Number(item?.priority || 50),
      cooldown_minutes:Number(item?.cooldown_minutes || 120)
    });
  }

  async function save(e) {
    e?.preventDefault?.();
    if (!editing.name.trim() || !editing.response_text.trim()) return;
    setSaving(true);
    try {
      await requestJson("/api/facebook/automation", sessionToken, {
        method:"POST",
        body:JSON.stringify({ action:"save", payload:editing })
      });
      setEditing(emptyScenario());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item) {
    try {
      await requestJson("/api/facebook/automation", sessionToken, {
        method:"POST",
        body:JSON.stringify({ action:"toggle", payload:{ id:item.id, enabled:!item.enabled } })
      });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function remove(item) {
    if (!window.confirm(`Xóa kịch bản “${item.name}”? `)) return;
    try {
      await requestJson("/api/facebook/automation", sessionToken, {
        method:"POST",
        body:JSON.stringify({ action:"delete", payload:{ id:item.id } })
      });
      if (editing.id === item.id) setEditing(emptyScenario());
      await load();
    } catch (e) { setError(e.message); }
  }

  async function askAi() {
    setAiLoading(true);
    setSuggestions([]);
    setError("");
    try {
      const data = await requestJson("/api/facebook/ai-suggest", sessionToken, {
        method:"POST",
        body:JSON.stringify({ goal, conversation_id:conversationId || "" })
      });
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setAiStatus({ configured:true, model:data?.ai?.model || aiStatus?.model || "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  return <div className="facebook-automation-overlay" onMouseDown={(e) => {
    if (e.target === e.currentTarget) onClose?.();
  }}>
    <div className="facebook-automation-modal">
      <header className="facebook-automation-head">
        <div>
          <span className="eyebrow">MESSENGER AUTOMATION</span>
          <h2>Kịch bản trả lời tự động</h2>
          <p>Kịch bản đã bật có thể tự gửi khi tin nhắn khách thỏa điều kiện. AI chỉ đề xuất, không tự bật.</p>
        </div>
        <button className="suite-btn" onClick={onClose}>Đóng</button>
      </header>

      {error && <div className="suite-error-banner">{error}</div>}

      <div className="facebook-automation-grid">
        <section className="facebook-scenario-list-panel">
          <div className="facebook-automation-section-head">
            <div><b>Kịch bản đang có</b><span>{scenarios.length} kịch bản</span></div>
            <button className="suite-btn" onClick={() => setEditing(emptyScenario())}>+ Mới</button>
          </div>
          <div className="facebook-scenario-list">
            {loading ? <div className="suite-empty">Đang tải…</div> : scenarios.map((item) => <div className="facebook-scenario-card" key={item.id}>
              <div className="facebook-scenario-title">
                <div>
                  <b>{item.name}</b>
                  <span>{TRIGGER_LABELS[item.trigger_type] || item.trigger_type} · ưu tiên {item.priority}</span>
                </div>
                <button className={"facebook-switch " + (item.enabled ? "on" : "")} onClick={() => toggle(item)} type="button">
                  {item.enabled ? "Bật" : "Tắt"}
                </button>
              </div>
              <p>{item.response_text}</p>
              {Array.isArray(item.keywords) && item.keywords.length > 0 && <div className="facebook-keyword-row">
                {item.keywords.slice(0,8).map((k) => <em key={k}>{k}</em>)}
              </div>}
              <div className="facebook-scenario-actions">
                <button onClick={() => edit(item)} type="button">Sửa</button>
                <button onClick={() => remove(item)} type="button">Xóa</button>
              </div>
            </div>)}
          </div>
        </section>

        <section className="facebook-scenario-editor">
          <div className="facebook-automation-section-head">
            <div><b>{editing.id ? "Sửa kịch bản" : "Tạo kịch bản"}</b><span>Kịch bản cố định, có thể tự gửi</span></div>
          </div>
          <form onSubmit={save} className="facebook-scenario-form">
            <label>Tên kịch bản<input value={editing.name} onChange={(e) => setEditing({ ...editing, name:e.target.value })} placeholder="Ví dụ: Hỏi giá" /></label>
            <label>Điều kiện<select value={editing.trigger_type} onChange={(e) => setEditing({ ...editing, trigger_type:e.target.value })}>
              {Object.entries(TRIGGER_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            {editing.trigger_type === "keyword" && <label>Từ khóa<input
              value={(editing.keywords || []).join(", ")}
              onChange={(e) => setEditing({ ...editing, keywords:e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              placeholder="giá, bao nhiêu, chi phí"
            /></label>}
            <label>Nội dung tự trả lời<textarea value={editing.response_text} onChange={(e) => setEditing({ ...editing, response_text:e.target.value })} rows={6} maxLength={5000} /></label>
            <div className="facebook-form-two">
              <label>Ưu tiên<input type="number" min="1" max="9999" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority:Number(e.target.value) })} /></label>
              <label>Cooldown (phút)<input type="number" min="0" max="10080" value={editing.cooldown_minutes} onChange={(e) => setEditing({ ...editing, cooldown_minutes:Number(e.target.value) })} /></label>
            </div>
            <label className="facebook-check"><input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled:e.target.checked })} /> Bật ngay sau khi lưu</label>
            <div className="facebook-form-actions">
              <button className="suite-btn primary" disabled={saving || !editing.name.trim() || !editing.response_text.trim()}>{saving ? "Đang lưu…" : "Lưu kịch bản"}</button>
              {editing.id && <button className="suite-btn" type="button" onClick={() => setEditing(emptyScenario())}>Hủy sửa</button>}
            </div>
          </form>
        </section>

        <section className="facebook-ai-scenario-panel">
          <div className="facebook-automation-section-head">
            <div>
              <b>✨ AI đề xuất</b>
              <span>{aiStatus?.configured ? (aiStatus.model || "AI Gateway sẵn sàng") : "AI Gateway chưa sẵn sàng"}</span>
            </div>
          </div>
          <p className="facebook-ai-note">AI dựa trên mục tiêu, các kịch bản hiện tại và hội thoại đang chọn để đề xuất. Kịch bản chỉ được dùng khi bạn bấm chọn và lưu.</p>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            placeholder="Ví dụ: Tạo kịch bản cho khách hỏi giá, khách chưa để SĐT và khách muốn xem vị trí."
          />
          <button className="suite-btn primary" type="button" onClick={askAi} disabled={aiLoading}>
            {aiLoading ? "AI đang đề xuất…" : "✨ Đề xuất 3 kịch bản"}
          </button>
          <div className="facebook-ai-suggestions">
            {suggestions.map((item,index) => <article key={index}>
              <div><b>{item.name}</b><em>{TRIGGER_LABELS[item.trigger_type] || item.trigger_type}</em></div>
              <p>{item.response_text}</p>
              {item.rationale && <small>{item.rationale}</small>}
              <button className="suite-btn" type="button" onClick={() => {
                setEditing({
                  id:"",
                  name:item.name,
                  trigger_type:item.trigger_type,
                  keywords:item.keywords || [],
                  response_text:item.response_text,
                  enabled:false,
                  priority:item.priority || 50,
                  cooldown_minutes:item.cooldown_minutes || 120
                });
              }}>Dùng đề xuất này</button>
            </article>)}
          </div>
        </section>
      </div>
    </div>
  </div>;
}
