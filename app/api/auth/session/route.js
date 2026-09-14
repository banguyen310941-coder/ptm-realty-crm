import { NextResponse } from "next/server";
import { bearerToken, CRM_SESSION_COOKIE, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

function clear(response) {
  response.cookies.set(CRM_SESSION_COOKIE,"",{ httpOnly:true,secure:process.env.NODE_ENV === "production",sameSite:"strict",path:"/",maxAge:0 });
  return response;
}

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ ok:false,error:"UNAUTHENTICATED" },{ status:401,headers:{ "Cache-Control":"no-store" } });

  try {
    const result = await serverRpc("crm_api_v2",{ p_token:token,p_action:"bootstrap",p_payload:{} });
    if (!result?.ok) {
      const response = NextResponse.json(result || { ok:false,error:"UNAUTHENTICATED" },{ status:401,headers:{ "Cache-Control":"no-store" } });
      return clear(response);
    }
    return NextResponse.json({ ok:true,user:result.user },{ status:200,headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok:false,error:"SESSION_CHECK_FAILED",code:error?.code || "SESSION_CHECK_FAILED" },
      { status:serverRpcErrorStatus(error),headers:{ "Cache-Control":"no-store" } }
    );
  }
}
