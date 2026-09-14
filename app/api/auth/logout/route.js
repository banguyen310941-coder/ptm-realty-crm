import { NextResponse } from "next/server";
import { bearerToken, CRM_SESSION_COOKIE, serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const token = bearerToken(request);
  if (token) {
    try {
      await serverRpc("crm_api_v2",{ p_token:token,p_action:"logout",p_payload:{} });
    } catch {
      // Cookie clearing is authoritative on the client side even if the DB is temporarily unavailable.
    }
  }

  const response = NextResponse.json({ ok:true },{ status:200,headers:{ "Cache-Control":"no-store" } });
  response.cookies.set(CRM_SESSION_COOKIE,"",{ httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"strict",path:"/",maxAge:0 });
  return response;
}
