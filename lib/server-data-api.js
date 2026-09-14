import { createClient } from "@neondatabase/neon-js";

const DEFAULT_DB_URL = "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";
const DB_URL = String(process.env.NEXT_PUBLIC_NEON_DATA_API_URL || DEFAULT_DB_URL).trim();
const TRANSIENT_RPC_ERROR = /PGRST202|schema cache|could not find the function|fetch failed|network|connection|temporar|timeout|timed out|503|gateway/i;
const RETRY_DELAYS_MS = [150,400,900,1800];

let client;

function getClient() {
  if (!client) client = createClient(DB_URL, { auth:{ allowAnonymous:true } });
  return client;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve,ms));
}

export function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function serverRpc(name,args = {}) {
  let lastError = null;

  for (let attempt=0; attempt<5; attempt += 1) {
    try {
      const { data,error } = await getClient().rpc(name,args);
      if (!error) return unwrapRpc(data);

      lastError = error;
      const message = String(error?.message || `RPC ${name} failed`);
      const retryable = error?.code === "PGRST202" || TRANSIENT_RPC_ERROR.test(message);
      if (retryable && attempt<4) {
        await sleep(RETRY_DELAYS_MS[attempt] || 1800);
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      if (TRANSIENT_RPC_ERROR.test(message) && attempt<4) {
        await sleep(RETRY_DELAYS_MS[attempt] || 1800);
        continue;
      }
      break;
    }
  }

  const message = String(lastError?.message || `RPC ${name} failed`);
  const code = lastError?.code || "RPC_ERROR";
  console.error("[serverRpc]", { name,code,message });
  const error = new Error(message);
  error.code = code;
  throw error;
}

export const CRM_SESSION_COOKIE = "ptm_crm_session";

function cookieValue(request,name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey,...rest] = part.trim().split("=");
    if (rawKey !== name) continue;
    try { return decodeURIComponent(rest.join("=")); } catch { return rest.join("="); }
  }
  return "";
}

export function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return cookieValue(request,CRM_SESSION_COOKIE);
}


export function serverRpcErrorStatus(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return /PGRST202|schema cache|RPC_ERROR|fetch failed|network|connection|timeout|timed out|temporar|503|gateway/i.test(code + " " + message)
    ? 503
    : 500;
}
