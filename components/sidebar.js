import Link from "next/link";
import { logoutAction } from "@/lib/actions";

const links = [
  ["/dashboard","▦","Tổng quan"],
  ["/leads","◎","Khách hàng"],
  ["/properties","⌂","Sản phẩm BĐS"],
  ["/deals","₫","Giao dịch"],
  ["/tasks","✓","Công việc"],
  ["/team","♟","Đội ngũ"]
];

export default function Sidebar({ user }) {
  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand">
        <div className="brand-mark">PTM</div>
        <div><strong>Phúc Trường Minh</strong><span>Realty CRM</span></div>
      </Link>

      <nav>
        {links.map(([href,icon,label]) => (
          <Link href={href} key={href} className="nav-item">
            <span>{icon}</span><span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="avatar">{user.name.slice(0,2).toUpperCase()}</div>
          <div><strong>{user.name}</strong><span>{user.role}</span></div>
        </div>
        <form action={logoutAction}>
          <button className="logout">Đăng xuất</button>
        </form>
      </div>
    </aside>
  );
}
