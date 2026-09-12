"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FacebookAutomationPanel } from "@/components/crm-suite/facebook-automation";

function fmtTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
  }).format(date);
}

function displayName(item) {
  return item?.sender_name || item?.lead_name || ("Khách Facebook " + String(item?.psid || "").slice(-4));
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
    const error = new Error(data?.error || "Không kết nối được Fanpage.");
    error.code = data?.code || response.status;
    throw error;
  }
  return data;
}

export function FacebookInboxModule({ sessionToken }) {
  const [inbox,setInbox] = useState({ conversations:[], unread_total:0, runtime:null });
  const [selectedId,setSelectedId] = useState("");
  const [thread,setThread] = useState(null);
  const [reply,setReply] = useState("");
  const [loading,setLoading] = useState(true);
  const [sending,setSending] = useState(false);
  const [error,setError] = useState("");
  const [automationOpen,setAutomationOpen] = useState(false);
  const [aiReplyLoading,setAiReplyLoading] = useState(false);
  const [aiReplyNote,setAiReplyNote] = useState("");

  const selected = useMemo(
    () => inbox.conversations.find((item) => item.id === selectedId) || null,
    [inbox.conversations,selectedId]
  );

  const loadInbox = useCallback(async (quiet = false) => {
    if (!sessionToken) return;
    if (!quiet) setLoading(true);
    try {
      const data = await requestJson("/api/facebook/inbox", sessionToken);
      const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
      setInbox({ conversations, unread_total:Number(data?.unread_total || 0), runtime:data?.runtime || null });
      setSelectedId((current) => {
        if (current && conversations.some((item) => item.id === current)) return current;
        return conversations[0]?.id || "";
      });
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  },[sessionToken]);

  const loadThread = useCallback(async (conversationId, quiet = false) => {
    if (!sessionToken || !conversationId) {
      setThread(null);
      return;
    }
    try {
      const data = await requestJson(
        `/api/facebook/inbox?conversation_id=${encodeURIComponent(conversationId)}`,
        sessionToken
      );
      setThread(data);
      if (Number(data?.conversation?.unread_count || 0) > 0) {
        requestJson("/api/facebook/inbox", sessionToken, {
          method:"POST",
          body:JSON.stringify({ conversation_id:conversationId })
        }).catch(() => {});
      }
      if (!quiet) setError("");
    } catch (e) {
      setError(e.message);
    }
  },[sessionToken]);

  useEffect(() => {
    loadInbox();
    const timer = setInterval(() => loadInbox(true), 6000);
    return () => clearInterval(timer);
  },[loadInbox]);

  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      return;
    }
    loadThread(selectedId);
    const timer = setInterval(() => loadThread(selectedId,true), 4500);
    return () => clearInterval(timer);
  },[selectedId,loadThread]);

  async function suggestAiReply() {
    if (!selectedId || aiReplyLoading) return;
    setAiReplyLoading(true);
    setAiReplyNote("");
    setError("");
    try {
      const data = await requestJson("/api/facebook/ai-reply", sessionToken, {
        method:"POST",
        body:JSON.stringify({ conversation_id:selectedId })
      });
      setReply(String(data?.reply || ""));
      const notes = [data?.intent ? "Ý định: " + data.intent : "", data?.next_action ? "Bước tiếp: " + data.next_action : "", data?.caution ? "Lưu ý: " + data.caution : ""].filter(Boolean);
      setAiReplyNote(notes.join(" · "));
    } catch (e) {
      setError(e.message);
    } finally {
      setAiReplyLoading(false);
    }
  }

  async function setAutomationPause(paused) {
    if (!selectedId) return;
    setError("");
    try {
      await requestJson("/api/facebook/inbox", sessionToken, {
        method:"POST",
        body:JSON.stringify({
          conversation_id:selectedId,
          action:paused ? "pause_automation" : "resume_automation",
          minutes:480,
          reason:"manual_chat_control"
        })
      });
      await Promise.all([loadThread(selectedId,true),loadInbox(true)]);
    } catch (e) {
      setError(e.message);
    }
  }

  async function sendReply(e) {
    e?.preventDefault?.();
    const text = reply.trim();
    if (!text || !selectedId || sending) return;

    setSending(true);
    setError("");
    try {
      await requestJson("/api/facebook/send", sessionToken, {
        method:"POST",
        body:JSON.stringify({ conversation_id:selectedId, text })
      });
      setReply("");
      setAiReplyNote("");
      await Promise.all([loadThread(selectedId,true),loadInbox(true)]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const conversations = inbox.conversations || [];
  const runtime = inbox.runtime;
  const conv = thread?.conversation || selected;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];

  return <div className="suite-page facebook-inbox-page">
    <div className="suite-page-head">
      <div>
        <span className="eyebrow">META MESSENGER · CRM INBOX</span>
        <h1>Chat Fanpage</h1>
        <p>Nhận tin nhắn Facebook trực tiếp trong CRM, tự bắt số điện thoại và chuyển lead vào cơ chế phân Sale 10 phút.</p>
      </div>
      <div className="facebook-inbox-head-actions">
        <span className="suite-live">{Number(inbox.unread_total || 0)} chưa đọc</span>
        <button className="suite-btn primary" onClick={() => setAutomationOpen(true)}>⚡ Kịch bản & AI</button>
        <button className="suite-btn" onClick={() => loadInbox()} disabled={loading}>↻ Làm mới</button>
      </div>
    </div>

    {runtime && !runtime.configured && <div className="facebook-runtime-warning">
      <b>Chưa bật kết nối gửi/nhận Meta trên Vercel.</b>
      <span>Cần cấu hình App Secret và Page Access Token. Dữ liệu CRM và giao diện inbox đã sẵn sàng.</span>
    </div>}
    {runtime?.ai && !runtime.ai.configured && <div className="facebook-runtime-warning facebook-ai-warning">
      <b>AI Gateway chưa bật.</b>
      <span>Kịch bản cố định vẫn chạy bình thường; AI gợi ý chỉ hoạt động sau khi Vercel OIDC hoặc AI Gateway API key được cấu hình.</span>
    </div>}

    {error && <div className="suite-error-banner">{error}</div>}

    <div className="facebook-inbox-shell">
      <aside className="facebook-conversation-panel">
        <div className="facebook-list-head">
          <div><b>Hội thoại</b><span>{conversations.length} khách</span></div>
          {runtime?.graph_version && <small>Graph API {runtime.graph_version}</small>}
        </div>

        <div className="facebook-conversation-list">
          {loading && !conversations.length
            ? <div className="suite-empty">Đang tải hội thoại Fanpage…</div>
            : conversations.length
              ? conversations.map((item) => <button
                  key={item.id}
                  className={"facebook-conversation-item " + (selectedId === item.id ? "active" : "")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="facebook-avatar">f</span>
                  <span className="facebook-conversation-main">
                    <span className="facebook-name-line">
                      <b>{displayName(item)}</b>
                      <small>{fmtTime(item.last_message_at)}</small>
                    </span>
                    <span className="facebook-preview">{item.last_message_text || "Tin nhắn mới"}</span>
                    <span className="facebook-meta-line">
                      <em className={item.phone_detected || item.lead_phone ? "captured" : "waiting"}>
                        {item.phone_detected || item.lead_phone || "Chưa có SĐT"}
                      </em>
                      <em>{item.owner_name || (item.lead_id ? "Đang chờ Sale" : "Chưa tạo lead")}</em>
                    </span>
                  </span>
                  {Number(item.unread_count || 0) > 0 && <strong className="facebook-unread">{item.unread_count}</strong>}
                </button>)
              : <div className="suite-empty suite-empty-large">
                  Chưa có hội thoại. Khi Fanpage gửi webhook về CRM, tin nhắn sẽ xuất hiện tại đây.
                </div>}
        </div>
      </aside>

      <section className="facebook-thread-panel">
        {conv ? <>
          <header className="facebook-thread-head">
            <div>
              <b>{displayName(conv)}</b>
              <span>
                {conv.phone_detected || conv.lead_phone || "Đang chờ khách gửi số điện thoại"}
                {conv.owner_name ? " · Sale: " + conv.owner_name : ""}
              </span>
            </div>
            <div className="facebook-thread-tags">
              {conv.lead_id && <em>Đã vào CRM</em>}
              <em className={conv.within_24h ? "online" : "expired"}>
                {conv.within_24h ? "Trong 24h" : "Ngoài 24h"}
              </em>
              {conv.automation_paused && <em className="paused">Bot đang tạm dừng</em>}
            </div>
          </header>

          <div className="facebook-message-stream">
            {messages.length ? messages.map((message) => <div
              key={message.id}
              className={"facebook-message-row " + (message.direction === "outbound" ? "outbound" : "inbound")}
            >
              <div className="facebook-message-bubble">
                <p>{message.text_content || (message.message_type === "image" ? "[Hình ảnh]" : "[Tin nhắn đính kèm]")}</p>
                <small>{fmtTime(message.created_at)}</small>
              </div>
            </div>) : <div className="suite-empty suite-empty-large">Chưa có nội dung hội thoại.</div>}
          </div>

          <form className="facebook-composer" onSubmit={sendReply}>
            {!conv.within_24h && <div className="facebook-window-note">
              Meta đã đóng cửa sổ phản hồi 24 giờ. CRM khóa gửi tin thường để tránh lỗi/chặn từ Send API.
            </div>}
            <div className="facebook-ai-reply-row">
              <button
                className="suite-btn"
                type="button"
                onClick={suggestAiReply}
                disabled={!conv.within_24h || aiReplyLoading || runtime?.ai?.configured === false}
              >
                {aiReplyLoading ? "AI đang soạn…" : "✨ AI gợi ý trả lời"}
              </button>
              {aiReplyNote && <span>{aiReplyNote}</span>}
            </div>
            <div className="facebook-compose-row">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply(e);
                  }
                }}
                maxLength={2000}
                placeholder="Nhập nội dung trả lời khách…"
                disabled={!conv.within_24h || sending}
              />
              <button className="suite-btn primary" disabled={!reply.trim() || !conv.within_24h || sending}>
                {sending ? "Đang gửi…" : "Gửi"}
              </button>
            </div>
            <small>Enter để gửi · Shift + Enter để xuống dòng</small>
          </form>
        </> : <div className="facebook-no-thread">
          <span>f</span>
          <b>Inbox Fanpage trong CRM</b>
          <p>Chọn một hội thoại để xem và trả lời khách hàng.</p>
        </div>}
      </section>

      <aside className="facebook-customer-panel">
        {conv ? <>
          <div className="facebook-profile-card">
            <span className="facebook-profile-icon">◎</span>
            <b>{conv.lead_name || displayName(conv)}</b>
            <small>{conv.lead_phone || conv.phone_detected || "Chưa có số điện thoại"}</small>
          </div>
          <div className="facebook-customer-info">
            <div><span>Trạng thái CRM</span><b>{conv.lead_status || (conv.lead_id ? "new" : "Chờ SĐT")}</b></div>
            <div><span>Phụ trách</span><b>{conv.owner_name || (conv.lead_id ? "Đang phân Sale" : "Chưa phân")}</b></div>
            <div><span>Fanpage ID</span><b>{conv.page_id}</b></div>
            <div><span>Messenger PSID</span><b>{String(conv.psid || "").slice(-12)}</b></div>
            <div><span>Bot tự động</span><b>{conv.automation_paused ? "Đang tạm dừng" : "Đang cho phép"}</b></div>
          </div>
          <div className="facebook-bot-control">
            {conv.automation_paused ? <>
              <p>Sale đang tiếp quản hội thoại. Bot sẽ không tự trả lời cho tới khi hết thời gian tạm dừng.</p>
              <button className="suite-btn primary" type="button" onClick={() => setAutomationPause(false)}>▶ Bật lại bot</button>
            </> : <>
              <p>Khi Sale gửi tin thủ công, CRM tự tạm dừng bot 8 giờ để tránh trả lời chồng chéo.</p>
              <button className="suite-btn" type="button" onClick={() => setAutomationPause(true)}>⏸ Tạm dừng bot 8 giờ</button>
            </>}
          </div>
          <div className="facebook-auto-flow">
            <b>Tự động hóa đang áp dụng</b>
            <span>1. Nhận webhook Messenger</span>
            <span>2. Quét SĐT trong tin nhắn</span>
            <span>3. Ghép khách cũ hoặc tạo lead mới</span>
            <span>4. Kích hoạt phân Sale 10 phút</span>
            <span>5. Chạy kịch bản trả lời tự động</span>
            <span>6. Sale tiếp tục chăm sóc tại CRM</span>
          </div>
        </> : null}
      </aside>
    </div>

    <FacebookAutomationPanel
      open={automationOpen}
      onClose={() => setAutomationOpen(false)}
      sessionToken={sessionToken}
      conversationId={selectedId}
    />
  </div>;
}
