import { NextResponse } from "next/server";
import { CRM_SESSION_COOKIE, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "");

    if (!email || !password || email.length > 320 || password.length > 256) {
      return NextResponse.json(
        { ok:false,error:"Email hoặc mật khẩu không đúng" },
        { status:400,headers:{ "Cache-Control":"no-store" } }
      );
    }

    const result = await serverRpc("crm_login",{ p_email:email,p_password:password });
    if (!result?.ok || !result?.token || !result?.user) {
      return NextResponse.json(
        { ok:false,error:result?.error || "Email hoặc mật khẩu không đúng" },
        { status:401,headers:{ "Cache-Control":"no-store" } }
      );
    }

    const response = NextResponse.json(
      { ok:true,user:result.user },
      { status:200,headers:{ "Cache-Control":"no-store" } }
    );
    response.cookies.set(CRM_SESSION_COOKIE,String(result.token),{
      httpOnly:true,
      secure:process.env.NODE_ENV === "production",
      sameSite:"strict",
      path:"/",
      maxAge:COOKIE_MAX_AGE
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok:false,error:"Không thể đăng nhập lúc này",code:error?.code || "LOGIN_FAILED" },
      { status:serverRpcErrorStatus(error),headers:{ "Cache-Control":"no-store" } }
    );
  }
}
