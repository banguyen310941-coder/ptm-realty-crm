"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { requireUser, canManageAll, isAdmin, destroySession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

function text(formData, key) {
  return String(formData.get(key) || "").trim();
}
function number(formData, key) {
  const v = Number(formData.get(key) || 0);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}
function optional(formData, key) {
  const v = text(formData, key);
  return v || null;
}
function allowed(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}
async function log(user, action, entityType, entityId, detail = "") {
  await query(
    `INSERT INTO activity_log(user_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)`,
    [user.id, action, entityType, entityId || null, detail || null]
  );
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function createLeadAction(formData) {
  const user = await requireUser();
  const ownerId = canManageAll(user) ? optional(formData, "owner_id") || user.id : user.id;
  const rows = await query(
    `INSERT INTO leads(name,phone,email,source,need,budget,status,project,owner_id,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id::text`,
    [
      text(formData, "name"),
      text(formData, "phone"),
      optional(formData, "email"),
      text(formData, "source") || "Khác",
      optional(formData, "need"),
      number(formData, "budget"),
      allowed(text(formData, "status"), ["new","contact","hot","visit","deal","lost"], "new"),
      optional(formData, "project"),
      ownerId,
      optional(formData, "notes")
    ]
  );
  await log(user, "create", "lead", rows[0]?.id, text(formData, "name"));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateLeadAction(formData) {
  const user = await requireUser();
  const id = text(formData, "id");
  const ownerId = canManageAll(user) ? optional(formData, "owner_id") || user.id : user.id;
  const params = [
    text(formData, "name"), text(formData, "phone"), optional(formData, "email"),
    text(formData, "source") || "Khác", optional(formData, "need"), number(formData, "budget"),
    allowed(text(formData, "status"), ["new","contact","hot","visit","deal","lost"], "new"),
    optional(formData, "project"), ownerId, optional(formData, "notes"), id
  ];
  let sql = `UPDATE leads SET name=$1,phone=$2,email=$3,source=$4,need=$5,budget=$6,status=$7,project=$8,owner_id=$9,notes=$10,updated_at=now() WHERE id=$11`;
  if (!canManageAll(user)) {
    params.push(user.id);
    sql += ` AND owner_id=$12`;
  }
  await query(sql, params);
  await log(user, "update", "lead", id, text(formData, "name"));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function deleteLeadAction(formData) {
  const user = await requireUser();
  if (!canManageAll(user)) return;
  const id = text(formData, "id");
  await query(`DELETE FROM leads WHERE id=$1`, [id]);
  await log(user, "delete", "lead", id);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function createPropertyAction(formData) {
  const user = await requireUser();
  if (!canManageAll(user)) return;
  const rows = await query(
    `INSERT INTO properties(name,code,project,property_type,area,bedrooms,price,status,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id::text`,
    [
      text(formData,"name"), text(formData,"code"), text(formData,"project"),
      text(formData,"property_type"), number(formData,"area"), Math.round(number(formData,"bedrooms")),
      number(formData,"price"),
      allowed(text(formData,"status"),["available","reserved","sold","locked"],"available"),
      optional(formData,"notes")
    ]
  );
  await log(user,"create","property",rows[0]?.id,text(formData,"name"));
  revalidatePath("/properties");
  revalidatePath("/dashboard");
}

export async function updatePropertyAction(formData) {
  const user = await requireUser();
  if (!canManageAll(user)) return;
  const id=text(formData,"id");
  await query(
    `UPDATE properties SET name=$1,code=$2,project=$3,property_type=$4,area=$5,bedrooms=$6,price=$7,status=$8,notes=$9,updated_at=now() WHERE id=$10`,
    [
      text(formData,"name"),text(formData,"code"),text(formData,"project"),text(formData,"property_type"),
      number(formData,"area"),Math.round(number(formData,"bedrooms")),number(formData,"price"),
      allowed(text(formData,"status"),["available","reserved","sold","locked"],"available"),
      optional(formData,"notes"),id
    ]
  );
  await log(user,"update","property",id,text(formData,"name"));
  revalidatePath("/properties");
}

export async function deletePropertyAction(formData) {
  const user=await requireUser();
  if (!canManageAll(user)) return;
  const id=text(formData,"id");
  await query(`DELETE FROM properties WHERE id=$1`,[id]);
  await log(user,"delete","property",id);
  revalidatePath("/properties");
}

export async function createDealAction(formData) {
  const user=await requireUser();
  const ownerId=canManageAll(user)? optional(formData,"owner_id")||user.id:user.id;
  const rows=await query(
    `INSERT INTO deals(lead_id,property_id,value,commission,stage,owner_id,deal_date,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
    [
      optional(formData,"lead_id"),optional(formData,"property_id"),number(formData,"value"),number(formData,"commission"),
      allowed(text(formData,"stage"),["booking","deposit","negotiation","contract","completed","cancelled"],"booking"),
      ownerId,text(formData,"deal_date")||new Date().toISOString().slice(0,10),optional(formData,"notes")
    ]
  );
  await log(user,"create","deal",rows[0]?.id);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}

export async function deleteDealAction(formData) {
  const user=await requireUser();
  const id=text(formData,"id");
  if (canManageAll(user)) {
    await query(`DELETE FROM deals WHERE id=$1`,[id]);
  } else {
    await query(`DELETE FROM deals WHERE id=$1 AND owner_id=$2`,[id,user.id]);
  }
  await log(user,"delete","deal",id);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}

export async function createTaskAction(formData) {
  const user=await requireUser();
  const ownerId=canManageAll(user)? optional(formData,"owner_id")||user.id:user.id;
  const dueRaw=optional(formData,"due_at");
  const due=dueRaw && !/[zZ]|[+-]\d\d:\d\d$/.test(dueRaw) ? `${dueRaw}:00+07:00` : dueRaw;
  const rows=await query(
    `INSERT INTO tasks(title,task_type,due_at,owner_id,lead_id,priority)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`,
    [
      text(formData,"title"),text(formData,"task_type")||"call",due,ownerId,optional(formData,"lead_id"),
      allowed(text(formData,"priority"),["low","normal","high"],"normal")
    ]
  );
  await log(user,"create","task",rows[0]?.id,text(formData,"title"));
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function toggleTaskAction(formData) {
  const user=await requireUser();
  const id=text(formData,"id");
  if (canManageAll(user)) {
    await query(`UPDATE tasks SET done=NOT done,updated_at=now() WHERE id=$1`,[id]);
  } else {
    await query(`UPDATE tasks SET done=NOT done,updated_at=now() WHERE id=$1 AND owner_id=$2`,[id,user.id]);
  }
  await log(user,"toggle","task",id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(formData) {
  const user=await requireUser();
  const id=text(formData,"id");
  if (canManageAll(user)) {
    await query(`DELETE FROM tasks WHERE id=$1`,[id]);
  } else {
    await query(`DELETE FROM tasks WHERE id=$1 AND owner_id=$2`,[id,user.id]);
  }
  await log(user,"delete","task",id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function createUserAction(formData) {
  const user=await requireUser();
  if (!isAdmin(user)) return;
  const password=text(formData,"password");
  if (password.length < 8) return;
  const role=allowed(text(formData,"role"),["admin","manager","sale"],"sale");
  const rows=await query(
    `INSERT INTO users(name,email,password_hash,role)
     VALUES($1,lower($2),$3,$4)
     ON CONFLICT (email) DO NOTHING
     RETURNING id::text`,
    [text(formData,"name"),text(formData,"email"),hashPassword(password),role]
  );
  if (rows[0]) await log(user,"create","user",rows[0].id,text(formData,"email"));
  revalidatePath("/team");
}

export async function toggleUserAction(formData) {
  const user=await requireUser();
  if (!isAdmin(user)) return;
  const id=text(formData,"id");
  if (id === user.id) return;
  await query(`UPDATE users SET active=NOT active,updated_at=now() WHERE id=$1`,[id]);
  await log(user,"toggle","user",id);
  revalidatePath("/team");
}
