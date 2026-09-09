"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SESSION_KEY, coreRpc, fullRpc, financeRpc, cemeteryRpc, loginRpc } from "@/lib/crm-client";
import { getPermissions, roleLabel } from "@/lib/rbac";
import { ExecutiveDashboard, ReportsModule } from "@/components/crm-suite/dashboard-reports";
import { CustomersModule } from "@/components/crm-suite/customers";
import { OpportunitiesModule, MarketingModule, AutomationModule } from "@/components/crm-suite/sales-marketing";
import { TicketsModule, TasksModule, CalendarModule, KpiModule, TeamModule } from "@/components/crm-suite/operations";
import { FinanceModule } from "@/components/crm-suite/finance";
import { ImportLeadsModule } from "@/components/crm-suite/inventory-import";
import { CemeteryInventoryModule } from "@/components/crm-suite/cemetery-inventory";
import { CemeteryDealsModule } from "@/components/crm-suite/cemetery-deals";

const EMPTY_FULL={lead_meta:[],tags:[],lead_tags:[],activities:[],opportunities:[],campaigns:[],tickets:[],kpis:[],automations:[],notifications:[]};
const EMPTY_FINANCE={contracts:[],payments:[],commissions:[],summary:{contract_value:0,receivable:0,overdue:0,commission_pending:0}};
const EMPTY_IMPORT_HISTORY={imports:[]};
const NAV=[
  {id:"dashboard",icon:"▦",label:"Tổng quan",group:"CRM"},{id:"customers",icon:"◎",label:"Khách hàng 360°",group:"CRM"},{id:"opportunities",icon:"◇",label:"Cơ hội & Pipeline",group:"CRM"},
  {id:"marketing",icon:"◈",label:"Marketing",group:"Tăng trưởng"},{id:"import",icon:"⇧",label:"Nhập khách Excel",group:"Tăng trưởng"},
  {id:"tasks",icon:"✓",label:"Công việc",group:"Vận hành"},{id:"calendar",icon:"□",label:"Lịch hẹn",group:"Vận hành"},{id:"tickets",icon:"◉",label:"Ticket CSKH",group:"Vận hành"},
  {id:"properties",icon:"▦",label:"Giỏ mộ phần",group:"Thiên Phúc"},{id:"deals",icon:"₫",label:"Giữ chỗ · Cọc · Giao dịch",group:"Thiên Phúc"},{id:"finance",icon:"▤",label:"Hợp đồng & Tài chính",group:"Thiên Phúc"},
  {id:"kpi",icon:"▲",label:"KPI",group:"Quản trị"},{id:"reports",icon:"▥",label:"Báo cáo",group:"Quản trị"},{id:"automation",icon:"⚡",label:"Automation",group:"Quản trị"},{id:"team",icon:"♟",label:"Đội ngũ",group:"Quản trị"}
];
function allowed(item,data,permissions){const role=data?.user?.role;if(item.id==="customers")return permissions.leads_view!==false;if(item.id==="opportunities")return permissions.deals_view!==false;if(item.id==="marketing"||item.id==="import")return ["admin","ceo","manager","marketing"].includes(role);if(item.id==="tasks"||item.id==="calendar")return permissions.tasks_view!==false;if(item.id==="tickets")return ["admin","ceo","manager","marketing","sale"].includes(role);if(item.id==="properties")return permissions.properties_view!==false;if(item.id==="deals")return permissions.deals_view!==false;if(item.id==="finance")return ["admin","ceo","manager","accounting","sale"].includes(role);if(item.id==="automation")return ["admin","ceo","manager","marketing"].includes(role);if(item.id==="team")return permissions.team_view!==false;return true;}

export default function FullCRMApp(){
  const[session,setSession]=useState(null),[data,setData]=useState(null),[full,setFull]=useState(EMPTY_FULL),[finance,setFinance]=useState(EMPTY_FINANCE);
  const[fullReady,setFullReady]=useState(true),[financeReady,setFinanceReady]=useState(true),[view,setView]=useState("dashboard"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const[login,setLogin]=useState({email:"admin@ptm.vn",password:""}),[noticeOpen,setNoticeOpen]=useState(false);
  const permissions=getPermissions(data||{user:session?.user});
  const visibleNav=useMemo(()=>NAV.filter(n=>data?allowed(n,data,permissions):true),[data,permissions]);
  const unread=(full.notifications||[]).filter(n=>!n.read_at).length;
  const cemeteryAction=useCallback((action,payload={})=>cemeteryRpc(session?.token,action,payload),[session?.token]);

  useEffect(()=>{const raw=localStorage.getItem(SESSION_KEY);if(!raw)return;try{const s=JSON.parse(raw);setSession(s);load(s.token);}catch{localStorage.removeItem(SESSION_KEY)}},[]);
  useEffect(()=>{const refresh=()=>session?.token&&load(session.token,true);window.addEventListener("ptm-crm-refresh",refresh);return()=>window.removeEventListener("ptm-crm-refresh",refresh)},[session?.token]);
  useEffect(()=>{if(data&&!visibleNav.some(n=>n.id===view))setView("dashboard")},[data,visibleNav,view]);

  async function load(token=session?.token,quiet=false){
    if(!token)return;if(!quiet)setBusy(true);setError("");
    try{
      const core=await coreRpc(token,"bootstrap",{});setData(core);
      try{const extended=await fullRpc(token,"bootstrap",{});setFull({...EMPTY_FULL,...extended});setFullReady(true)}catch(e){if(e.code==="FULL_CRM_NOT_READY"||/chưa được kích hoạt/i.test(e.message)){setFull(EMPTY_FULL);setFullReady(false)}else throw e}
      if(core.user?.role!=="marketing"){
        try{const f=await financeRpc(token,"bootstrap",{});setFinance({...EMPTY_FINANCE,...f,summary:{...EMPTY_FINANCE.summary,...(f.summary||{})}});setFinanceReady(true)}catch(e){if(e.code==="FINANCE_NOT_READY"||/chờ kích hoạt database/i.test(e.message)){setFinance(EMPTY_FINANCE);setFinanceReady(false)}else throw e}
      }else{setFinance(EMPTY_FINANCE);setFinanceReady(true)}
    }catch(e){setError(e.message);if(/hết hạn|UNAUTHENTICATED/i.test(e.message)){localStorage.removeItem(SESSION_KEY);setSession(null);setData(null);setFull(EMPTY_FULL);setFinance(EMPTY_FINANCE)}}finally{if(!quiet)setBusy(false)}
  }
  async function signIn(e){e.preventDefault();setBusy(true);setError("");try{const out=await loginRpc(login.email,login.password);const s={token:out.token,user:out.user};localStorage.setItem(SESSION_KEY,JSON.stringify(s));setSession(s);await load(out.token)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function signOut(){try{await coreRpc(session?.token,"logout",{})}catch{}localStorage.removeItem(SESSION_KEY);setSession(null);setData(null);setFull(EMPTY_FULL);setFinance(EMPTY_FINANCE);setView("dashboard")}
  async function coreMutate(action,payload={}){setBusy(true);setError("");try{const out=await coreRpc(session?.token,action,payload);await load(session?.token,true);return out}catch(e){setError(e.message);throw e}finally{setBusy(false)}}
  async function fullMutate(action,payload={}){setBusy(true);setError("");try{const out=await fullRpc(session?.token,action,payload);await load(session?.token,true);return out}catch(e){setError(e.message);throw e}finally{setBusy(false)}}
  async function financeMutate(action,payload={}){setBusy(true);setError("");try{const out=await financeRpc(session?.token,action,payload);await load(session?.token,true);return out}catch(e){setError(e.message);throw e}finally{setBusy(false)}}
  async function bulkImportLeads(rows,onProgress){let success=0;const failed=[];for(let i=0;i<rows.length;i++){const r=rows[i];try{await coreRpc(session?.token,"save_lead",{name:r.name,phone:r.phone,email:r.email||"",source:r.source||"Khác",project:r.project||"Thiên Phúc Vĩnh Hằng Viên",need:r.need||"",budget:r.budget||0,status:r.status||"new",notes:r.notes||"",owner_id:""});success++}catch(e){failed.push({row:r.row,error:e.message})}onProgress?.(i+1,rows.length)}await load(session?.token,true);return{success,failed}}
  async function readNotification(n){if(n.read_at||!fullReady)return;try{await fullRpc(session?.token,"notification.read",{id:n.id});await load(session?.token,true)}catch{}}

  if(!session)return <LoginScreen login={login} setLogin={setLogin} signIn={signIn} busy={busy} error={error}/>;
  if(!data)return <div className="suite-loading"><div className="brand-mark">PTM</div><b>PTM CRM</b><p>{error||"Đang tải dữ liệu doanh nghiệp..."}</p><button className="suite-btn primary" onClick={()=>load()}>Tải lại</button></div>;
  const groups=[...new Set(visibleNav.map(n=>n.group))];
  return <div className="suite-shell"><aside className="suite-sidebar"><div className="suite-brand"><div className="brand-mark">PTM</div><div><b>Phúc Trường Minh</b><span>Thiên Phúc CRM</span></div></div><div className="suite-menu">{groups.map(group=><div key={group} className="suite-menu-group"><small>{group}</small>{visibleNav.filter(n=>n.group===group).map(n=><button key={n.id} className={view===n.id?"active":""} onClick={()=>setView(n.id)}><i>{n.icon}</i><span>{n.label}</span></button>)}</div>)}</div><div className="suite-sidebar-user"><div className="suite-avatar">{data.user.name.slice(0,2).toUpperCase()}</div><div><b>{data.user.name}</b><span>{roleLabel(data.user.role)}</span></div><button onClick={signOut}>↪</button></div></aside>
  <main className="suite-main"><header className="suite-topbar"><div><span className="eyebrow">THIÊN PHÚC VĨNH HẰNG VIÊN</span><b>{NAV.find(n=>n.id===view)?.label}</b></div><div className="suite-top-actions"><button className="suite-icon-btn" onClick={()=>load()} title="Làm mới">↻</button><div className="suite-notification"><button className="suite-icon-btn" onClick={()=>setNoticeOpen(!noticeOpen)}>♢{unread>0&&<em>{unread}</em>}</button>{noticeOpen&&<div className="suite-notification-pop"><header><b>Thông báo</b><span>{unread} chưa đọc</span></header>{(full.notifications||[]).length?(full.notifications||[]).slice(0,15).map(n=><button key={n.id} className={n.read_at?"":"unread"} onClick={()=>readNotification(n)}><b>{n.title}</b><span>{n.body||""}</span><small>{new Date(n.created_at).toLocaleString("vi-VN")}</small></button>):<div className="suite-empty">Chưa có thông báo.</div>}</div>}</div><div className="suite-user-chip"><span>{data.user.name}</span><small>{roleLabel(data.user.role)}</small></div></div></header>
  {!fullReady&&<div className="suite-system-banner">CRM lõi đang hoạt động. Một số module mở rộng đang chờ kích hoạt database.</div>}{error&&<div className="suite-error-banner">{error}</div>}{busy&&<div className="suite-sync">Đang đồng bộ…</div>}
  <section className="suite-content">{view==="dashboard"&&<ExecutiveDashboard data={data} full={full} permissions={permissions}/>} {view==="customers"&&<CustomersModule data={data} full={full} permissions={permissions} coreMutate={coreMutate} fullMutate={fullMutate}/>} {view==="opportunities"&&<OpportunitiesModule data={data} full={full} permissions={permissions} fullMutate={fullMutate}/>} {view==="marketing"&&<MarketingModule data={data} full={full} fullMutate={fullMutate}/>} {view==="import"&&<ImportLeadsModule data={data} inventory={EMPTY_IMPORT_HISTORY} inventoryReady={false} inventoryMutate={async()=>({})} bulkImportLeads={bulkImportLeads}/>} {view==="tasks"&&<TasksModule data={data} coreMutate={coreMutate}/>} {view==="calendar"&&<CalendarModule data={data} full={full}/>} {view==="tickets"&&<TicketsModule data={data} full={full} fullMutate={fullMutate}/>} {view==="properties"&&<CemeteryInventoryModule cemeteryAction={cemeteryAction} permissions={permissions}/>} {view==="deals"&&<CemeteryDealsModule data={data} permissions={permissions} coreMutate={coreMutate} cemeteryAction={cemeteryAction}/>} {view==="finance"&&<FinanceModule data={data} finance={finance} financeReady={financeReady} financeMutate={financeMutate}/>} {view==="kpi"&&<KpiModule data={data} full={full} fullMutate={fullMutate}/>} {view==="reports"&&<ReportsModule data={data} full={full} permissions={permissions}/>} {view==="automation"&&<AutomationModule data={data} full={full} fullMutate={fullMutate}/>} {view==="team"&&<TeamModule data={data} permissions={permissions} coreMutate={coreMutate}/>}</section></main></div>;
}

function LoginScreen({login,setLogin,signIn,busy,error}){return <main className="suite-login"><section className="suite-login-brand"><div className="brand-mark">PTM</div><span>PHÚC TRƯỜNG MINH</span><h1>CRM điều hành<br/>Thiên Phúc Vĩnh Hằng Viên</h1><p>Một nền tảng cho Marketing · Sales · CSKH · Kế toán · Ban giám đốc</p><div className="suite-login-features"><b>Customer 360°</b><b>Pipeline & Automation</b><b>Hợp đồng & Công nợ</b><b>Giỏ 9.392 mộ phần</b></div></section><section className="suite-login-form"><form onSubmit={signIn}><span className="eyebrow">PTM ENTERPRISE CRM</span><h2>Đăng nhập hệ thống</h2><p>Sử dụng tài khoản nhân viên được cấp bởi công ty.</p><label>Email<input type="email" required value={login.email} onChange={e=>setLogin({...login,email:e.target.value})}/></label><label>Mật khẩu<input type="password" required autoFocus value={login.password} onChange={e=>setLogin({...login,password:e.target.value})}/></label>{error&&<div className="suite-login-error">{error}</div>}<button className="suite-btn primary wide" disabled={busy}>{busy?"Đang xác thực...":"Đăng nhập"}</button><small>Giám đốc · Admin · Marketing · Sale · Kế toán</small></form></section></main>}
