import { query } from "@/lib/db";
import { canManageAll } from "@/lib/auth";

function ownerFilter(user, column = "owner_id") {
  if (canManageAll(user)) return { sql: "", params: [] };
  return { sql: ` WHERE ${column} = $1`, params: [user.id] };
}

export async function getDashboard(user) {
  const leadFilter = ownerFilter(user, "owner_id");
  const dealFilter = ownerFilter(user, "owner_id");
  const taskFilter = ownerFilter(user, "owner_id");

  const [leadRows, dealRows, taskRows, recentLeads, sourceRows] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status <> 'lost')::int AS active,
              COUNT(*) FILTER (WHERE status = 'new')::int AS new_count,
              COALESCE(SUM(budget) FILTER (WHERE status IN ('hot','visit','deal')),0)::numeric AS pipeline
       FROM leads${leadFilter.sql}`,
      leadFilter.params
    ),
    query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(value),0)::numeric AS value,
              COALESCE(SUM(commission),0)::numeric AS commission
       FROM deals${dealFilter.sql}`,
      dealFilter.params
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE done=false)::int AS open,
              COUNT(*) FILTER (WHERE done=true)::int AS done
       FROM tasks${taskFilter.sql}`,
      taskFilter.params
    ),
    query(
      `SELECT l.id::text,l.name,l.phone,l.need,l.project,l.budget,l.status,u.name AS owner_name
       FROM leads l
       LEFT JOIN users u ON u.id=l.owner_id
       ${canManageAll(user) ? "" : "WHERE l.owner_id = $1"}
       ORDER BY l.updated_at DESC
       LIMIT 6`,
      canManageAll(user) ? [] : [user.id]
    ),
    query(
      `SELECT source, COUNT(*)::int AS count
       FROM leads
       ${canManageAll(user) ? "" : "WHERE owner_id = $1"}
       GROUP BY source
       ORDER BY count DESC`,
      canManageAll(user) ? [] : [user.id]
    )
  ]);

  return {
    leads: leadRows[0],
    deals: dealRows[0],
    tasks: taskRows[0],
    recentLeads,
    sources: sourceRows
  };
}

export async function getUsers(activeOnly = false) {
  return query(
    `SELECT id::text,name,email,role,active,created_at
     FROM users
     ${activeOnly ? "WHERE active=true" : ""}
     ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name`
  );
}

export async function getLeads(user, search = "", status = "") {
  const clauses = [];
  const params = [];
  if (!canManageAll(user)) {
    params.push(user.id);
    clauses.push(`l.owner_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR COALESCE(l.project,'') ILIKE $${params.length} OR COALESCE(l.need,'') ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    clauses.push(`l.status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query(
    `SELECT l.id::text,l.name,l.phone,l.email,l.source,l.need,l.budget,l.status,l.project,l.notes,l.owner_id::text,
            l.created_at,l.updated_at,u.name AS owner_name
     FROM leads l
     LEFT JOIN users u ON u.id=l.owner_id
     ${where}
     ORDER BY l.updated_at DESC
     LIMIT 300`,
    params
  );
}

export async function getProperties(search = "") {
  const params = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE name ILIKE $1 OR code ILIKE $1 OR project ILIKE $1 OR property_type ILIKE $1`;
  }
  return query(
    `SELECT id::text,name,code,project,property_type,area,bedrooms,price,status,notes,created_at,updated_at
     FROM properties ${where}
     ORDER BY updated_at DESC
     LIMIT 300`,
    params
  );
}

export async function getDeals(user) {
  const params = canManageAll(user) ? [] : [user.id];
  const where = canManageAll(user) ? "" : "WHERE d.owner_id=$1";
  return query(
    `SELECT d.id::text,d.value,d.commission,d.stage,d.deal_date,d.notes,d.owner_id::text,
            l.id::text AS lead_id,l.name AS lead_name,
            p.id::text AS property_id,p.name AS property_name,
            u.name AS owner_name
     FROM deals d
     LEFT JOIN leads l ON l.id=d.lead_id
     LEFT JOIN properties p ON p.id=d.property_id
     LEFT JOIN users u ON u.id=d.owner_id
     ${where}
     ORDER BY d.deal_date DESC,d.created_at DESC
     LIMIT 300`,
    params
  );
}

export async function getTasks(user) {
  const params = canManageAll(user) ? [] : [user.id];
  const where = canManageAll(user) ? "" : "WHERE t.owner_id=$1";
  return query(
    `SELECT t.id::text,t.title,t.task_type,t.due_at,t.done,t.priority,t.owner_id::text,
            u.name AS owner_name,l.name AS lead_name,l.id::text AS lead_id
     FROM tasks t
     LEFT JOIN users u ON u.id=t.owner_id
     LEFT JOIN leads l ON l.id=t.lead_id
     ${where}
     ORDER BY t.done ASC,t.due_at ASC NULLS LAST,t.created_at DESC
     LIMIT 300`,
    params
  );
}
