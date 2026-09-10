import { serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const result = await serverRpc("crm_housekeeping_v1", {});
    const routingFailed = result?.lead_routing?.ok === false;
    const ok = Boolean(result?.ok) && !routingFailed;
    return Response.json(result || { ok:false, error:"HOUSEKEEPING_FAILED" }, {
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
