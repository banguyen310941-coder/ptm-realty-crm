"use server";

import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";

export async function loginAction(_prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Vui lòng nhập email và mật khẩu." };
  }

  const rows = await query(
    `SELECT id::text,name,email,password_hash,role,active
     FROM users WHERE email=$1 LIMIT 1`,
    [email]
  );
  const user = rows[0];

  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return { error: "Email hoặc mật khẩu không đúng." };
  }

  await createSession(user);
  await query(
    `INSERT INTO activity_log(user_id,action,entity_type,detail) VALUES($1,'login','auth',$2)`,
    [user.id, user.email]
  );
  redirect("/dashboard");
}
