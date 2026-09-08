import Sidebar from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export default async function CrmLayout({ children }) {
  const user = await requireUser();
  return (
    <div className="app-shell">
      <Sidebar user={user} />
      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">PTM Realty CRM</span>
            <strong>Hệ thống kinh doanh bất động sản</strong>
          </div>
          <div className="top-user">
            <span className={`role role-${user.role}`}>{user.role}</span>
            <span>{user.email}</span>
          </div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}
