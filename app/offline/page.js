export const metadata={ title:"Ngoại tuyến · PTM CRM" };

export default function OfflinePage(){
  return <main className="pwa-offline">
    <section>
      <div className="pwa-app-icon large">PTM</div>
      <span className="eyebrow">PTM CRM · NGOẠI TUYẾN</span>
      <h1>Thiết bị đang mất kết nối Internet</h1>
      <p>PTM CRM không lưu dữ liệu khách hàng, giao dịch, tài chính hoặc phiên đăng nhập vào bộ nhớ offline của service worker. Hãy kết nối Internet để tiếp tục làm việc với dữ liệu mới nhất.</p>
      <a className="suite-btn primary" href="/">Thử kết nối lại</a>
    </section>
  </main>;
}
