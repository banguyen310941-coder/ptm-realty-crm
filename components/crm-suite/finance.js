"use client";

import { useMemo, useState } from "react";
import { compactMoney, fmtDate, money } from "@/lib/crm-client";

const CONTRACT_TYPES={booking:"Phiếu giữ chỗ",deposit:"Phiếu cọc",sale:"HĐ mua bán",lease:"Cho thuê",other:"Khác"};
const CONTRACT_STATUS={draft:"Nháp",pending:"Chờ duyệt",signed:"Đã ký",completed:"Hoàn tất",cancelled:"Hủy"};
const PAYMENT_TYPES={booking:"Giữ chỗ",deposit:"Đặt cọc",installment:"Đợt thanh toán",final:"Thanh toán cuối",refund:"Hoàn tiền",other:"Khác"};
const PAYMENT_STATUS={due:"Đến hạn",paid:"Đã thu",overdue:"Quá hạn",cancelled:"Hủy"};
const COMMISSION_STATUS={pending:"Chờ duyệt",approved:"Đã duyệt",paid:"Đã chi",cancelled:"Hủy"};
const DEAL_STAGE={booking:"Giữ chỗ",deposit:"Đặt cọc",negotiation:"Thương lượng",contract:"Hợp đồng",completed:"Hoàn tất",cancelled:"Hủy"};

const EMPTY_CONTRACT={id:"",deal_id:"",lead_id:"",property_id:"",contract_type:"sale",status:"draft",total_value:"",signed_at:"",effective_date:"",document_url:"",notes:""};
const EMPTY_PAYMENT={id:"",contract_id:"",deal_id:"",lead_id:"",payment_type:"installment",amount:"",due_date:"",paid_at:"",status:"due",reference:"",notes:""};
const EMPTY_COMMISSION={id:"",deal_id:"",user_id:"",basis_amount:"",rate:"3",amount:"",status:"pending",notes:""};

function vietnamParts(){return Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(({type,value})=>[type,value]))}
function localDate(){const p=vietnamParts();return `${p.year}-${p.month}-${p.day}`}
function localDateTime(){const p=vietnamParts();return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`}

export function FinanceModule({ data, finance, financeReady, financeMutate }) {
  const role=data.user.role;
  const canManage=["admin","ceo","manager","accounting"].includes(role);
  const canContract=["admin","ceo","manager","accounting","sale"].includes(role);
  const [tab,setTab]=useState("workflow");
  const [modal,setModal]=useState(null);
  const contracts=finance.contracts||[];
  const payments=finance.payments||[];
  const commissions=finance.commissions||[];
  const workflows=finance.workflows||[];
  const summary=finance.summary||{};
  const sales=(data.users||[]).filter((u)=>u.role==="sale"&&u.active!==false);

  const overdue=useMemo(()=>payments.filter((p)=>p.status==="overdue"),[payments]);
  const dueSoon=useMemo(()=>payments.filter((p)=>p.status==="due"&&p.due_date&&new Date(p.due_date).getTime()<=Date.now()+7*86400000),[payments]);
  const collected=useMemo(()=>payments.filter(p=>p.status==="paid").reduce((s,p)=>s+(p.payment_type==="refund"?-Number(p.amount||0):Number(p.amount||0)),0),[payments]);

  if(!financeReady) return <div className="suite-page"><div className="suite-page-head"><div><h1>Tài chính & Hợp đồng</h1><p>Hợp đồng, công nợ và hoa hồng theo giao dịch.</p></div></div><div className="suite-panel suite-empty suite-empty-large">Module tài chính đang chờ kích hoạt database.</div></div>;

  function openContract(c={}){setModal({type:"contract",draft:{...EMPTY_CONTRACT,...c}})}
  function openPayment(p={}){setModal({type:"payment",draft:{...EMPTY_PAYMENT,...p}})}
  function openCommission(c={}){setModal({type:"commission",draft:{...EMPTY_COMMISSION,...c}})}
  function openDeposit(w){setModal({type:"deposit",draft:{deal_id:w.deal_id,amount:"",paid_at:localDateTime(),reference:"",notes:""},workflow:w})}
  function contractFor(w){return contracts.find(c=>c.id===w.sale_contract_id)}
  function commissionFor(w){return commissions.find(c=>c.id===w.commission_id)}
  function openWorkflowContract(w){const c=contractFor(w);if(c)return openContract(c);openContract({deal_id:w.deal_id,lead_id:w.lead_id,property_id:w.property_id,contract_type:"sale",status:role==="sale"?"draft":"pending",total_value:w.deal_value||"",notes:`Hợp đồng cho ${w.property_code||w.property_name||"sản phẩm"}`})}
  function openWorkflowPayment(w){openPayment({contract_id:w.sale_contract_id||"",deal_id:w.deal_id,lead_id:w.lead_id,payment_type:Number(w.balance||0)>0&&Number(w.balance||0)<=Number(w.sale_contract_total||0)?"final":"installment",amount:Number(w.balance||0)>0?w.balance:"",due_date:localDate(),status:"paid",paid_at:localDateTime(),reference:"",notes:""})}
  function openWorkflowCommission(w){const c=commissionFor(w);if(c)return openCommission(c);const expected=Number(w.commission_expected||0),basis=Number(w.deal_value||0);const rate=expected>0&&basis>0?Number((expected*100/basis).toFixed(4)):3;openCommission({deal_id:w.deal_id,user_id:w.owner_id||"",basis_amount:basis||"",rate,amount:expected||"",status:"pending",notes:"Hoa hồng giao dịch hoàn tất"})}

  return <div className="suite-page">
    <div className="suite-page-head"><div><span className="eyebrow">THIÊN PHÚC · SALES TO CASH</span><h1>Hợp đồng & Tài chính</h1><p>Theo dõi xuyên suốt từ giữ chỗ, phiếu cọc, hợp đồng, thu tiền đến hoa hồng Sale.</p></div><div className="suite-action-row">{canContract&&<button className="suite-btn" onClick={()=>openContract()}>+ Hợp đồng</button>}{canManage&&<button className="suite-btn" onClick={()=>openPayment()}>+ Khoản thu</button>}{canManage&&<button className="suite-btn primary" onClick={()=>openCommission()}>+ Hoa hồng</button>}</div></div>

    <div className="finance-metrics"><Metric label="Giá trị hợp đồng" value={compactMoney(summary.contract_value)} note={`${contracts.filter(c=>c.status!=="cancelled").length} hợp đồng`}/><Metric label="Đã thu" value={compactMoney(collected)} note={`${payments.filter(p=>p.status==="paid").length} phiếu thu`}/><Metric label="Công nợ phải thu" value={compactMoney(summary.receivable)} note={`${dueSoon.length} khoản trong 7 ngày`}/><Metric label="Quá hạn" value={compactMoney(summary.overdue)} note={`${overdue.length} khoản quá hạn`} danger={Number(summary.overdue)>0}/></div>

    <div className="finance-tabs"><button className={tab==="workflow"?"active":""} onClick={()=>setTab("workflow")}>Quy trình <span>{workflows.length}</span></button><button className={tab==="contracts"?"active":""} onClick={()=>setTab("contracts")}>Hợp đồng <span>{contracts.length}</span></button><button className={tab==="payments"?"active":""} onClick={()=>setTab("payments")}>Thanh toán <span>{payments.length}</span></button><button className={tab==="commissions"?"active":""} onClick={()=>setTab("commissions")}>Hoa hồng <span>{commissions.length}</span></button></div>

    {tab==="workflow"&&<WorkflowBoard rows={workflows} role={role} canManage={canManage} openDeposit={openDeposit} openContract={openWorkflowContract} openPayment={openWorkflowPayment} openCommission={openWorkflowCommission}/>} 
    {tab==="contracts"&&<Contracts rows={contracts} canContract={canContract} open={openContract}/>} 
    {tab==="payments"&&<Payments rows={payments} canManage={canManage} open={openPayment}/>} 
    {tab==="commissions"&&<Commissions rows={commissions} canManage={canManage} open={openCommission}/>} 

    {modal?.type==="deposit"&&<DepositModal modal={modal} setModal={setModal} save={financeMutate}/>} 
    {modal?.type==="contract"&&<ContractModal modal={modal} setModal={setModal} data={data} role={role} save={financeMutate}/>} 
    {modal?.type==="payment"&&<PaymentModal modal={modal} setModal={setModal} data={data} contracts={contracts} save={financeMutate}/>} 
    {modal?.type==="commission"&&<CommissionModal modal={modal} setModal={setModal} data={data} sales={sales} save={financeMutate}/>} 
  </div>;
}

function Metric({label,value,note,danger}){return <div className={`finance-metric ${danger?"danger":""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>}

function WorkflowBoard({rows,role,canManage,openDeposit,openContract,openPayment,openCommission}){
  if(!rows.length)return <section className="suite-panel suite-empty suite-empty-large">Chưa có giao dịch đang hoạt động để chạy quy trình.</section>;
  return <div className="finance-workflow-list">{rows.map(w=><WorkflowCard key={w.deal_id} w={w} role={role} canManage={canManage} openDeposit={openDeposit} openContract={openContract} openPayment={openPayment} openCommission={openCommission}/>)}</div>
}

function WorkflowCard({w,role,canManage,openDeposit,openContract,openPayment,openCommission}){
  const depositDone=Number(w.deposit_paid||0)>0||["signed","completed"].includes(w.deposit_contract_status);
  const contractDone=["signed","completed"].includes(w.sale_contract_status);
  const paymentDone=contractDone&&Number(w.sale_contract_total||0)>0&&Number(w.balance||0)<=0;
  const commissionStarted=!!w.commission_id;
  const commissionDone=["approved","paid"].includes(w.commission_status);
  const steps=[
    {label:"Giữ chỗ",done:w.stage!=="cancelled",meta:DEAL_STAGE[w.stage]||w.stage},
    {label:"Phiếu cọc",done:depositDone,meta:depositDone?compactMoney(w.deposit_paid):"Chưa thu cọc"},
    {label:"Hợp đồng",done:contractDone,meta:w.sale_contract_code||"Chưa ký"},
    {label:"Thanh toán",done:paymentDone,meta:contractDone?`${compactMoney(w.paid_total)} / ${compactMoney(w.sale_contract_total)}`:"Chờ HĐ"},
    {label:"Hoa hồng",done:commissionDone,active:commissionStarted,meta:commissionStarted?`${COMMISSION_STATUS[w.commission_status]||w.commission_status} · ${compactMoney(w.commission_amount)}`:"Chưa thiết lập"}
  ];
  return <article className="finance-flow-card"><header><div><span className="eyebrow">{w.property_code||"GIAO DỊCH"}</span><h3>{w.lead_name||"Khách hàng"}</h3><p>{w.property_name||"Chưa gắn mộ phần"} · Sale: {w.owner_name||"Chưa phân công"}</p></div><div className="finance-flow-value"><span>Giá trị</span><b>{compactMoney(w.deal_value)}</b><small>{DEAL_STAGE[w.stage]||w.stage}</small></div></header>
    <div className="finance-flow-steps">{steps.map((s,i)=><div key={s.label} className={`finance-flow-step ${s.done?"done":s.active?"active":""}`}><i>{s.done?"✓":i+1}</i><b>{s.label}</b><small>{s.meta}</small></div>)}</div>
    <div className="finance-flow-summary"><span>Đã thu <b>{money(w.paid_total||0)}</b></span><span>Còn phải thu <b>{contractDone?money(w.balance||0):"Chờ HĐ"}</b></span><span>Hoa hồng dự kiến <b>{Number(w.commission_expected||0)>0?money(w.commission_expected):"Chưa thiết lập"}</b></span></div>
    <footer>{!depositDone&&canManage&&<button className="suite-btn primary" onClick={()=>openDeposit(w)}>1. Xác nhận cọc</button>}{depositDone&&<button className="suite-btn" onClick={()=>openContract(w)}>{contractDone?"Xem hợp đồng":role==="sale"?"2. Soạn HĐ":"2. Lập / ký HĐ"}</button>}{contractDone&&!paymentDone&&canManage&&<button className="suite-btn primary" onClick={()=>openPayment(w)}>3. Ghi nhận thanh toán</button>}{paymentDone&&canManage&&<button className="suite-btn" onClick={()=>openCommission(w)}>{commissionStarted?"4. Xử lý hoa hồng":"4. Thiết lập hoa hồng"}</button>}{role==="sale"&&!depositDone&&<span className="finance-flow-note">Chờ Kế toán/Admin xác nhận tiền cọc.</span>}{role==="sale"&&paymentDone&&<span className="finance-flow-note">Hoa hồng sẽ hiển thị sau khi được duyệt.</span>}</footer>
  </article>
}

function Contracts({rows,canContract,open}){return <section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Mã HĐ</th><th>Khách hàng</th><th>Sản phẩm</th><th>Loại</th><th>Trạng thái</th><th>Giá trị</th><th>Ngày ký</th><th/></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><b>{c.code}</b></td><td>{c.lead_name}</td><td>{c.property_name||"—"}</td><td>{CONTRACT_TYPES[c.contract_type]||c.contract_type}</td><td><span className={`suite-status status-${c.status}`}>{CONTRACT_STATUS[c.status]||c.status}</span></td><td>{money(c.total_value)}</td><td>{fmtDate(c.signed_at)}</td><td>{canContract&&<button className="suite-link" onClick={()=>open(c)}>Mở</button>}</td></tr>)}{!rows.length&&<tr><td colSpan="8"><div className="suite-empty">Chưa có hợp đồng.</div></td></tr>}</tbody></table></div></section>}
function Payments({rows,canManage,open}){return <section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Khách hàng</th><th>Hợp đồng</th><th>Loại</th><th>Số tiền</th><th>Hạn thu</th><th>Trạng thái</th><th>Tham chiếu</th><th/></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><b>{p.lead_name}</b></td><td>{p.contract_code||"—"}</td><td>{PAYMENT_TYPES[p.payment_type]||p.payment_type}</td><td>{money(p.amount)}</td><td>{fmtDate(p.due_date)}</td><td><span className={`suite-status status-${p.status}`}>{PAYMENT_STATUS[p.status]||p.status}</span></td><td>{p.reference||"—"}</td><td>{canManage&&<button className="suite-link" onClick={()=>open(p)}>Cập nhật</button>}</td></tr>)}{!rows.length&&<tr><td colSpan="8"><div className="suite-empty">Chưa có lịch thanh toán.</div></td></tr>}</tbody></table></div></section>}
function Commissions({rows,canManage,open}){return <section className="suite-panel"><div className="suite-table-wrap"><table className="suite-table"><thead><tr><th>Sale</th><th>Khách/Giao dịch</th><th>Cơ sở</th><th>Tỷ lệ</th><th>Hoa hồng</th><th>Trạng thái</th><th>Ngày chi</th><th/></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><b>{c.user_name}</b></td><td>{c.deal_lead_name||"—"}</td><td>{money(c.basis_amount)}</td><td>{Number(c.rate||0)}%</td><td><b>{money(c.amount)}</b></td><td><span className={`suite-status status-${c.status}`}>{COMMISSION_STATUS[c.status]||c.status}</span></td><td>{fmtDate(c.paid_at,true)}</td><td>{canManage&&<button className="suite-link" onClick={()=>open(c)}>Cập nhật</button>}</td></tr>)}{!rows.length&&<tr><td colSpan="8"><div className="suite-empty">Chưa có hoa hồng.</div></td></tr>}</tbody></table></div></section>}

function ModalShell({title,subtitle,children,onClose,onSubmit}){return <div className="finance-modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="finance-modal" onSubmit={onSubmit}><header><div><span className="eyebrow">PTM FINANCE</span><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button type="button" onClick={onClose}>×</button></header>{children}<footer><button type="button" className="suite-btn" onClick={onClose}>Hủy</button><button className="suite-btn primary">Lưu</button></footer></form></div>}
function Field({label,children,wide}){return <label className={wide?"wide":""}><span>{label}</span>{children}</label>}

function DepositModal({modal,setModal,save}){
  const d=modal.draft,w=modal.workflow;const set=(k,v)=>setModal({...modal,draft:{...d,[k]:v}});
  const submit=async e=>{e.preventDefault();await save("workflow.deposit.confirm",d);setModal(null)};
  return <ModalShell title="Xác nhận phiếu cọc" subtitle={`${w.lead_name} · ${w.property_code||w.property_name||"Mộ phần"}`} onClose={()=>setModal(null)} onSubmit={submit}><div className="finance-confirm-box"><b>Sau khi lưu</b><span>Khoản cọc được ghi nhận là đã thu và giao dịch tự chuyển sang giai đoạn Đặt cọc. Mộ phần đồng bộ sang trạng thái Đặt cọc.</span></div><div className="finance-form-grid"><Field label="Số tiền cọc"><input required type="number" min="1" value={d.amount} onChange={e=>set("amount",e.target.value)} placeholder="Nhập số tiền thực thu"/></Field><Field label="Thời gian thu"><input type="datetime-local" value={d.paid_at} onChange={e=>set("paid_at",e.target.value)}/></Field><Field label="Mã phiếu thu / UNC"><input value={d.reference} onChange={e=>set("reference",e.target.value)} placeholder="Ví dụ: PT-001"/></Field><Field label="Ghi chú"><input value={d.notes} onChange={e=>set("notes",e.target.value)} placeholder="Nội dung cọc"/></Field></div></ModalShell>
}

function ContractModal({modal,setModal,data,role,save}){
  const d=modal.draft; const set=(k,v)=>setModal({...modal,draft:{...d,[k]:v}}); const sale=role==="sale";
  const submit=async e=>{e.preventDefault();await save("contract.save",{...d,status:sale?"draft":d.status});setModal(null)};
  return <ModalShell title={d.id?"Cập nhật hợp đồng":"Tạo hợp đồng"} onClose={()=>setModal(null)} onSubmit={submit}><div className="finance-form-grid"><Field label="Khách hàng"><select required value={d.lead_id} onChange={e=>set("lead_id",e.target.value)}><option value="">Chọn khách</option>{(data.leads||[]).map(l=><option key={l.id} value={l.id}>{l.name} · {l.phone}</option>)}</select></Field><Field label="Giao dịch"><select value={d.deal_id||""} onChange={e=>{const deal=(data.deals||[]).find(x=>x.id===e.target.value);setModal({...modal,draft:{...d,deal_id:e.target.value,lead_id:deal?.lead_id||d.lead_id,property_id:deal?.property_id||d.property_id,total_value:deal?.value||d.total_value}})}}><option value="">Không gắn</option>{(data.deals||[]).map(x=><option key={x.id} value={x.id}>{x.lead_name} · {x.property_name}</option>)}</select></Field><Field label="Sản phẩm"><select value={d.property_id||""} onChange={e=>set("property_id",e.target.value)}><option value="">Không gắn</option>{(data.properties||[]).map(p=><option key={p.id} value={p.id}>{p.project} · {p.code}</option>)}</select></Field><Field label="Loại hồ sơ"><select value={d.contract_type} onChange={e=>set("contract_type",e.target.value)}>{Object.entries(CONTRACT_TYPES).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Trạng thái"><select disabled={sale} value={sale?"draft":d.status} onChange={e=>set("status",e.target.value)}>{Object.entries(CONTRACT_STATUS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Giá trị hợp đồng"><input type="number" min="0" value={d.total_value||""} onChange={e=>set("total_value",e.target.value)}/></Field><Field label="Ngày ký"><input type="date" value={String(d.signed_at||"").slice(0,10)} onChange={e=>set("signed_at",e.target.value)}/></Field><Field label="Ngày hiệu lực"><input type="date" value={String(d.effective_date||"").slice(0,10)} onChange={e=>set("effective_date",e.target.value)}/></Field><Field label="Link hồ sơ / PDF" wide><input value={d.document_url||""} onChange={e=>set("document_url",e.target.value)} placeholder="https://..."/></Field><Field label="Ghi chú" wide><textarea value={d.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div>{sale&&<div className="finance-confirm-box"><b>Quyền Sale</b><span>Sale được soạn hợp đồng nháp. Kế toán/Admin/Giám đốc sẽ duyệt và chuyển sang Đã ký.</span></div>}</ModalShell>
}
function PaymentModal({modal,setModal,data,contracts,save}){
  const d=modal.draft; const set=(k,v)=>setModal({...modal,draft:{...d,[k]:v}}); const submit=async e=>{e.preventDefault();await save("payment.save",d);setModal(null)};
  return <ModalShell title={d.id?"Cập nhật khoản thu":"Ghi nhận thanh toán"} onClose={()=>setModal(null)} onSubmit={submit}><div className="finance-form-grid"><Field label="Hợp đồng"><select value={d.contract_id||""} onChange={e=>{const c=contracts.find(x=>x.id===e.target.value);setModal({...modal,draft:{...d,contract_id:e.target.value,lead_id:c?.lead_id||d.lead_id,deal_id:c?.deal_id||d.deal_id}})}}><option value="">Không gắn</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.code} · {c.lead_name}</option>)}</select></Field><Field label="Khách hàng"><select required value={d.lead_id} onChange={e=>set("lead_id",e.target.value)}><option value="">Chọn khách</option>{(data.leads||[]).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Loại khoản thu"><select value={d.payment_type} onChange={e=>set("payment_type",e.target.value)}>{Object.entries(PAYMENT_TYPES).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Số tiền"><input required type="number" min="0" value={d.amount||""} onChange={e=>set("amount",e.target.value)}/></Field><Field label="Hạn thanh toán"><input type="date" value={String(d.due_date||"").slice(0,10)} onChange={e=>set("due_date",e.target.value)}/></Field><Field label="Trạng thái"><select value={d.status} onChange={e=>set("status",e.target.value)}>{Object.entries(PAYMENT_STATUS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Ngày đã thu"><input type="datetime-local" value={d.paid_at?String(d.paid_at).slice(0,16):""} onChange={e=>set("paid_at",e.target.value)}/></Field><Field label="Mã tham chiếu"><input value={d.reference||""} onChange={e=>set("reference",e.target.value)} placeholder="UNC/phiếu thu..."/></Field><Field label="Ghi chú" wide><textarea value={d.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div><div className="finance-confirm-box"><b>Tự động đối soát</b><span>Khi tổng tiền đã thu đạt giá trị HĐ đã ký, hệ thống tự hoàn tất giao dịch và chuyển mộ phần sang Đã bán.</span></div></ModalShell>
}
function CommissionModal({modal,setModal,data,sales,save}){
  const d=modal.draft; const set=(k,v)=>setModal({...modal,draft:{...d,[k]:v}}); const submit=async e=>{e.preventDefault();await save("commission.save",d);setModal(null)};
  return <ModalShell title={d.id?"Cập nhật hoa hồng":"Thiết lập hoa hồng"} onClose={()=>setModal(null)} onSubmit={submit}><div className="finance-form-grid"><Field label="Giao dịch"><select required value={d.deal_id} onChange={e=>{const deal=(data.deals||[]).find(x=>x.id===e.target.value);setModal({...modal,draft:{...d,deal_id:e.target.value,user_id:deal?.owner_id||d.user_id,basis_amount:deal?.value||d.basis_amount}})}}><option value="">Chọn giao dịch</option>{(data.deals||[]).map(x=><option key={x.id} value={x.id}>{x.lead_name} · {x.property_name} · {compactMoney(x.value)}</option>)}</select></Field><Field label="Nhân viên hưởng"><select required value={d.user_id} onChange={e=>set("user_id",e.target.value)}><option value="">Chọn Sale</option>{sales.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field><Field label="Giá trị tính hoa hồng"><input type="number" min="0" value={d.basis_amount||""} onChange={e=>set("basis_amount",e.target.value)}/></Field><Field label="Tỷ lệ %"><input type="number" min="0" step="0.01" value={d.rate||""} onChange={e=>set("rate",e.target.value)}/></Field><Field label="Số tiền (để trống = tự tính)"><input type="number" min="0" value={d.amount||""} onChange={e=>set("amount",e.target.value)}/></Field><Field label="Trạng thái"><select value={d.status} onChange={e=>set("status",e.target.value)}>{Object.entries(COMMISSION_STATUS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="Ghi chú" wide><textarea value={d.notes||""} onChange={e=>set("notes",e.target.value)}/></Field></div></ModalShell>
}