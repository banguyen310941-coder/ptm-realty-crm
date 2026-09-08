"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@neondatabase/neon-js";

const DB_URL = "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";
const client = createClient(DB_URL, { auth: { allowAnonymous: true } });
const SESSION_KEY = "ptm_crm_session_v3";

const nav = [
  ["dashboard","▦","Tổng quan"], ["leads","◎","Khách hàng"], ["properties","⌂","Sản phẩm"],
  ["deals","₫","Giao dịch"], ["tasks","✓","Công việc"], ["team","◉","Đội ngũ"]
];
const labels = {
  new:"Khách mới", contact:"Đã liên hệ", hot:"Quan tâm", visit:"Đi xem", deal:"Chốt cọc", lost:"Không nhu cầu",
  available:"Đang bán", reserved:"Giữ chỗ", sold:"Đã bán", locked:"Tạm khóa",
  booking:"Booking", deposit:"Đặt cọc", negotiation:"Thương lượng", contract:"Chờ ký HĐ", completed:"Hoàn tất", cancelled:"Hủy"
};

function money(v){ return new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(Number(v||0)); }
function shortMoney(v){ v=Number(v||0); return v>=1e9?`${(v/1e9).toFixed(v%1e9?1:0)} tỷ`:v>=1e6?`${Math.round(v/1e6)} tr`:money(v); }
function unwrap(data){ return Array.isArray(data) ? data[0] : data; }

export default function CRMApp(){
  const [session,setSession]=useState(null);
  const [data,setData]=useState(null);
  const [view,setView]=useState("dashboard");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [login,setLogin]=useState({email:"admin@ptm.vn",password:""});

  useEffect(()=>{
    const raw=localStorage.getItem(SESSION_KEY);
    if(raw){ try{ const s=JSON.parse(raw); setSession(s); load(s.token); }catch{ localStorage.removeItem(SESSION_KEY); } }
  },[]);

  async function rpc(action,payload={},token=session?.token){
    const {data:res,error:err}=await client.rpc("crm_api",{p_token:token||"",p_action:action,p_payload:payload});
    if(err) throw new Error(err.message||"Không kết nối được CRM");
    const out=unwrap(res);
    if(!out?.ok) throw new Error(out?.error||"Thao tác thất bại");
    return out;
  }
  async function load(token=session?.token){
    if(!token) return;
    setBusy(true); setError("");
    try{ const out=await rpc("bootstrap",{},token); setData(out); }
    catch(e){ setError(e.message); if(/hết hạn|UNAUTHENTICATED/i.test(e.message)){localStorage.removeItem(SESSION_KEY);setSession(null);setData(null);} }
    finally{ setBusy(false); }
  }
  async function signIn(e){
    e.preventDefault(); setBusy(true); setError("");
    try{
      const {data:res,error:err}=await client.rpc("crm_login",{p_email:login.email,p_password:login.password});
      if(err) throw new Error(err.message||"Không thể đăng nhập");
      const out=unwrap(res); if(!out?.ok) throw new Error(out?.error||"Email hoặc mật khẩu không đúng");
      const s={token:out.token,user:out.user}; localStorage.setItem(SESSION_KEY,JSON.stringify(s)); setSession(s); await load(out.token);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function signOut(){ try{await rpc("logout");}catch{} localStorage.removeItem(SESSION_KEY);setSession(null);setData(null);setView("dashboard"); }
  async function mutate(action,payload){ setBusy(true); setError(""); try{await rpc(action,payload);await load();}catch(e){setError(e.message);}finally{setBusy(false);} }

  if(!session) return <Login login={login} setLogin={setLogin} signIn={signIn} busy={busy} error={error}/>;
  if(!data) return <div className="center-screen"><div><b>PTM Realty CRM</b><p>{error||"Đang tải dữ liệu..."}</p><button className="btn primary" onClick={()=>load()}>Tải lại</button></div></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">PTM</div><div><strong>Phúc Trường Minh</strong><span>Realty CRM</span></div></div>
      <nav>{nav.map(([id,ic,tx])=><button key={id} className={`nav-item nav-btn ${view===id?"active":""}`} onClick={()=>setView(id)}><span>{ic}</span>{tx}</button>)}</nav>
      <div className="sidebar-footer"><div className="user-card"><div className="avatar">{data.user.name.slice(0,2).toUpperCase()}</div><div><strong>{data.user.name}</strong><span>{data.user.role}</span></div></div><button className="logout" onClick={signOut}>Đăng xuất</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">CRM online</span><strong>{nav.find(x=>x[0]===view)?.[2]}</strong></div><div className="top-user"><span>{busy?"Đang đồng bộ…":"Đã đồng bộ Neon"}</span><button className="btn ghost" onClick={()=>load()}>↻ Làm mới</button></div></header>
      {error&&<div className="global-alert">{error}</div>}
      <section className="page-wrap">
        {view==="dashboard"&&<Dashboard data={data}/>} 
        {view==="leads"&&<Leads data={data} mutate={mutate}/>} 
        {view==="properties"&&<Properties data={data} mutate={mutate}/>} 
        {view==="deals"&&<Deals data={data} mutate={mutate}/>} 
        {view==="tasks"&&<Tasks data={data} mutate={mutate}/>} 
        {view==="team"&&<Team data={data}/>} 
      </section>
    </main>
  </div>;
}

function Login({login,setLogin,signIn,busy,error}){
  return <main className="login-shell"><section className="login-brand"><div className="brand-badge">PTM</div><h1>Phúc Trường Minh</h1><p>Realty CRM</p><div className="login-points"><span>Quản lý khách hàng & pipeline</span><span>Giỏ hàng bất động sản tập trung</span><span>Giao dịch, hoa hồng & công việc</span></div></section><section className="login-card"><div><span className="eyebrow">CRM nội bộ</span><h2>Đăng nhập</h2><p>Hệ thống kết nối trực tiếp Neon PostgreSQL, không phụ thuộc Vercel secret.</p></div><form className="form-stack" onSubmit={signIn}><label>Email<input type="email" value={login.email} onChange={e=>setLogin({...login,email:e.target.value})} required/></label><label>Mật khẩu<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} required autoFocus/></label>{error&&<div className="alert">{error}</div>}<button className="btn primary wide" disabled={busy}>{busy?"Đang đăng nhập...":"Đăng nhập"}</button></form><small>Dữ liệu được bảo vệ bằng session token và PostgreSQL RPC.</small></section></main>;
}

function Dashboard({data}){
  const leads=data.leads||[], deals=data.deals||[], tasks=data.tasks||[];
  const pipeline=leads.filter(x=>["hot","visit","deal"].includes(x.status)).reduce((s,x)=>s+Number(x.budget||0),0);
  const commission=deals.reduce((s,x)=>s+Number(x.commission||0),0);
  return <><div className="page-title"><div><h1>Tổng quan</h1><p>Theo dõi hoạt động kinh doanh bất động sản.</p></div></div><div className="metric-grid"><Metric n={leads.filter(x=>x.status!=="lost").length} t="Khách đang chăm sóc"/><Metric n={leads.length} t="Tổng khách hàng"/><Metric n={shortMoney(pipeline)} t="Giá trị cơ hội"/><Metric n={shortMoney(commission)} t="Hoa hồng dự kiến"/></div><div className="two-col section-gap"><div className="panel"><div className="panel-head"><div><h2>Khách hàng gần đây</h2><p>5 lead cập nhật mới nhất</p></div></div><LeadTable rows={leads.slice(0,5)}/></div><div className="panel"><div className="panel-head"><div><h2>Công việc</h2><p>{tasks.filter(x=>!x.done).length} việc chưa hoàn tất</p></div></div>{tasks.slice(0,5).map(t=><div className={`task-mini ${t.done?"done":""}`} key={t.id}><b>{t.title}</b><span>{t.owner_name||"Chưa giao"}</span></div>)}</div></div></>;
}
function Metric({n,t}){return <div className="metric-card"><span>{t}</span><strong>{n}</strong><em>Live database</em></div>}

function Leads({data,mutate}){
  const [q,setQ]=useState(""); const rows=useMemo(()=>data.leads.filter(x=>!q||`${x.name} ${x.phone} ${x.project||""}`.toLowerCase().includes(q.toLowerCase())),[data.leads,q]);
  async function edit(x={}){ const name=prompt("Họ tên",x.name||""); if(!name)return; const phone=prompt("Số điện thoại",x.phone||""); if(!phone)return; const project=prompt("Dự án quan tâm",x.project||"")||""; const budget=prompt("Ngân sách (VND)",x.budget||0)||0; const status=prompt("Trạng thái: new/contact/hot/visit/deal/lost",x.status||"new")||"new"; await mutate("save_lead",{...x,name,phone,project,budget:String(budget),status,owner_id:x.owner_id||data.user.id,source:x.source||"Khác",email:x.email||"",need:x.need||"",notes:x.notes||""}); }
  return <><div className="page-title"><div><h1>Khách hàng</h1><p>Quản lý lead và pipeline.</p></div><button className="btn primary" onClick={()=>edit()}>+ Thêm khách</button></div><div className="panel"><div className="filters"><input placeholder="Tìm tên, SĐT, dự án..." value={q} onChange={e=>setQ(e.target.value)}/></div><LeadTable rows={rows} actions={(x)=><span className="row-actions"><button onClick={()=>edit(x)}>Sửa</button><button className="danger-link" onClick={()=>confirm("Xóa khách này?")&&mutate("delete_lead",{id:x.id})}>Xóa</button></span>}/></div></>;
}
function LeadTable({rows,actions}){return <div className="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Nguồn</th><th>Dự án</th><th>Ngân sách</th><th>Trạng thái</th><th>Sale</th>{actions&&<th/>}</tr></thead><tbody>{rows.map(x=><tr key={x.id}><td><b>{x.name}</b><small>{x.phone}</small></td><td>{x.source}</td><td>{x.project||"—"}</td><td className="money">{shortMoney(x.budget)}</td><td><span className={`badge status-${x.status}`}>{labels[x.status]||x.status}</span></td><td>{x.owner_name||"—"}</td>{actions&&<td>{actions(x)}</td>}</tr>)}</tbody></table></div>}

function Properties({data,mutate}){
  async function edit(x={}){const name=prompt("Tên sản phẩm",x.name||"");if(!name)return;const code=prompt("Mã căn",x.code||"");if(!code)return;const project=prompt("Dự án",x.project||"");if(!project)return;const price=prompt("Giá bán",x.price||0)||0;const area=prompt("Diện tích m²",x.area||0)||0;const status=prompt("available/reserved/sold/locked",x.status||"available")||"available";await mutate("save_property",{...x,name,code,project,price:String(price),area:String(area),bedrooms:String(x.bedrooms||0),status,property_type:x.property_type||"Căn hộ",notes:x.notes||""});}
  return <><div className="page-title"><div><h1>Sản phẩm BĐS</h1><p>Giỏ hàng bất động sản tập trung.</p></div>{data.user.role!=="sale"&&<button className="btn primary" onClick={()=>edit()}>+ Thêm sản phẩm</button>}</div><div className="property-grid">{data.properties.map(x=><div className="property-card" key={x.id}><div className="property-visual">⌂ <em><span className={`badge property-${x.status}`}>{labels[x.status]||x.status}</span></em></div><div className="property-body"><small>{x.code}</small><h2>{x.name}</h2><p>{x.project} · {x.area} m² · {x.bedrooms} PN</p><strong className="property-price">{money(x.price)}</strong>{data.user.role!=="sale"&&<div className="row-actions property-actions"><button onClick={()=>edit(x)}>Sửa</button><button className="danger-link" onClick={()=>confirm("Xóa sản phẩm?")&&mutate("delete_property",{id:x.id})}>Xóa</button></div>}</div></div>)}</div></>;
}

function Deals({data,mutate}){
  async function add(){ if(!data.leads.length||!data.properties.length)return alert("Cần có khách hàng và sản phẩm trước."); const lead=data.leads[0], prop=data.properties[0]; const value=prompt(`Giá trị giao dịch cho ${lead.name} / ${prop.name}`,prop.price||0); if(value===null)return; const commission=prompt("Hoa hồng dự kiến",0)||0; await mutate("save_deal",{lead_id:lead.id,property_id:prop.id,value:String(value),commission:String(commission),stage:"booking",owner_id:data.user.id,deal_date:new Date().toISOString().slice(0,10),notes:""}); }
  return <><div className="page-title"><div><h1>Giao dịch</h1><p>Booking, đặt cọc, hợp đồng và hoa hồng.</p></div><button className="btn primary" onClick={add}>+ Giao dịch</button></div><div className="panel"><div className="table-wrap"><table><thead><tr><th>Khách hàng</th><th>Sản phẩm</th><th>Giá trị</th><th>Hoa hồng</th><th>Giai đoạn</th><th>Sale</th><th/></tr></thead><tbody>{data.deals.map(x=><tr key={x.id}><td>{x.lead_name||"—"}</td><td>{x.property_name||"—"}</td><td className="money">{money(x.value)}</td><td>{money(x.commission)}</td><td><span className="badge">{labels[x.stage]||x.stage}</span></td><td>{x.owner_name||"—"}</td><td><button className="danger-link" onClick={()=>confirm("Xóa giao dịch?")&&mutate("delete_deal",{id:x.id})}>Xóa</button></td></tr>)}</tbody></table></div></div></>;
}

function Tasks({data,mutate}){
  async function add(){const title=prompt("Nội dung công việc");if(!title)return;const due=prompt("Thời hạn ISO, ví dụ 2026-09-08T15:00:00+07:00",new Date(Date.now()+3600000).toISOString())||"";await mutate("save_task",{title,task_type:"call",due_at:due,owner_id:data.user.id,lead_id:"",priority:"normal"});}
  return <><div className="page-title"><div><h1>Công việc</h1><p>Lịch gọi, lịch hẹn và việc cần xử lý.</p></div><button className="btn primary" onClick={add}>+ Công việc</button></div><div className="panel task-panel">{data.tasks.map(t=><div className={`task-row ${t.done?"done":""}`} key={t.id}><button className="task-check" onClick={()=>mutate("toggle_task",{id:t.id})}>{t.done?"✓":""}</button><div><strong>{t.title}</strong><span>{t.lead_name||"Không gắn khách"}</span></div><span className={`badge priority-${t.priority}`}>{t.priority}</span><span>{t.owner_name||"—"}</span><button className="danger-link" onClick={()=>confirm("Xóa công việc?")&&mutate("delete_task",{id:t.id})}>×</button></div>)}</div></>;
}

function Team({data}){return <><div className="page-title"><div><h1>Đội ngũ</h1><p>Tài khoản đang hoạt động.</p></div></div><div className="panel"><div className="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Trạng thái</th></tr></thead><tbody>{data.users.map(u=><tr key={u.id}><td><b>{u.name}</b></td><td><span className={`role role-${u.role}`}>{u.role}</span></td><td>{u.active?"Hoạt động":"Đã khóa"}</td></tr>)}</tbody></table></div></div></>}
