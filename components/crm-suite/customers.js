"use client";

import { useCallback, useEffect, useState } from "react";
import { CustomersModule as CustomerCommandCenter } from "@/components/crm-suite/customers-command-center";
import { cemeteryRpc, financeRpc, SESSION_KEY } from "@/lib/crm-client";

const EMPTY_FINANCE={contracts:[],payments:[],commissions:[],workflows:[],summary:{contract_value:0,receivable:0,overdue:0,commission_pending:0}};

function readToken(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null")?.token||""}catch{return ""}
}

export function CustomersModule(props){
  const[finance,setFinance]=useState(EMPTY_FINANCE);
  const[financeReady,setFinanceReady]=useState(true);
  const cemeteryAction=useCallback(async(action,payload={})=>{
    const token=readToken();
    if(!token)throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    return cemeteryRpc(token,action,payload);
  },[]);

  useEffect(()=>{
    let stopped=false;
    async function loadFinance(){
      if(props.data?.user?.role==="marketing"){if(!stopped){setFinance(EMPTY_FINANCE);setFinanceReady(false)}return}
      const token=readToken();
      if(!token)return;
      try{
        const out=await financeRpc(token,"bootstrap",{});
        if(!stopped){setFinance({...EMPTY_FINANCE,...out,summary:{...EMPTY_FINANCE.summary,...(out.summary||{})}});setFinanceReady(true)}
      }catch(e){
        if(!stopped){setFinance(EMPTY_FINANCE);setFinanceReady(false)}
      }
    }
    loadFinance();
    const refresh=()=>loadFinance();
    window.addEventListener("ptm-crm-refresh",refresh);
    return()=>{stopped=true;window.removeEventListener("ptm-crm-refresh",refresh)};
  },[props.data?.user?.role]);

  return <CustomerCommandCenter {...props} finance={finance} financeReady={financeReady} cemeteryAction={cemeteryAction}/>;
}
