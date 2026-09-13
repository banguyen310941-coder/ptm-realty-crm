"use client";

import { useEffect, useState } from "react";

function detectPlatform(){
  if(typeof navigator==="undefined") return "other";
  const ua=navigator.userAgent||"";
  const isIOS=/iPad|iPhone|iPod/.test(ua) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  if(isIOS) return "ios";
  if(/Android/i.test(ua)) return "android";
  if(/Windows/i.test(ua)) return "windows";
  if(/Macintosh|Mac OS X/i.test(ua)) return "mac";
  return "other";
}

function isStandalone(){
  if(typeof window==="undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone===true;
}

export default function PwaInstallCard({compact=false}){
  const[installed,setInstalled]=useState(false);
  const[canPrompt,setCanPrompt]=useState(false);
  const[platform,setPlatform]=useState("other");
  const[message,setMessage]=useState("");

  useEffect(()=>{
    const refresh=()=>{
      setInstalled(isStandalone());
      setCanPrompt(Boolean(window.__ptmInstallPrompt));
      setPlatform(detectPlatform());
    };
    refresh();
    window.addEventListener("ptm-pwa-installable",refresh);
    window.addEventListener("ptm-pwa-installed",refresh);
    return()=>{
      window.removeEventListener("ptm-pwa-installable",refresh);
      window.removeEventListener("ptm-pwa-installed",refresh);
    };
  },[]);

  async function install(){
    const prompt=window.__ptmInstallPrompt;
    if(!prompt){
      setMessage(platform==="ios"
        ?"Trên iPhone/iPad: mở nút Chia sẻ của Safari → Thêm vào Màn hình chính."
        :"Mở menu trình duyệt và chọn Cài đặt ứng dụng / Install app / Thêm vào màn hình chính.");
      return;
    }

    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice?.outcome==="accepted"){
        window.__ptmInstallPrompt=null;
        setInstalled(true);
        setMessage("Đã gửi yêu cầu cài PTM CRM.");
      }else{
        setMessage("Bạn có thể cài lại bất kỳ lúc nào trong mục Cài app & Hướng dẫn.");
      }
      setCanPrompt(false);
    }catch{
      setMessage("Không thể mở hộp thoại cài đặt. Hãy dùng menu của trình duyệt để cài app.");
    }
  }

  if(installed){
    return <div className={compact?"pwa-install-card compact installed":"pwa-install-card installed"}>
      <div className="pwa-install-badge">✓</div>
      <div><b>PTM CRM đã được cài</b><span>Mở từ biểu tượng trên màn hình chính để dùng như ứng dụng.</span></div>
    </div>;
  }

  return <div className={compact?"pwa-install-card compact":"pwa-install-card"}>
    <div className="pwa-install-head">
      <div className="pwa-app-icon">PTM</div>
      <div>
        <b>Cài PTM CRM trên thiết bị</b>
        <span>Truy cập nhanh như ứng dụng, không cần App Store/CH Play.</span>
      </div>
    </div>
    <button type="button" className="suite-btn primary" onClick={install}>
      {canPrompt?"Cài ứng dụng PTM CRM":"Xem cách cài trên thiết bị này"}
    </button>
    {platform==="ios"&&<small><b>iPhone/iPad:</b> dùng Safari → Chia sẻ → Thêm vào Màn hình chính.</small>}
    {platform==="android"&&!canPrompt&&<small><b>Android:</b> Chrome → ⋮ → Cài đặt ứng dụng hoặc Thêm vào màn hình chính.</small>}
    {platform==="windows"&&!canPrompt&&<small><b>Windows:</b> Chrome/Edge → menu → Apps/Cài đặt PTM CRM.</small>}
    {platform==="mac"&&!canPrompt&&<small><b>Mac:</b> Chrome/Edge → menu → Cài đặt PTM CRM; Safari mới có thể dùng File → Add to Dock.</small>}
    {message&&<small className="pwa-install-message">{message}</small>}
  </div>;
}
