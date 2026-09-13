import "./enterprise.css";
import "./customer-form.css";
import "./customer-wave.css";
import "./customer-command-center.css";
import "./customer-quick.css";
import "./finance.css";
import "./inventory-wave2.css";
import "./cemetery.css";
import "./automation.css";
import "./facebook-inbox.css";
import "./pwa.css";
import AttendanceLauncher from "@/components/attendance-launcher";
import LeadOfferAlert from "@/components/lead-offer-alert";
import CustomerQuickLauncher from "@/components/customer-quick-launcher";
import PwaRuntime from "@/components/pwa-runtime";

export const metadata = {
  title: "PTM CRM · Thiên Phúc Vĩnh Hằng Viên",
  description: "CRM quản lý khách hàng, giỏ mộ phần, giao dịch và vận hành Thiên Phúc Vĩnh Hằng Viên",
  applicationName:"PTM CRM",
  manifest:"/manifest.webmanifest",
  appleWebApp:{
    capable:true,
    title:"PTM CRM",
    statusBarStyle:"black-translucent"
  },
  icons:{
    icon:[{url:"/pwa/icon-192",type:"image/png",sizes:"192x192"},{url:"/pwa/icon-512",type:"image/png",sizes:"512x512"}],
    apple:[{url:"/pwa/icon-192",type:"image/png",sizes:"192x192"}]
  }
};

export const viewport = {
  themeColor:"#0c1729",
  width:"device-width",
  initialScale:1,
  viewportFit:"cover"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <PwaRuntime />
        {children}
        <CustomerQuickLauncher />
        <AttendanceLauncher />
        <LeadOfferAlert />
      </body>
    </html>
  );
}
