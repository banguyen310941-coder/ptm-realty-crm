import { serverRpc } from "@/lib/server-data-api";
import { runFacebookRetryBatch } from "@/lib/facebook-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET() {
  try {
    const [result,facebookRetry] = await Promise.all([
      serverRpc("crm_housekeeping_cron_v1", {}),
      runFacebookRetryBatch({ limit:8, minIntervalMs:0, force:true }).catch((error) => ({
        ok:false,error:error?.message || "FACEBOOK_RETRY_FAILED"
      }))
    ]);
    const routingFailed = result?.lead_routing?.ok === false;
    const ok = Boolean(result?.ok) && !routingFailed;
    return Response.json({ ...(result || { ok:false, error:"HOUSEKEEPING_FAILED" }), facebook_retry:facebookRetry }, {
      status:ok ? 200 : 500,
      headers:{ "Cache-Control":"no-store" }
    });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "HOUSEKEEPING_FAILED" }, {
      status:500,
      headers:{ "Cache-Control":"no-store" }
    });
  }
}
