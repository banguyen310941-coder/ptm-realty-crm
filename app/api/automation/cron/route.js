import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { runFacebookRetryBatch } from "@/lib/facebook-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(request) {
  try {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { ok:false,error:"UNAUTHENTICATED",deprecated:true,use:"POST /api/automation/run" },
        { status:401,headers:{ "Cache-Control":"no-store" } }
      );
    }

    const result = await serverRpc("crm_automation_sweep_v1",{ p_token:token });
    if (!result?.ok && result?.code === "UNAUTHENTICATED") {
      return Response.json(result,{ status:401,headers:{ "Cache-Control":"no-store" } });
    }

    const facebookRetry = result?.ok
      ? await runFacebookRetryBatch({ limit:8,minIntervalMs:60000 }).catch((error) => ({
          ok:false,error:error?.message || "FACEBOOK_RETRY_FAILED"
        }))
      : { ok:true,skipped:true,reason:"SWEEP_NOT_OK" };

    return Response.json(
      { ...(result || { ok:false,error:"HOUSEKEEPING_FAILED" }),facebook_retry:facebookRetry,deprecated:true,use:"POST /api/automation/run" },
      { status:result?.ok ? 200 : 400,headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    return Response.json({ ok:false,error:error?.message || "HOUSEKEEPING_FAILED" }, {
      status:500,headers:{ "Cache-Control":"no-store" }
    });
  }
}
