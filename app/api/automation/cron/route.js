import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { runFacebookRetryBatch } from "@/lib/facebook-retry";
import { verifyGitHubHousekeepingToken } from "@/lib/github-actions-oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

function noStore(status,body) {
  return Response.json(body,{ status,headers:{ "Cache-Control":"no-store" } });
}

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) return noStore(401,{ ok:false,error:"UNAUTHENTICATED" });

  try {
    // Scheduled GitHub Actions use a short-lived, signed OIDC token. This restores
    // background housekeeping without storing a long-lived CRM credential in GitHub.
    if (token.split(".").length === 3) {
      const oidc = await verifyGitHubHousekeepingToken(token);
      if (!oidc?.ok) return noStore(401,{ ok:false,error:"INVALID_GITHUB_OIDC",code:oidc?.code || "OIDC_INVALID" });

      const result = await serverRpc("crm_housekeeping_tick_v2",{});
      const facebookRetry = result?.ok
        ? await runFacebookRetryBatch({ limit:8,minIntervalMs:0,force:true }).catch((error) => ({
            ok:false,error:error?.message || "FACEBOOK_RETRY_FAILED"
          }))
        : { ok:true,skipped:true,reason:"SWEEP_NOT_OK" };

      return noStore(result?.ok ? 200 : 503,{
        ...(result || { ok:false,error:"HOUSEKEEPING_FAILED" }),
        facebook_retry:facebookRetry,
        auth:"github_oidc",
        run_id:oidc.run_id || null
      });
    }

    // Keep CRM-session authentication for manual/admin compatibility.
    const result = await serverRpc("crm_automation_sweep_v1",{ p_token:token });
    if (!result?.ok && result?.code === "UNAUTHENTICATED") return noStore(401,result);

    const facebookRetry = result?.ok
      ? await runFacebookRetryBatch({ limit:8,minIntervalMs:60000 }).catch((error) => ({
          ok:false,error:error?.message || "FACEBOOK_RETRY_FAILED"
        }))
      : { ok:true,skipped:true,reason:"SWEEP_NOT_OK" };

    return noStore(result?.ok ? 200 : 400,{
      ...(result || { ok:false,error:"HOUSEKEEPING_FAILED" }),
      facebook_retry:facebookRetry,
      auth:"crm_session"
    });
  } catch (error) {
    console.error("[automation-cron] failed", { code:error?.code || null,error:error?.message || "HOUSEKEEPING_FAILED" });
    return noStore(503,{ ok:false,error:error?.message || "HOUSEKEEPING_FAILED",code:error?.code || "HOUSEKEEPING_FAILED" });
  }
}
