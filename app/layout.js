import "./globals.css";
import "./rpc.css";
import AttendanceLauncher from "@/components/attendance-launcher";
import LeadOfferAlert from "@/components/lead-offer-alert";

export const metadata = {
  title: "PTM Realty CRM",
  description: "CRM bất động sản Phúc Trường Minh"
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