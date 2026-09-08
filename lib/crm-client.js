"use client";

import { createClient } from "@neondatabase/neon-js";

export const DB_URL = "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";
export const client = createClient(DB_URL, { auth: { allowAnonymous: true } });
export const SESSION_KEY = "ptm_crm_session_v3";

export function unwrap(data) {
  return Array.isArray(data) ? data[0] : data;
}

function missingV2(err) {
  return err?.code === "PGRST202" || /crm_api_v2|schema cache|could not find the function/i.test(err?.message || "");
}

export async function coreRpc(token, action, payload = {}) {
  let response = await client.rpc("crm_api_v2", {
    p_token: token || "",
    p_action: action,
    p_payload: payload
  });
  if (response.error && missingV2(response.error)) {
    response = await client.rpc("crm_api", {
      p_token: token || "",
      p_action: action,
      p_payload: payload
    });
  }
  if (response.error) throw new Error(response.error.message || "Không kết nối được CRM");
  const out = unwrap(response.data);
  if (!out?.ok) throw new Error(out?.error || "Thao tác thất bại");
  return out;
}

export async function fullRpc(token, action, payload = {}) {
  const response = await client.rpc("crm_full_api", {
    p_token: token || "",
    p_action: action,
    p_payload: payload
  });
  if (response.error) {
    const message = response.error.message || "Không kết nối được CRM mở rộng";
    if (/crm_full_api|schema cache|could not find|PGRST202/i.test(message)) {
      const err = new Error("CRM mở rộng chưa được kích hoạt trên database chính.");
      err.code = "FULL_CRM_NOT_READY";
      throw err;
    }
    throw new Error(message);
  }
  const out = unwrap(response.data);
  if (!out?.ok) throw new Error(out?.error || "Thao tác CRM mở rộng thất bại");
  return out;
}

export async function loginRpc(email, password) {
  const { data, error } = await client.rpc("crm_login", {
    p_email: email,
    p_password: password
  });
  if (error) throw new Error(error.message || "Không thể đăng nhập");
  const out = unwrap(data);
  if (!out?.ok) throw new Error(out?.error || "Email hoặc mật khẩu không đúng");
  return out;
}

export function money(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

export function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)} tỷ`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} tr`;
  return money(n);
}

export function fmtDate(value, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", withTime ? {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  } : {
    day: "2-digit", month: "2-digit", year: "numeric"
  }).format(d);
}
