import "./enterprise.css";
import "./customer-form.css";
import "./customer-wave.css";
import "./customer-quick.css";
import "./finance.css";
import "./inventory-wave2.css";
import "./cemetery.css";
import "./automation.css";
import AttendanceLauncher from "@/components/attendance-launcher";
import LeadOfferAlert from "@/components/lead-offer-alert";
import CustomerQuickLauncher from "@/components/customer-quick-launcher";

export const metadata = {
  title: "PTM CRM · Thiên Phúc Vĩnh Hằng Viên",
  description: "CRM quản lý khách hàng, giỏ mộ phần, giao dịch và vận hành Thiên Phúc Vĩnh Hằng Viên"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        {children}
        <CustomerQuickLauncher />
        <AttendanceLauncher />
        <LeadOfferAlert />
      </body>
    </html>
  );
}
