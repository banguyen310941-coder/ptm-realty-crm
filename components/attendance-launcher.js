"use client";

import { useEffect, useState } from "react";
import { client, SESSION_KEY } from "@/lib/crm-client";
import { roleLabel } from "@/lib/rbac";

function unwrap(data) { return Array.isArray(data) ? data[0] : data; }

async function compressImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const max = 1100;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL("image/jpeg", 0.68);
  if (out.length > 780000) out = canvas.toDataURL("image/jpeg", 0.5);
  return out;
}

export default function AttendanceLauncher() {
  const [session, setSession] = useState(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [team, setTeam] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("office");
  const [photo, setPhoto] = useState("");
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const read = () => {
      const raw = localStorage.getItem(SESSION_KEY);
      try { setSession(raw ? JSON.parse(raw) : null); } catch { setSession(null); }
    };
    read();
    const timer = setInterval(read, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (open && session?.token) refresh();
  }, [open, session?.token]);

  async function call(name, args) {
    const { data, error: rpcError } = await client.rpc(name, args);
    if (rpcError) throw new Error(rpcError.message || "Chức năng điểm danh chưa được kích hoạt trên database chính.");
    const out = unwrap(data);
    if (!out?.ok) throw new Error(out?.error || "Thao tác thất bại");
    return out;
  }

  async function refresh() {
    if (!session?.token) return;
    setBusy(true); setError("");
    try {
      const s = await call("crm_attendance_status", { p_token: session.token });
      setStatus(s);
      if (["admin", "ceo", "manager"].includes(session.user?.role)) {
        try {
          const t = await call("crm_team_attendance", { p_token: session.token });
          setTeam(t.employees || []);
        } catch { setTeam([]); }
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function checkIn() {
    setBusy(true); setError("");
    try {
      if (mode === "client_visit" && !photo) throw new Error("Ra ngoài gặp khách bắt buộc phải chụp ảnh điểm danh.");
      await call("crm_check_in", {
        p_token: session.token,
        p_work_mode: mode,
        p_evening_opt_in: false,
        p_photo_data: photo || null,
        p_client_name: clientName || null,
        p_note: note || null
      });
      setPhoto(""); setClientName(""); setNote("");
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function checkOut() {
    setBusy(true); setError("");
    try { await call("crm_check_out", { p_token: session.token }); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const value = await compressImage(file);
      if (value.length > 800000) throw new Error("Ảnh vẫn quá lớn sau khi nén. Hãy chụp lại ở độ phân giải thấp hơn.");
      setPhoto(value);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!session) return null;
  const attendance = status?.attendance;
  const isSale = session.user?.role === "sale";
  const outsideHours = status?.period === "evening";

  return <>
    <button className={`attendance-fab ${status?.eligible_for_leads ? "eligible" : ""}`} onClick={() => setOpen(true)}>
      ● Điểm danh
    </button>
    {open && <div className="attendance-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="attendance-card">
        <div className="attendance-head">
          <div><span className="eyebrow">Nhân sự & phân lead</span><h2>Điểm danh</h2><p>Trong giờ 08:30 - 17:30, Sale cần điểm danh hợp lệ. Ngoài giờ, toàn bộ Sale đang active được chia lead đều và vẫn có 10 phút để nhận.</p></div>
          <button className="attendance-close" onClick={() => setOpen(false)}>×</button>
        </div>

        {error && <div className="alert">{error}</div>}
        {status && <div className="attendance-status-grid">
          <div><span>Trạng thái</span><b>{attendance ? "Đã điểm danh" : "Chưa điểm danh"}</b></div>
          <div><span>Thời gian</span><b>{outsideHours ? "Ngoài giờ" : "08:30 - 17:30"}</b></div>
          <div><span>Nhận lead</span><b>{isSale ? (status.eligible_for_leads ? "Đủ điều kiện" : "Chưa đủ điều kiện") : "Không áp dụng"}</b></div>
        </div>}

        {outsideHours && isSale && <div className="suite-system-banner">Ngoài giờ: bạn vẫn nằm trong vòng chia lead dù chưa điểm danh hoặc đã check-out. Mỗi lead giữ nguyên thời hạn nhận 10 phút.</div>}

        {!attendance ? <div className="attendance-form">
          <label>Địa điểm làm việc<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="office">Tại văn phòng</option><option value="client_visit">Ra ngoài gặp khách</option></select></label>
          {mode === "client_visit" && <>
            <label>Tên khách đang gặp<input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ví dụ: Nguyễn Văn A" /></label>
            <label>Ảnh xác thực <input type="file" accept="image/*" capture="environment" onChange={onPhoto} /></label>
            {photo && <img className="attendance-preview" src={photo} alt="Ảnh điểm danh" />}
          </>}
          <label>Ghi chú<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" /></label>
          <button className="btn primary wide" onClick={checkIn} disabled={busy}>{busy ? "Đang xử lý..." : "Điểm danh vào ca"}</button>
        </div> : <div className="attendance-current">
          <p><b>{attendance.work_mode === "client_visit" ? "Đang gặp khách bên ngoài" : "Đang làm tại văn phòng"}</b></p>
          <p>{attendance.has_photo ? "Đã có ảnh xác thực · " : ""}{outsideHours ? "Ngoài giờ hệ thống chia lead đều cho mọi Sale active, không phụ thuộc check-out." : "Trong giờ, điểm danh này giúp Sale nằm trong vòng nhận lead."}</p>
          <button className="btn ghost wide" onClick={checkOut} disabled={busy}>Kết thúc ca / Check-out</button>
        </div>}

        {["admin", "ceo", "manager"].includes(session.user?.role) && <div className="attendance-team">
          <div className="panel-head"><div><h3>Điểm danh toàn công ty</h3><p>{outsideHours ? "Ngoài giờ: mọi Sale active đều đủ điều kiện nhận lead và được chia đều." : "Trong giờ: Sale chỉ nhận lead khi có điểm danh hợp lệ."}</p></div><button className="text-link" onClick={refresh}>Làm mới</button></div>
          <div className="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Điểm danh</th><th>Nhận lead</th></tr></thead><tbody>
            {team.map((u) => <tr key={u.id}><td><b>{u.name}</b>{u.client_name && <small>Gặp: {u.client_name}</small>}</td><td>{roleLabel(u.role)}</td><td>{u.check_in_at ? (u.work_mode === "client_visit" ? `Gặp khách${u.has_photo ? " · Có ảnh" : ""}` : "Văn phòng") : "Chưa vào ca"}</td><td><span className={`badge ${u.can_receive_lead ? "status-deal" : "status-lost"}`}>{u.can_receive_lead ? "Đủ điều kiện" : "Không"}</span></td></tr>)}
          </tbody></table></div>
        </div>}
      </div>
    </div>}
  </>;
}
