"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

const initialState = { error: "" };

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-badge">PTM</div>
        <h1>Phúc Trường Minh</h1>
        <p>Realty CRM</p>
        <div className="login-points">
          <span>Quản lý khách hàng & pipeline</span>
          <span>Giỏ hàng bất động sản tập trung</span>
          <span>Giao dịch, hoa hồng & công việc</span>
        </div>
      </section>

      <section className="login-card">
        <div>
          <span className="eyebrow">CRM nội bộ</span>
          <h2>Đăng nhập</h2>
          <p>Truy cập hệ thống quản lý kinh doanh bất động sản.</p>
        </div>
        <form action={action} className="form-stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="username" placeholder="admin@ptm.vn" required />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {state?.error ? <div className="alert">{state.error}</div> : null}
          <button className="btn primary wide" disabled={pending}>
            {pending ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
        <small>Hệ thống dành cho nhân sự được Phúc Trường Minh cấp quyền.</small>
      </section>
    </main>
  );
}
