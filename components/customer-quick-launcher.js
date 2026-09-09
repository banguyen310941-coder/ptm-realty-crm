"use client";

import { useEffect, useMemo, useState } from "react";
import { coreRpc, fullRpc, SESSION_KEY } from "@/lib/crm-client";

const STATUS=[
  ["new","Khách mới"],
  ["contact","Đã liên hệ"],
  ["hot","Quan tâm"],
  ["visit","Đi xem"],
  ["deal","Chốt cọc"],
  ["lost","Không nhu cầu"]
];
const SOURCES=["Facebook","TikTok","Google","Website","Zalo","Giới thiệu","Sự kiện","Hotline","Walk-in","Khác"];
const EMPTY={name:"",phone:"",email:"",source:"Khác",status:"new",need:"",budget:"",notes:"",owner_id:""};

function phoneKey(v=""){return String(v).replace(/\D/g,"").replace(/^84/,"0")}
function emailKey(v=""){return String(v).trim().toLowerCase()}
function normalizeLead(l={}){return {id:l.id||"",name:l.name||"",phone:l.phone||"",email:l.email||"",source:l.source||"Khác",need:l.need||"",budget:l.budget||0,status:l.status||"new",project:l.project||"Thiên Phúc Vĩnh Hằng Viên",owner_id:l.owner_id||"",notes:l.notes||""}}

export default function CustomerQuickLauncher(){
  const[session,setSession]=useState(null);
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState("create");
  const[data,setData]=useState(null);
  const[draft,setDraft]=useState(EMPTY);
  const[selectedId,setSelectedId]=useState("");
  const[selectedStatus,setSelectedStatus]=useState("new");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");

  useEffect(()=>{const read=()=>{try{const raw=localStorage.getItem(SESSION_KEY);setSession(raw?JSON.parse(raw):null)}catch{setSession(null)}};read();const t=setInterval(read,1200);return()=>clearInterval(t)},[]);
  const role=session?.user?.role;
  const allowed=["admin","ceo","manager","marketing","sale"].includes(role);
  const sales=useMemo(()=>data?.users?.filter(u=>u.role==="sale"&&u.active!==false)||[],[data]);
  const selected=(data?.leads||[]).find(l=>l.id===selectedId);

  async function load(){if(!session?.token)return;setBusy(true);setError("");try{const out=await coreRpc(session.token,"bootstrap",{});setData(out);if(!selectedId&&out.leads?.[0]){setSelectedId(out.leads[0].id);setSelectedStatus(out.leads[0].status||"new")}}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function show(nextTab="create"){setTab(nextTab);setOpen(true);setError("");await load()}
  function close(){setOpen(false);setError("")}
  function pickLead(id){setSelectedId(id);const l=(data?.leads||[]).find(x=>x.id===id);setSelectedStatus(l?.status||"new")}

  async function createCustomer(e){e.preventDefault();setError("");if(!draft.name.trim()||!draft.phone.trim())return setError("Vui lòng nhập họ tên và số điện thoại.");const dup=(data?.leads||[]).find(l=>(phoneKey(draft.phone)&&phoneKey(l.phone)===phoneKey(draft.phone))||(draft.email&&emailKey(l.email)===emailKey(draft.email)));if(dup)return setError(`Khách đã tồn tại: ${dup.name} · ${dup.phone}`);setBusy(true);try{const payload={...draft,name:draft.name.trim(),phone:draft.phone.trim(),email:draft.email.trim(),project:"Thiên Phúc Vĩnh Hằng Viên",owner_id:role==="sale"?session.user.id:(draft.owner_id||"")};await coreRpc(session.token,"save_lead",payload);setDraft(EMPTY);window.dispatchEvent(new Event("ptm-crm-refresh"));await load();setTab("status")}catch(e2){setError(e2.message)}finally{setBusy(false)}}

  async function saveStatus(e){e.preventDefault();if(!selected)return;setBusy(true);setError("");try{await coreRpc(session.token,"save_lead",{...normalizeLead(selected),status:selectedStatus});try{await fullRpc(session.token,"activity.create",{lead_id:selected.id,activity_type:"status_change",subject:`Đổi tình trạng → ${STATUS.find(([v])=>v===selectedStatus)?.[1]||selectedStatus}`,content:"",outcome:"",next_action_at:""})}catch{}window.dispatchEvent(new Event("ptm-crm-refresh"));await load()}catch(e2){setError(e2.message)}finally{setBusy(false)}}

  if(!allowed)return null;
  return <>
    <button className="customer-quick-launcher" onClick={()=>show("create")} title="Nhập khách thủ công">+ Khách</button>
    {open&&<div className="customer-quick-overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><section className="customer-quick-modal"><header><div><span className="eyebrow">KHÁCH HÀNG THIÊN PHÚC</span><h2>Nhập khách & cập nhật tình trạng</h2></div><button type="button" onClick={close}>×</button></header>
      <div className="customer-quick-tabs"><button className={tab==="create"?"active":""} onClick={()=>setTab("create")}>+ Nhập khách thủ công</button><button className={tab==="status"?"active":""} onClick={()=>setTab("status")}>Đổi tình trạng khách</button></div>
      {error&&<div className="customer-form-error">{error}</div>}
      {tab==="create"?<form className="customer-form" onSubmit={createCustomer}><div className="customer-form-grid">
        <label>Họ tên *<input required autoFocus value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>Số điện thoại *<input required inputMode="tel" value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
        <label>Email<input type="email" value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})}/></label>
        <label>Nguồn khách<select value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value})}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Tình trạng khách<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>{STATUS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Ngân sách<input type="number" min="0" value={draft.budget} onChange={e=>setDraft({...draft,budget:e.target.value})}/></label>
        <label className="customer-form-wide">Nhu cầu<input value={draft.need} onChange={e=>setDraft({...draft,need:e.target.value})} placeholder="Mộ lẻ, mộ gia tộc, hướng, khu mong muốn..."/></label>
        {role!=="sale"&&sales.length>0&&<label className="customer-form-wide">Sale phụ trách<select value={draft.owner_id} onChange={e=>setDraft({...draft,owner_id:e.target.value})}><option value="">Chưa phân Sale</option>{sales.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        <label className="customer-form-wide">Ghi chú<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
      </div><div className="customer-form-actions"><button type="button" className="suite-btn" onClick={close}>Hủy</button><button className="suite-btn primary" disabled={busy}>{busy?"Đang lưu...":"Tạo khách hàng"}</button></div></form>
      :<form className="customer-status-quick-form" onSubmit={saveStatus}><label>Chọn khách hàng<select value={selectedId} onChange={e=>pickLead(e.target.value)}><option value="">Chọn khách</option>{(data?.leads||[]).map(l=><option key={l.id} value={l.id}>{l.name} · {l.phone}</option>)}</select></label>{selected&&<div className="customer-quick-current"><span>Hiện tại</span><b>{STATUS.find(([v])=>v===selected.status)?.[1]||selected.status}</b><small>{selected.owner_name||"Chưa phân Sale"}</small></div>}<label>Tình trạng mới<select value={selectedStatus} onChange={e=>setSelectedStatus(e.target.value)}>{STATUS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><div className="customer-form-actions"><button type="button" className="suite-btn" onClick={close}>Đóng</button><button className="suite-btn primary" disabled={!selected||busy}>{busy?"Đang lưu...":"Cập nhật tình trạng"}</button></div></form>}
    </section></div>}
  </>;
}
