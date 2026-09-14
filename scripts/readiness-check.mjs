import fs from "node:fs";
import assert from "node:assert/strict";

function read(path){ return fs.readFileSync(new URL(`../${path}`, import.meta.url),"utf8"); }

const app=read("components/full-crm-app.js");
assert(!app.includes("automationSweep"),"Browser CRM must not trigger housekeeping sweeps.");
assert(!app.includes("setInterval(tick,240000)"),"Per-browser 4-minute housekeeping polling must stay disabled.");
assert(app.includes("Promise.allSettled"),"Extended CRM and Finance bootstrap should load concurrently.");

const rbac=read("lib/rbac.js");
for(const role of ["ceo","admin","manager","marketing","sale","accounting"]){
  assert(rbac.includes(`${role}:`),`Missing RBAC role: ${role}`);
}
assert(/sale:\s*\{[\s\S]*?leads_scope:\s*"own"/m.test(rbac),"Sale lead scope must remain own.");
assert(/admin:\s*\{[\s\S]*?users_manage:\s*true/m.test(rbac),"Only Admin baseline must retain account management.");

const sw=read("public/sw.js");
assert(sw.includes('if(url.pathname.startsWith("/api/")) return;'),"Service worker must never cache CRM APIs.");

const next=read("next.config.mjs");
assert(next.includes("frame-ancestors 'none'"),"CSP frame protection missing.");
assert(next.includes("object-src 'none'"),"CSP object-src protection missing.");

const housekeeping=read(".github/workflows/housekeeping.yml");
assert(housekeeping.includes('cron: "*/5 * * * *"'),"Server housekeeping schedule must remain enabled.");

console.log("PTM CRM readiness checks passed.");
