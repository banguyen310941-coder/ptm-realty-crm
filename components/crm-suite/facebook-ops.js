"use client";

import { useEffect, useMemo, useState } from "react";

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
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Không xử lý được cấu hình Fanpage.");
  return data;
}

function pct(value,total) {
  const a=Number(value||0), b=Number(total||0);
  return b>0 ? Math.round(a*1000/b)/10 : 0;
}

function pageLabel(page) {
  return page?.page_name || ("Fanpage " + String(page?.page_id || "").slice(-8));
}

export function FacebookOpsPanel({ open,onClose,sessionToken,ops,onRefresh }) {
  const [tab,setTab] = useState("report");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const [quick,setQuick] = useState({ id:"",title:"",reply_text:"",page_id:"",enabled:true,sort_order:100 });
  const [tagName,setTagName] = useState("");
  const [pageDrafts,setPageDrafts] = useState({});

  const canManage = ["ceo","admin","manager","marketing"].includes(ops?.role);
  const pages = Array.isArray(ops?.pages) ? ops.pages : [];
  const quickReplies = Array.isArray(ops?.quick_replies) ? ops.quick_replies : [];
  const tags = Array.isArray(ops?.tags) ? ops.tags : [];
  const report = ops?.report || {};

  useEffect(() => {
    if (!open) return;
    const next={};
    for (const page of pages) {
      next[page.page_id]={
        page_id:page.page_id,
        page_name:page.page_name || "",
        timezone:page.timezone || "Asia/Ho_Chi_Minh",
        business_days:Array.isArray(page.business_days) ? page.business_days.map(Number) : [1,2,3,4,5,6],
        business_start:String(page.business_start || "08:00").slice(0,5),
        business_end:String(page.business_end || "18:00").slice(0,5)
      };
    }
    setPageDrafts(next);
  },[open,ops?.pages]);

  const funnel = useMemo(() => [
    { key:"chat",label:"Chat",value:Number(report.chat||0) },
    { key:"phone",label:"Có SĐT",value:Number(report.phone||0) },
    { key:"lead",label:"Vào Lead",value:Number(report.lead||0) },
    { key:"assigned",label:"Đã phân Sale",value:Number(report.assigned||0) },
    { key:"deposit",label:"Cọc/Giao dịch",value:Number(report.deposit||0) }
  ],[report]);

  if (!open) return null;

  async function action(name,payload={}) {
    setSaving(true); setError("");
    try {
      await requestJson("/api/facebook/ops",sessionToken,{
        method:"POST",body:JSON.stringify({ action:name,payload })
      });
      await onRefresh?.();
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function saveQuick(e) {
    e.preventDefault();
    if (!quick.title.trim() || !quick.reply_text.trim()) return;
    await action("save_quick_reply",quick);
    setQuick({ id:"",title:"",reply_text:"",page_id:"",enabled:true,sort_order:100 });
  }

  async function saveTag(e) {
    e.preventDefault();
    if (!tagName.trim()) return;
    await action("save_tag",{ name:tagName.trim(),color:"#0f766e" });
    setTagName("");
  }

  function updatePage(pageId,patch) {
    setPageDrafts((current)=>({ ...current,[pageId]:{ ...current[pageId],...patch } }));
  }

  return <div className="facebook-ops-overlay" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose?.(); }}>
    <div className="facebook-ops-modal">
      <header className="facebook-automation-head">
        <div>
          <span className="eyebrow">FANPAGE OPERATIONS</span>
          <h2>Vận hành & Báo cáo</h2>
          <p>Quản lý phễu chuyển đổi, giờ làm việc, câu trả lời nhanh và nhãn khách.</p>
        </div>
        <button className="suite-btn" onClick={onClose}>Đóng</button>
      </header>

      <nav className="facebook-ops-tabs">
        <button className={tab==="report"?"active":""} onClick={()=>setTab("report")}>Báo cáo</button>
        <button className={tab==="pages"?"active":""} onClick={()=>setTab("pages")}>Fanpage & giờ làm</button>
        <button className={tab==="quick"?"active":""} onClick={()=>setTab("quick")}>Câu trả lời nhanh</button>
        <button className={tab==="tags"?"active":""} onClick={()=>setTab("tags")}>Nhãn khách</button>
      </nav>

      {error && <div className="suite-error-banner">{error}</div>}

      <div className="facebook-ops-body">
        {tab==="report" && <section className="facebook-report-panel">
          {report?.restricted ? <div className="suite-empty">Báo cáo tổng hợp dành cho quản lý/Marketing.</div> : <>
            <div className="facebook-report-summary">
              <div><span>30 ngày</span><b>{Number(report.chat||0)}</b><small>hội thoại</small></div>
              <div><span>Thu SĐT</span><b>{pct(report.phone,report.chat)}%</b><small>{Number(report.phone||0)} khách</small></div>
              <div><span>Phân Sale</span><b>{pct(report.assigned,report.lead)}%</b><small>{Number(report.assigned||0)} khách</small></div>
              <div><span>Chat → Cọc</span><b>{pct(report.deposit,report.chat)}%</b><small>{Number(report.deposit||0)} khách</small></div>
            </div>
            <div className="facebook-funnel">
              {funnel.map((item,index)=>{
                const max=Math.max(1,funnel[0]?.value||1);
                return <div className="facebook-funnel-row" key={item.key}>
                  <span>{index+1}. {item.label}</span>
                  <div><i style={{ width:`${Math.max(4,item.value*100/max)}%` }} /></div>
                  <b>{item.value}</b>
                  {index>0 && <em>{pct(item.value,funnel[index-1].value)}%</em>}
                </div>;
              })}
            </div>
            <div className="facebook-page-report">
              <h3>Theo Fanpage</h3>
              <div className="facebook-report-table">
                <div className="head"><span>Fanpage</span><span>Chat</span><span>SĐT</span><span>Lead</span><span>Sale</span><span>Cọc</span></div>
                {(report.by_page||[]).map((row)=><div key={row.page_id}>
                  <span>{pages.find((p)=>p.page_id===row.page_id)?.page_name || row.page_id}</span>
                  <span>{row.chat}</span><span>{row.phone}</span><span>{row.lead}</span><span>{row.assigned}</span><span>{row.deposit}</span>
                </div>)}
              </div>
            </div>
          </>}
        </section>}

        {tab==="pages" && <section className="facebook-page-settings">
          {!pages.length && <div className="suite-empty">Khi có hội thoại hoặc Fanpage kết nối, cấu hình sẽ xuất hiện tại đây.</div>}
          {pages.map((page)=>{
            const draft=pageDrafts[page.page_id] || page;
            return <article key={page.page_id}>
              <div className="facebook-page-settings-head"><div><b>{pageLabel(page)}</b><span>{page.page_id}</span></div></div>
              <label>Tên hiển thị<input disabled={!canManage} value={draft.page_name||""} onChange={(e)=>updatePage(page.page_id,{page_name:e.target.value})} /></label>
              <div className="facebook-form-two">
                <label>Bắt đầu<input disabled={!canManage} type="time" value={draft.business_start||"08:00"} onChange={(e)=>updatePage(page.page_id,{business_start:e.target.value})} /></label>
                <label>Kết thúc<input disabled={!canManage} type="time" value={draft.business_end||"18:00"} onChange={(e)=>updatePage(page.page_id,{business_end:e.target.value})} /></label>
              </div>
              <label>Múi giờ<input disabled={!canManage} value={draft.timezone||"Asia/Ho_Chi_Minh"} onChange={(e)=>updatePage(page.page_id,{timezone:e.target.value})} /></label>
              <div className="facebook-day-row">
                {[1,2,3,4,5,6,7].map((day)=>{
                  const selected=(draft.business_days||[]).includes(day);
                  return <button disabled={!canManage} type="button" className={selected?"active":""} key={day} onClick={()=>{
                    const days=selected ? draft.business_days.filter((x)=>x!==day) : [...draft.business_days,day].sort();
                    updatePage(page.page_id,{business_days:days});
                  }}>{day===7?"CN":"T"+(day+1)}</button>;
                })}
              </div>
              {canManage && <button disabled={saving} className="suite-btn primary" onClick={()=>action("save_page",draft)}>Lưu giờ Fanpage</button>}
            </article>;
          })}
        </section>}

        {tab==="quick" && <section className="facebook-quick-settings">
          {canManage && <form onSubmit={saveQuick} className="facebook-scenario-form">
            <label>Tên nút<input value={quick.title} onChange={(e)=>setQuick({...quick,title:e.target.value})} placeholder="Ví dụ: Gửi bảng giá" /></label>
            <label>Fanpage<select value={quick.page_id} onChange={(e)=>setQuick({...quick,page_id:e.target.value})}>
              <option value="">Tất cả Fanpage</option>
              {pages.map((p)=><option key={p.page_id} value={p.page_id}>{pageLabel(p)}</option>)}
            </select></label>
            <label>Nội dung<textarea rows={4} maxLength={2000} value={quick.reply_text} onChange={(e)=>setQuick({...quick,reply_text:e.target.value})} /></label>
            <div className="facebook-form-actions">
              <button className="suite-btn primary" disabled={saving}>Lưu câu trả lời</button>
              {quick.id && <button type="button" className="suite-btn" onClick={()=>setQuick({ id:"",title:"",reply_text:"",page_id:"",enabled:true,sort_order:100 })}>Hủy sửa</button>}
            </div>
          </form>}
          <div className="facebook-quick-list">
            {quickReplies.map((q)=><article key={q.id}>
              <div><b>{q.title}</b><span>{q.page_id ? (pages.find((p)=>p.page_id===q.page_id)?.page_name||q.page_id) : "Tất cả Fanpage"}</span></div>
              <p>{q.reply_text}</p>
              {canManage && <div>
                <button onClick={()=>setQuick({ ...q,page_id:q.page_id||"" })}>Sửa</button>
                <button onClick={()=>action("delete_quick_reply",{id:q.id})}>Xóa</button>
              </div>}
            </article>)}
          </div>
        </section>}

        {tab==="tags" && <section className="facebook-tag-settings">
          {canManage && <form onSubmit={saveTag} className="facebook-tag-create">
            <input value={tagName} onChange={(e)=>setTagName(e.target.value)} placeholder="Tên nhãn mới, ví dụ: Khách nóng" />
            <button className="suite-btn primary" disabled={saving || !tagName.trim()}>+ Tạo nhãn</button>
          </form>}
          <div className="facebook-tag-cloud">
            {tags.map((tag)=><span key={tag.id} style={{ borderColor:tag.color||"#0f766e" }}>{tag.name}</span>)}
            {!tags.length && <div className="suite-empty">Chưa có nhãn khách.</div>}
          </div>
        </section>}
      </div>
    </div>
  </div>;
}
