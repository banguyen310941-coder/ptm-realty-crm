import { createClient } from "@neondatabase/neon-js";

const DB_URL = process.env.NEXT_PUBLIC_NEON_DATA_API_URL ||
  "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";

let client;

function getClient() {
  if (!client) client = createClient(DB_URL, { auth: { allowAnonymous: true } });
  return client;
}

export function unwrapRpc(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function serverRpc(name, args = {}) {
  const { data, error } = await getClient().rpc(name, args);
  if (error) throw new Error(error.message || `RPC ${name} failed`);
  return unwrapRpc(data);
}

export function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}
