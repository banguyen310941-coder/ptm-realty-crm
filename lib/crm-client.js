"use client";

export const SESSION_KEY = "ptm_crm_session_v3"; // legacy key: cleared after migration to HttpOnly cookies.

function leadStatusCache(){
  if(typeof window==="undefined")return{};
  window.__ptmLeadStatuses=window.__ptmLeadStatuses||{};
  return window.__ptmLeadStatuses;
}

function cacheBootstrapLeadStatuses(out){
  if(typeof window==="undefined"||!Array.isArray(out?.leads))return;
  window.__ptmLeadStatuses=Object.fromEntries(out.leads.map(l=>[l.id,l.status]));
}

async function requestJson(url,options={}){
  const response=await fetch(url,{...options,credentials:"same-origin",cache:options.cache||"no-store"});
  const out=await response.json().catch(()=>({}));
  if(!response.ok||out?.ok===false){
    const error=new Error(out?.error||"Thao tác thất bại");
    error.code=out?.code||String(response.status);
    error.status=response.status;
    throw error;
  }
  return out;
}

async function moduleRpc(moduleName,action,payload={}){
  return requestJson("/api/crm/rpc",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ module:moduleName,action,payload })
  });
}

function notReady(error,name,message){
  if(error?.code==="PGRST202"||/schema cache|could not find the function/i.test(error?.message||"")){
    const out=new Error(message);
    out.code=name;
    return out;
  }
  return null;
}

export async function coreRpc(_token,action,payload={}){
  const previousStatus=typeof window!=="undefined"&&action==="save_lead"&&payload?.id?leadStatusCache()[payload.id]:undefined;
  const out=await moduleRpc("core",action,payload);

  if(typeof window!=="undefined"){
    if(action==="bootstrap")cacheBootstrapLeadStatuses(out);
    if(action==="save_lead"&&!payload?.id&&out?.id){
      leadStatusCache()[out.id]=payload?.status||"new";
      automationEvent("lead_created",{lead_id:out.id}).catch(()=>{});
      automationEvent("lead_assigned",{lead_id:out.id}).catch(()=>{});
    }
    if(action==="save_lead"&&payload?.id){
      const nextStatus=payload?.status||previousStatus;
      if(previousStatus&&nextStatus&&previousStatus!==nextStatus){
        automationEvent("lead_status_changed",{lead_id:payload.id,payload:{previous_status:previousStatus,status:nextStatus}}).catch(()=>{});
      }
      if(nextStatus)leadStatusCache()[payload.id]=nextStatus;
    }
    if(action==="delete_lead"&&payload?.id)delete leadStatusCache()[payload.id];
    if(action==="save_deal"&&payload?.stage==="completed"){
      automationEvent("deal_completed",{lead_id:payload?.lead_id||null,payload:{deal_id:out?.id||payload?.id||null,stage:"completed"}}).catch(()=>{});
    }
  }
  return out;
}

export async function fullRpc(_token,action,payload={}){
  try{
    const out=await moduleRpc("full",action,payload);
    if(typeof window!=="undefined"){
      if(action==="opportunity.save"){
        automationEvent("opportunity_stage_changed",{lead_id:payload?.lead_id||null,payload:{opportunity_id:out?.id||payload?.id||null,stage:payload?.stage||null,status:payload?.status||null}}).catch(()=>{});
      }
      if(action==="ticket.save"&&!payload?.id){
        automationEvent("ticket_created",{lead_id:payload?.lead_id||null,owner_id:payload?.assigned_to||null,payload:{ticket_id:out?.id||null,priority:payload?.priority||"normal"}}).catch(()=>{});
      }
    }
    return out;
  }catch(error){
    const mapped=notReady(error,"FULL_CRM_NOT_READY","CRM mở rộng chưa được kích hoạt trên database chính.");
    throw mapped||error;
  }
}

export async function financeRpc(_token,action,payload={}){
  try{return await moduleRpc("finance",action,payload)}
  catch(error){
    const mapped=notReady(error,"FINANCE_NOT_READY","Module Hợp đồng · Công nợ · Hoa hồng đang chờ kích hoạt database.");
    throw mapped||error;
  }
}

export async function inventoryRpc(_token,action,payload={}){
  try{return await moduleRpc("inventory",action,payload)}
  catch(error){
    const mapped=notReady(error,"INVENTORY_NOT_READY","Kho dự án nâng cao đang chờ kích hoạt database.");
    throw mapped||error;
  }
}

export async function cemeteryRpc(_token,action,payload={}){
  try{return await moduleRpc("cemetery",action,payload)}
  catch(error){
    const mapped=notReady(error,"CEMETERY_NOT_READY","Giỏ mộ phần Thiên Phúc chưa sẵn sàng.");
    throw mapped||error;
  }
}

export async function directRpc(action,payload={}){
  return requestJson("/api/crm/direct",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ action,payload })
  });
}

export async function loginRpc(email,password){
  return requestJson("/api/auth/login",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({email,password})
  });
}

export async function sessionRpc(){
  return requestJson("/api/auth/session",{ method:"GET",cache:"no-store" });
}

export async function logoutRpc(){
  return requestJson("/api/auth/logout",{ method:"POST" });
}

export async function automationEvent(eventType,payload={}){
  if(!eventType)return null;
  return requestJson("/api/automation/event",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({event_type:eventType,...payload})
  });
}

export async function automationSweep(){
  return requestJson("/api/automation/run",{ method:"POST" });
}

export async function integrationStatus(){
  return requestJson("/api/integrations/status",{ cache:"no-store" });
}

export function money(value){
  return new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(Number(value||0));
}
export function compactMoney(value){
  const n=Number(value||0);
  if(n>=1e9)return `${(n/1e9).toFixed(n%1e9?1:0)} tỷ`;
  if(n>=1e6)return `${Math.round(n/1e6)} tr`;
  return money(n);
}
export function fmtDate(value,withTime=false){
  if(!value)return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat("vi-VN",withTime
    ?{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Ho_Chi_Minh"}
    :{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Asia/Ho_Chi_Minh"}).format(d);
}
