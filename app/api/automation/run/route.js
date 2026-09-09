import { bearerToken, serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const token = bearerToken(request);
    if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

    const result = await serverRpc("crm_automation_sweep_v1", { p_token:token });
    if (!result?.ok && result?.code === "UNAUTHENTICATED") {
      return Response.json(result, { status:401, headers:{ "Cache-Control":"no-store" } });
    }
    return Response.json(result || { ok:false, error:"AUTOMATION_SWEEP_FAILED" }, { status:result?.ok ? 200 : 400, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "AUTOMATION_SWEEP_FAILED" }, { status:500 });
  }
}
