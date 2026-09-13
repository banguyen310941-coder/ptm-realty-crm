"use client";

import { useEffect } from "react";

export default function PwaRuntime(){
  useEffect(()=>{
    if(!("serviceWorker" in navigator)) return;

    let refreshing=false;
    const onControllerChange=()=>{
      if(refreshing) return;
      refreshing=true;
      window.dispatchEvent(new Event("ptm-pwa-updated"));
    };

    const onBeforeInstall=(event)=>{
      event.preventDefault();
      window.__ptmInstallPrompt=event;
      window.dispatchEvent(new Event("ptm-pwa-installable"));
    };

    const onInstalled=()=>{
      window.__ptmInstallPrompt=null;
      window.dispatchEvent(new Event("ptm-pwa-installed"));
    };

    window.addEventListener("beforeinstallprompt",onBeforeInstall);
    window.addEventListener("appinstalled",onInstalled);
    navigator.serviceWorker.addEventListener("controllerchange",onControllerChange);

    navigator.serviceWorker.register("/sw.js",{scope:"/"})
      .then((registration)=>{
        registration.update().catch(()=>{});
      })
      .catch((error)=>console.error("[pwa] service worker registration failed",error));

    return()=>{
      window.removeEventListener("beforeinstallprompt",onBeforeInstall);
      window.removeEventListener("appinstalled",onInstalled);
      navigator.serviceWorker.removeEventListener("controllerchange",onControllerChange);
    };
  },[]);

  return null;
}
