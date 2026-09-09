"use client";

import { useState } from "react";
import { cemeteryRpc, compactMoney, fmtDate, SESSION_KEY } from "@/lib/crm-client";

const STAGES = [
  ["qualify", "Đánh giá", 10], ["consult", "Tư vấn", 25], ["visit", "Đi xem", 45], ["booking", "Giữ chỗ", 65],
  ["deposit", "Đặt cọc", 80], ["contract", "Hợp đồng", 90], ["won", "Thành công", 100], ["lost", "Thất bại", 0]
];

const EMPTY_FORM={id:"",name:"Tư vấn Thiên Phúc",lead_id:"",plot_code:"",property_id:"",owner_id:"",stage:"qualify",status:"open",value:"",probability:10,expected_close_date:"",notes:""};

function fallbackCemeteryAction(action, payload) {
  let token = "";
  try { token = JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.token || ""; } catch {}
  if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  return cemeteryRpc(token, action, payload);
}

function codeFromName(name=""){return String(name).replace(/^Mộ phần\s+/i,"").replace(/^Mộ\s+/i,"").trim()}

export function OpportunitiesModule({ data, full, permissions, fullMutate, cemeteryAction }) {
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState("");
  const [modal,setModal]=useState(null);
  const [plot,setPlot]=useState(null);
  const [checking,setChecking]=useState(false);
  const opportunities = full.opportunities || [];
  const canManage = ["admin", "ceo", "manager", "sale"].includes(data.user.role);
  const cemetery = cemeteryAction || fallbackCemeteryAction;

  function openCreate(){
    const first=(data.leads||[])[0];
    setPlot(null);setError("");
    setModal({...EMPTY_FORM,lead_id:first?.id||"",owner_id:first?.owner_id||data.user.id});
  }
  function openEdit(item){
    if(!canManage)return;
    setPlot(null);setError("");
    setModal({...EMPTY_FORM,...item,plot_code:codeFromName(item.property_name||""),property_id:item.property_id||"",owner_id:item.owner_id||data.user.id,value:item.value??"",probability:item.probability??10,notes:item.notes||""});
  }
  function onLeadChange(id){
    const lead=(data.leads||[]).find(l=>l.id===id);
    setModal(m=>({...m,lead_id:id,owner_id:lead?.owner_id||data.user.id,value:Number(m?.value||0)>0?m.value:(lead?.budget||"")}));
  }
  async function checkPlot(){
    const code=String(modal?.plot_code||"").trim();
    if(!code){setPlot(null);setModal(m=>({...m,property_id:""}));return;}
    setChecking(true);setError("");
    try{
      const out=await cemetery("detail",{code});
      if(!out.plot)throw new Error(`Không tìm thấy mã mộ ${code}.`);
      setPlot(out.plot);
      setModal(m=>({...m,property_id:out.plot.id,value:Number(m?.value||0)>0?m.value:Number(out.plot.price_before_vat||0)}));
    }catch(e){setPlot(null);setModal(m=>({...m,property_id:""}));setError(e?.message||"Không thể kiểm tra mã mộ.")}
    finally{setChecking(false)}
  }
  async function submit(e){
    e.preventDefault();setError("");
    try{
      const lead=(data.leads||[]).find(l=>l.id===modal.lead_id);
      if(!lead)throw new Error("Vui lòng chọn khách hàng.");
      let propertyId=modal.property_id||"";
      if(String(modal.plot_code||"").trim()&&!propertyId){
        const out=await cemetery("detail",{code:String(modal.plot_code).trim()});
        if(!out.plot)throw new Error(`Không tìm thấy mã mộ ${modal.plot_code}.`);
        propertyId=out.plot.id;
      }
      const stageInfo=STAGES.find(([s])=>s===modal.stage);
      const status=modal.stage==="won"?"won":modal.stage==="lost"?"lost":"open";
      await fullMutate("opportunity.save",{
        ...(modal.id?modal:{}),
        name:String(modal.name||"").trim(),lead_id:lead.id,property_id:propertyId,owner_id:modal.owner_id||lead.owner_id||data.user.id,
        stage:modal.stage||"qualify",status,value:Number(modal.value||0),probability:Math.max(0,Math.min(100,Number(modal.probability??stageInfo?.[2]??10))),
        expected_close_date:modal.expected_close_date||"",notes:modal.notes||""
      });
      setModal(null);setPlot(null);
    }catch(e2){setError(e2?.message||"Không thể lưu cơ hội.")}
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

  return <div className="suite-page">
    <div className="suite-page-head"><div><h1>Cơ hội & Pipeline</h1><p>Kanban bán hàng từ đánh giá nhu cầu đến hợp đồng và thành công. Mộ phần được tra trực tiếp từ giỏ 9.392 mã.</p></div>{canManage && <button className="suite-btn primary" onClick={openCreate}>+ Cơ hội</button>}</div>
    {error && <div className="suite-error-banner">{error}</div>}
    <div className="suite-pipeline">{STAGES.map(([stage, label]) => {
      const rows = opportunities.filter((o) => o.stage === stage);
      const total = rows.reduce((s, o) => s + Number(o.value || 0), 0);
      return <section key={stage} className="suite-pipeline-col" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) move(dragId, stage); setDragId(null); }}>
        <div className="suite-pipeline-head"><div><b>{label}</b><span>{rows.length}</span></div><small>{permissions.finance_view ? compactMoney(total) : "Ẩn giá trị"}</small></div>
        <div className="suite-pipeline-cards">{rows.map((o) => <article key={o.id} draggable={canManage} onDragStart={() => setDragId(o.id)} onClick={() => openEdit(o)} className="suite-opportunity-card">
          <div className="suite-op-top"><b>{o.name}</b><span>{o.probability}%</span></div><p>{o.lead_name || "Chưa gắn khách"}</p><small>{o.property_name ? o.property_name.replace(/^Mộ phần\s+/i, "Mộ ") : "Chưa chọn mộ phần"}</small>{permissions.finance_view && <strong>{compactMoney(o.value)}</strong>}<footer><span>{o.owner_name || "—"}</span><span>{fmtDate(o.expected_close_date)}</span></footer>
        </article>)}</div>
      </section>;
    })}</div>
    {modal&&<div className="customer-modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&setModal(null)}><section className="customer-modal"><header><div><span className="eyebrow">PIPELINE THIÊN PHÚC</span><h2>{modal.id?"Cập nhật cơ hội":"Tạo cơ hội mới"}</h2></div><button className="customer-modal-close" type="button" onClick={()=>setModal(null)}>×</button></header><form className="customer-form" onSubmit={submit}><div className="customer-form-grid">
      <label>Tên cơ hội <span className="customer-required">*</span><input autoFocus required value={modal.name} onChange={e=>setModal({...modal,name:e.target.value})}/></label>
      <label>Khách hàng <span className="customer-required">*</span><select required value={modal.lead_id} onChange={e=>onLeadChange(e.target.value)}><option value="">Chọn khách hàng</option>{(data.leads||[]).map(l=><option key={l.id} value={l.id}>{l.name} · {l.phone}</option>)}</select></label>
      <label>Mã mộ phần<input value={modal.plot_code} onChange={e=>{setModal({...modal,plot_code:e.target.value,property_id:""});setPlot(null)}} placeholder="Có thể để trống"/><span className="customer-helper">Nhập mã và bấm kiểm tra để gắn đúng mộ phần.</span></label>
      <label>Kiểm tra mộ phần<button type="button" className="suite-btn" onClick={checkPlot} disabled={checking}>{checking?"Đang kiểm tra...":"Kiểm tra mã mộ"}</button></label>
      <label>Giai đoạn<select value={modal.stage} onChange={e=>{const info=STAGES.find(([s])=>s===e.target.value);setModal({...modal,stage:e.target.value,probability:info?.[2]??modal.probability})}}>{STAGES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Xác suất (%)<input type="number" min="0" max="100" value={modal.probability} onChange={e=>setModal({...modal,probability:e.target.value})}/></label>
      <label>Giá trị cơ hội (VND)<input type="number" min="0" value={modal.value} onChange={e=>setModal({...modal,value:e.target.value})}/></label>
      <label>Ngày dự kiến chốt<input type="date" value={modal.expected_close_date||""} onChange={e=>setModal({...modal,expected_close_date:e.target.value})}/></label>
      <label className="customer-form-wide">Ghi chú<textarea value={modal.notes||""} onChange={e=>setModal({...modal,notes:e.target.value})} placeholder="Nhu cầu, vị trí quan tâm, bước tiếp theo..."/></label>
    </div>{plot&&<div className="cemetery-selected-plot"><div><span>Mã mộ</span><b>{plot.code}</b></div><div><span>Vị trí</span><b>{plot.cemetery_zone||"—"} / {plot.cemetery_subzone||"—"} / {plot.cemetery_row||"—"}</b></div><div><span>Loại</span><b>{plot.property_type||"—"}</b></div><div><span>Giá</span><b>{Number(plot.price_before_vat||0)>0?compactMoney(plot.price_before_vat):"Chưa có giá"}</b></div></div>}{error&&<div className="customer-form-error">{error}</div>}<div className="customer-form-actions"><button type="button" className="suite-btn" onClick={()=>setModal(null)}>Hủy</button><button className="suite-btn primary">Lưu cơ hội</button></div></form></section></div>}
  </div>;
}
