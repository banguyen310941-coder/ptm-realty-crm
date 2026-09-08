"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@neondatabase/neon-js";

const DB_URL = "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";
const client = createClient(DB_URL, { auth: { allowAnonymous: true } });
const SESSION_KEY = "ptm_crm_session_v3";

function unwrap(data) { return Array.isArray(data) ? data[0] : data; }

export default function LeadOfferAlert() {
  const [session, setSession] = useState(null);
  const [offers, setOffers] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const audioRef = useRef(null);
  const announcedRef = useRef(new Set());

  const active = offers[0] || null;
  const secondsLeft = useMemo(() => active ? Math.max(0, Math.ceil((new Date(active.expires_at).getTime() - now) / 1000)) : 0, [active, now]);

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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlock = () => enableAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!session?.token) { setOffers([]); return; }
    let stopped = false;
    const poll = async () => {
      try {
        await call("crm_lead_offer_tick", { p_token: session.token }, false);
        if (session.user?.role === "sale") {
          const out = await call("crm_my_lead_offers", { p_token: session.token }, false);
          if (!stopped) setOffers(out.offers || []);
        } else if (!stopped) setOffers([]);
      } catch (e) {
        if (!stopped && !/chưa được kích hoạt|schema cache|could not find/i.test(e.message || "")) setError(e.message);
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [session?.token, session?.user?.role]);

  useEffect(() => {
    if (!active?.offer_id) return;
    if (!announcedRef.current.has(active.offer_id)) {
      announcedRef.current.add(active.offer_id);
      ring();
      showSystemNotification(active);
    }
    const timer = setInterval(() => ring(), 12000);
    return () => clearInterval(timer);
  }, [active?.offer_id]);

  async function call(name, args, throwMissing = true) {
    const { data, error: rpcError } = await client.rpc(name, args);
    if (rpcError) {
      const message = rpcError.message || "Không kết nối được hệ thống phân lead.";
      if (!throwMissing && /schema cache|could not find|PGRST202/i.test(message)) throw new Error("Chức năng phân lead 10 phút chưa được kích hoạt trên database chính.");
      throw new Error(message);
    }
    const out = unwrap(data);
    if (!out?.ok) throw new Error(out?.error || "Thao tác thất bại");
    return out;
  }

  async function enableAudio() {
    try {
      if (!audioRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioRef.current = new AudioCtx();
      }
      if (audioRef.current.state === "suspended") await audioRef.current.resume();
      const ok = audioRef.current.state === "running";
      setAudioReady(ok);
      if (ok && active) ring();
    } catch {}
  }

  function ring() {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== "running") return;
    const start = ctx.currentTime + 0.02;
    [880, 1120, 880].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = start + index * 0.2;
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    });
  }

  function showSystemNotification(offer) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification("PTM CRM · Bạn có khách mới", {
        body: `${offer.name || "Lead mới"}${offer.project ? ` · ${offer.project}` : ""}. Nhận trong 10 phút.`,
        tag: `ptm-lead-${offer.offer_id}`,
        requireInteraction: true
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }

  async function enableSystemNotification() {
    if (typeof Notification === "undefined") return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted" && active) showSystemNotification(active);
    } catch {}
  }

  async function acceptOffer() {
    if (!active || !session?.token) return;
    setBusy(true); setError("");
    try {
      await enableAudio();
      await call("crm_accept_lead_offer", { p_token: session.token, p_offer_id: active.offer_id });
      announcedRef.current.delete(active.offer_id);
      setOffers((rows) => rows.filter((x) => x.offer_id !== active.offer_id));
      window.dispatchEvent(new Event("ptm-crm-refresh"));
    } catch (e) {
      setError(e.message);
      try {
        const out = await call("crm_my_lead_offers", { p_token: session.token });
        setOffers(out.offers || []);
      } catch {}
    } finally { setBusy(false); }
  }

  if (!session || session.user?.role !== "sale" || !active) return null;

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return <div className="lead-offer-overlay">
    <div className="lead-offer-card" role="alertdialog" aria-live="assertive">
      <div className="lead-offer-top">
        <div><span className="eyebrow">Lead mới được phân</span><h2>Bạn có khách mới</h2></div>
        <div className={`lead-countdown ${secondsLeft <= 120 ? "urgent" : ""}`}><span>Còn lại</span><strong>{mm}:{ss}</strong></div>
      </div>

      <div className="lead-offer-customer">
        <strong>{active.name}</strong>
        <a href={`tel:${active.phone}`}>{active.phone}</a>
        <span>{active.project || active.need || "Chưa có dự án"}</span>
      </div>

      <p className="lead-offer-rule">Nếu không bấm <b>Nhận khách</b> trong 10 phút, hệ thống sẽ tự thu hồi và chuyển cho Sale tiếp theo đang điểm danh.</p>
      {error && <div className="alert">{error}</div>}

      <div className="lead-offer-actions">
        {!audioReady && <button className="btn ghost" onClick={enableAudio}>🔔 Bật âm thanh</button>}
        {typeof Notification !== "undefined" && Notification.permission === "default" && <button className="btn ghost" onClick={enableSystemNotification}>Bật thông báo máy</button>}
        <button className="btn primary lead-accept" onClick={acceptOffer} disabled={busy || secondsLeft <= 0}>{busy ? "Đang nhận..." : "✓ Nhận khách"}</button>
      </div>
    </div>
  </div>;
}
