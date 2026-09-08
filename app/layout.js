import "./globals.css";

export const metadata = {
  title: "PTM Realty CRM",
  description: "CRM bất động sản Phúc Trường Minh"
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
