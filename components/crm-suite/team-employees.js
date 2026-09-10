"use client";

import { useMemo, useState } from "react";
import { roleLabel, ROLE_OPTIONS } from "@/lib/rbac";

const DEPARTMENTS=["Ban giám đốc","Kinh doanh","Marketing","Kế toán","CSKH","Vận hành","Hành chính · Nhân sự"];

function Dialog({title,eyebrow="ĐỘI NGŨ",onClose,children}){
  return <div className="customer-modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="customer-modal"><header><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="customer-modal-close" type="button" onClick={onClose}>×</button></header>{children}</section></div>;
}

function clean(value){return String(value??"").trim()}

export function TeamModule({data,permissions,coreMutate}){
  const users=data.users||[];
  const canManage=permissions?.users_manage===true;
  const[modal,setModal]=useState(null),[toggleTarget,setToggleTarget]=useState(null),[error,setError]=useState(""),[query,setQuery]=useState("");
  const rows=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return users;return users.filter(u=>[u.name,u.employee_code,u.phone,u.department,u.job_title,u.manager_name,u.email].some(v=>String(v||"").toLowerCase().includes(q)))},[users,query]);
  const managers=users.filter(u=>u.active!==false&&u.id!==modal?.id);

  function open(u={}){
    if(!canManage)return;
    setError("");
    setModal({
      id:u.id||"",name:u.name||"",employee_code:u.employee_code||"",email:u.email||"",phone:u.phone||"",role:u.role||"sale",
      department:u.department||"",job_title:u.job_title||"",manager_id:u.manager_id||"",start_date:String(u.start_date||"").slice(0,10),
      work_location:u.work_location||"",internal_notes:u.internal_notes||"",password:""
    });
  }

  async function submit(e){
    e.preventDefault();setError("");
    try{
      if(!clean(modal.name))throw new Error("Vui lòng nhập họ tên nhân viên.");
      if(!clean(modal.email))throw new Error("Vui lòng nhập email đăng nhập.");
      if(!modal.id&&!modal.password)throw new Error("Vui lòng nhập mật khẩu ban đầu.");
      if(modal.manager_id&&modal.manager_id===modal.id)throw new Error("Nhân viên không thể là quản lý trực tiếp của chính mình.");
      await coreMutate("save_user",{
        ...modal,
        name:clean(modal.name),employee_code:clean(modal.employee_code),email:clean(modal.email).toLowerCase(),phone:clean(modal.phone),
        department:clean(modal.department),job_title:clean(modal.job_title),work_location:clean(modal.work_location),internal_notes:clean(modal.internal_notes)
      });
      setModal(null);
    }catch(e2){setError(e2?.message||"Không thể lưu hồ sơ nhân viên.")}
  }

  async function toggleUser(){
    if(!toggleTarget||!canManage)return;
    setError("");
    try{await coreMutate("toggle_user",{id:toggleTarget.id});setToggleTarget(null)}catch(e){setError(e?.message||"Không thể thay đổi trạng thái tài khoản.")}
  }

  return <div className="suite-page">
    <div className="suite-page-head"><div><h1>Đội ngũ & hồ sơ nhân viên</h1><p>Quản lý thông tin vận hành, cơ cấu báo cáo và quyền đăng nhập. Chỉ Admin được tạo, sửa hoặc khóa tài khoản.</p></div>{canManage&&<button className="suite-btn primary" onClick={()=>open()}>+ Nhân viên</button>}</div>
    {error&&<div className="suite-error-banner">{error}</div>}
    <section className="suite-panel"><div className="suite-panel-head"><div><h3>Danh sách nhân viên</h3><p>{users.filter(u=>u.active!==false).length} đang hoạt động · {users.length} tổng tài khoản</p></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm tên, mã NV, SĐT, phòng ban..."/></div><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Nhân viên</th><th>Liên hệ</th><th>Phòng ban · Chức danh</th><th>Quản lý trực tiếp</th><th>Ngày vào · Nơi làm</th><th>Vai trò CRM</th><th>Trạng thái</th><th/></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><b>{u.name}</b><small>{u.employee_code||"Chưa có mã NV"}</small></td><td>{u.phone||"—"}<small>{u.email||""}</small></td><td>{u.department||"—"}<small>{u.job_title||""}</small></td><td>{u.manager_name||"—"}</td><td>{u.start_date?new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"}).format(new Date(`${String(u.start_date).slice(0,10)}T00:00:00+07:00`)):"—"}<small>{u.work_location||""}</small></td><td><span className={`role role-${u.role}`}>{roleLabel(u.role)}</span></td><td>{u.active===false?"Đã khóa":"Hoạt động"}</td><td>{canManage&&<><button className="suite-link" onClick={()=>open(u)}>Sửa</button> {u.id!==data.user.id&&<button className="suite-link danger" onClick={()=>{setError("");setToggleTarget(u)}}>{u.active===false?"Mở khóa":"Khóa"}</button>}</>}</td></tr>)}{!rows.length&&<tr><td colSpan="8"><div className="suite-empty">Không tìm thấy nhân viên phù hợp.</div></td></tr>}</tbody></table></div></section>

    {modal&&<Dialog title={modal.id?"Cập nhật hồ sơ nhân viên":"Tạo nhân viên mới"} eyebrow="NHÂN SỰ · TÀI KHOẢN CRM" onClose={()=>setModal(null)}><form className="customer-form" onSubmit={submit}><div className="customer-form-grid">
      <label>Họ tên <span className="customer-required">*</span><input autoFocus required value={modal.name} onChange={e=>setModal({...modal,name:e.target.value})}/></label>
      <label>Mã nhân viên<input value={modal.employee_code} onChange={e=>setModal({...modal,employee_code:e.target.value})} placeholder="VD: PTM-S001"/></label>
      <label>Email đăng nhập <span className="customer-required">*</span><input type="email" required value={modal.email} onChange={e=>setModal({...modal,email:e.target.value})}/></label>
      <label>Số điện thoại<input value={modal.phone} onChange={e=>setModal({...modal,phone:e.target.value})} placeholder="SĐT công việc"/></label>
      <label>Vai trò CRM<select value={modal.role} onChange={e=>setModal({...modal,role:e.target.value})}>{ROLE_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Phòng ban<input list="ptm-departments" value={modal.department} onChange={e=>setModal({...modal,department:e.target.value})} placeholder="VD: Kinh doanh"/><datalist id="ptm-departments">{DEPARTMENTS.map(v=><option key={v} value={v}/>)}</datalist></label>
      <label>Chức danh<input value={modal.job_title} onChange={e=>setModal({...modal,job_title:e.target.value})} placeholder="VD: Chuyên viên tư vấn"/></label>
      <label>Quản lý trực tiếp<select value={modal.manager_id} onChange={e=>setModal({...modal,manager_id:e.target.value})}><option value="">Không có / cấp cao nhất</option>{managers.map(u=><option key={u.id} value={u.id}>{u.name} · {roleLabel(u.role)}</option>)}</select></label>
      <label>Ngày vào làm<input type="date" value={modal.start_date} onChange={e=>setModal({...modal,start_date:e.target.value})}/></label>
      <label>Nơi làm việc<input value={modal.work_location} onChange={e=>setModal({...modal,work_location:e.target.value})} placeholder="Văn phòng / dự án / chi nhánh"/></label>
      <label className="customer-form-wide">Ghi chú nội bộ<textarea value={modal.internal_notes} onChange={e=>setModal({...modal,internal_notes:e.target.value})} placeholder="Thông tin vận hành cần lưu cho Admin..."/></label>
      <label className="customer-form-wide">{modal.id?"Mật khẩu mới":"Mật khẩu ban đầu"}{!modal.id&&<span className="customer-required"> *</span>}<input type="password" required={!modal.id} minLength={8} value={modal.password} onChange={e=>setModal({...modal,password:e.target.value})} placeholder={modal.id?"Để trống nếu không đổi":"Tối thiểu 8 ký tự"}/><small>{modal.id?"Chỉ nhập khi cần đặt lại mật khẩu.":"Nhân viên dùng email và mật khẩu này để đăng nhập CRM."}</small></label>
    </div>{error&&<div className="customer-form-error">{error}</div>}<div className="customer-form-actions"><button type="button" className="suite-btn" onClick={()=>setModal(null)}>Hủy</button><button className="suite-btn primary">Lưu hồ sơ nhân viên</button></div></form></Dialog>}

    {toggleTarget&&<Dialog title={toggleTarget.active===false?"Mở khóa tài khoản?":"Khóa tài khoản?"} eyebrow="XÁC NHẬN TÀI KHOẢN" onClose={()=>setToggleTarget(null)}><div className="customer-form"><p>{toggleTarget.active===false?<>Tài khoản <b>{toggleTarget.name}</b> sẽ được phép đăng nhập và sử dụng CRM trở lại.</>:<>Tài khoản <b>{toggleTarget.name}</b> sẽ bị ngừng đăng nhập CRM cho tới khi Admin mở khóa. Hồ sơ và lịch sử nghiệp vụ vẫn được giữ nguyên.</>}</p><div className="customer-form-actions"><button type="button" className="suite-btn" onClick={()=>setToggleTarget(null)}>Hủy</button><button type="button" className="suite-btn primary" onClick={toggleUser}>{toggleTarget.active===false?"Mở khóa tài khoản":"Khóa tài khoản"}</button></div></div></Dialog>}
  </div>;
}
