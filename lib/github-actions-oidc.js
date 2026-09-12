import { createPublicKey, verify } from "crypto";

const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
const AUDIENCE = "ptm-crm-housekeeping";
const REPOSITORY = "banguyen310941-coder/ptm-realty-crm";
const REPOSITORY_ID = "1360826424";
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/housekeeping.yml@refs/heads/main`;
const JWKS_CACHE_MS = 15 * 60 * 1000;

let jwksCache = { at:0, keys:[] };

function decodePart(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

async function getJwks() {
  if (jwksCache.keys.length && Date.now() - jwksCache.at < JWKS_CACHE_MS) return jwksCache.keys;
  const response = await fetch(JWKS_URL, {
    cache:"no-store",
    signal:AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("GITHUB_OIDC_JWKS_UNAVAILABLE");
  const data = await response.json().catch(() => ({}));
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error("GITHUB_OIDC_JWKS_EMPTY");
  jwksCache = { at:Date.now(),keys };
  return keys;
}

function audienceMatches(aud) {
  return Array.isArray(aud) ? aud.includes(AUDIENCE) : aud === AUDIENCE;
}

export async function verifyGitHubHousekeepingToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok:false,code:"OIDC_FORMAT" };

  let header;
  let claims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    return { ok:false,code:"OIDC_DECODE" };
  }

  if (header?.alg !== "RS256" || !header?.kid) return { ok:false,code:"OIDC_HEADER" };

  const keys = await getJwks();
  const jwk = keys.find((item) => item?.kid === header.kid && item?.kty === "RSA");
  if (!jwk) return { ok:false,code:"OIDC_KEY" };

  const signingInput = Buffer.from(parts[0] + "." + parts[1], "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  const publicKey = createPublicKey({ key:jwk,format:"jwk" });
  if (!verify("RSA-SHA256", signingInput, publicKey, signature)) return { ok:false,code:"OIDC_SIGNATURE" };

  const now = Math.floor(Date.now() / 1000);
  if (claims?.iss !== ISSUER) return { ok:false,code:"OIDC_ISSUER" };
  if (!audienceMatches(claims?.aud)) return { ok:false,code:"OIDC_AUDIENCE" };
  if (!Number.isFinite(Number(claims?.exp)) || Number(claims.exp) <= now) return { ok:false,code:"OIDC_EXPIRED" };
  if (Number.isFinite(Number(claims?.nbf)) && Number(claims.nbf) > now + 30) return { ok:false,code:"OIDC_NOT_YET_VALID" };
  if (String(claims?.repository_id || "") !== REPOSITORY_ID) return { ok:false,code:"OIDC_REPOSITORY_ID" };
  if (claims?.repository !== REPOSITORY) return { ok:false,code:"OIDC_REPOSITORY" };
  if (claims?.ref !== "refs/heads/main") return { ok:false,code:"OIDC_REF" };
  if (claims?.workflow_ref !== WORKFLOW_REF) return { ok:false,code:"OIDC_WORKFLOW" };
  if (!new Set(["schedule","workflow_dispatch"]).has(String(claims?.event_name || ""))) return { ok:false,code:"OIDC_EVENT" };
  if (claims?.runner_environment && claims.runner_environment !== "github-hosted") return { ok:false,code:"OIDC_RUNNER" };

  return {
    ok:true,
    run_id:String(claims?.run_id || ""),
    run_number:String(claims?.run_number || ""),
    event_name:String(claims?.event_name || "")
  };
}
