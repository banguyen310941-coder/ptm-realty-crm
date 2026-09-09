import { integrationStatus } from "@/lib/integration-channels";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { ok:true, ...integrationStatus() },
    { status:200, headers:{ "Cache-Control":"no-store" } }
  );
}
