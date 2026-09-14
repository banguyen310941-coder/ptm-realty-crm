import fs from "node:fs";
import assert from "node:assert/strict";

function read(path){ return fs.readFileSync(new URL(`../${path}`, import.meta.url),"utf8"); }

const app=read("components/full-crm-app.js");
assert(!app.includes("automationSweep"),"Browser CRM must not trigger housekeeping sweeps.");
assert(!app.includes("setInterval(tick,240000)"),"Per-browser 4-minute housekeeping polling must stay disabled.");
assert(app.includes("Promise.allSettled"),"Extended CRM and Finance bootstrap should load concurrently.");
assert(!app.includes("localStorage.setItem(SESSION_KEY"),"CRM session token must not be persisted in localStorage.");
assert(app.includes('token:"cookie"'),"Client session should use a non-secret cookie sentinel.");

const rbac=read("lib/rbac.js");
for(const role of ["ceo","admin","manager","marketing","sale","accounting"]){
  assert(rbac.includes(`${role}:`),`Missing RBAC role: ${role}`);
}
assert(/sale:\s*\{[\s\S]*?leads_scope:\s*"own"/m.test(rbac),"Sale lead scope must remain own.");
assert(/admin:\s*\{[\s\S]*?users_manage:\s*true/m.test(rbac),"Only Admin baseline must retain account management.");

const crmClient=read("lib/crm-client.js");
assert(!crmClient.includes("@neondatabase/neon-js"),"Browser CRM client must not import Neon directly.");
assert(!crmClient.includes("createClient("),"Browser CRM client must not create a Neon client.");
assert(crmClient.includes("/api/crm/rpc"),"Browser CRM calls must go through the server RPC proxy.");

const attendance=read("components/attendance-launcher.js");
const leadOffer=read("components/lead-offer-alert.js");
assert(!attendance.includes("client.rpc"),"Attendance must use the server proxy.");
assert(!leadOffer.includes("client.rpc"),"Lead offer polling must use the server proxy.");

const authLogin=read("app/api/auth/login/route.js");
assert(authLogin.includes("httpOnly:true"),"CRM auth cookie must be HttpOnly.");
assert(authLogin.includes('sameSite:"strict"'),"CRM auth cookie must be SameSite=Strict.");

const sw=read("public/sw.js");
assert(sw.includes('if(url.pathname.startsWith("/api/")) return;'),"Service worker must never cache CRM APIs.");

const next=read("next.config.mjs");
assert(next.includes("frame-ancestors 'none'"),"CSP frame protection missing.");
assert(next.includes("object-src 'none'"),"CSP object-src protection missing.");
assert(!next.includes("aws.neon.tech"),"Browser CSP must not allow direct Neon connections.");

const loginMigration=read("sql/login-capacity-bcrypt-20260914.sql");
assert(loginMigration.includes("crypt(p_password,p_encoded)=p_encoded"),"Bcrypt verification compatibility missing.");
assert(loginMigration.includes("u.password_hash LIKE 'pbkdf2_sha256$%'"),"Legacy password auto-upgrade missing.");
assert(loginMigration.includes("gen_salt('bf',10)"),"Bcrypt cost baseline missing.");

const opportunityFallback=read("components/crm-suite/opportunities-cemetery.js");
const quickLauncher=read("components/customer-quick-launcher.js");
assert(!opportunityFallback.includes("localStorage.getItem(SESSION_KEY"),"Opportunity fallback must not read legacy session storage.");
assert(!quickLauncher.includes("localStorage.getItem(SESSION_KEY"),"Quick customer launcher must not read legacy session storage.");

const housekeeping=read(".github/workflows/housekeeping.yml");
assert(housekeeping.includes('cron: "*/5 * * * *"'),"Server housekeeping schedule must remain enabled.");
const housekeepingGuard=read("sql/housekeeping-slot-guard-20260914.sql");
assert(housekeepingGuard.includes("crm_housekeeping_tick_slots"),"Housekeeping slot guard table is missing.");
assert(housekeepingGuard.includes("duplicate_slot"),"Housekeeping public tick must stay idempotent per time slot.");

console.log("PTM CRM readiness checks passed.");
