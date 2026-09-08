import "./enterprise.css";
import "./customer-form.css";
import "./customer-wave.css";
import "./finance.css";
import AttendanceLauncher from "@/components/attendance-launcher";
import LeadOfferAlert from "@/components/lead-offer-alert";

export const metadata = {
  title: "PTM Enterprise CRM",
  description: "CRM điều hành bất động sản Phúc Trường Minh"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        {children}
        <AttendanceLauncher />
        <LeadOfferAlert />
      </body>
    </html>
  );
}
