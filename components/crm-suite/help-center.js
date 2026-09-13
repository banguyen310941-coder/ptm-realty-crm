"use client";

import { useMemo, useState } from "react";
import { roleLabel } from "@/lib/rbac";
import PwaInstallCard from "@/components/pwa-install-card";

const DAILY_STEPS=[
  ["1","Mở PTM CRM từ biểu tượng ứng dụng","Đăng nhập bằng tài khoản công ty. Nếu đã cài PWA, ưu tiên mở từ biểu tượng PTM CRM trên màn hình chính."],
  ["2","Điểm danh và kiểm tra thông báo","Thực hiện chấm công theo quy định; xem thông báo và lead mới trước khi bắt đầu xử lý công việc."],
  ["3","Xử lý khách theo đúng trạng thái","Mở Khách hàng 360°, cập nhật nhu cầu, ghi chú, lịch sử chăm sóc và lịch hẹn ngay sau mỗi lần trao đổi."],
  ["4","Cập nhật công việc trong ngày","Dùng Công việc và Lịch hẹn để không bỏ sót cuộc gọi lại, lịch tư vấn, lịch đi dự án hoặc hạn xử lý."],
  ["5","Kết thúc ngày bằng dữ liệu sạch","Kiểm tra khách chưa xử lý, cơ hội đang mở, giao dịch và công việc quá hạn trước khi kết thúc ca."]
];

const ROLE_GUIDES={
  sale:[
    ["Lead 10 phút","Khi có popup lead mới, kiểm tra nhanh thông tin và nhận lead trong thời hạn. Sau khi nhận, liên hệ khách và cập nhật kết quả ngay trong CRM."],
    ["Khách hàng 360°","Lưu nhu cầu, ngân sách, nguồn khách, ghi chú cuộc gọi, lịch hẹn và bước chăm sóc tiếp theo. Không lưu dữ liệu khách ở file cá nhân nếu CRM đã có trường tương ứng."],
    ["Chat Fanpage","Trả lời khách được phân công; AI chỉ là gợi ý, nhân viên phải kiểm tra nội dung trước khi gửi."],
    ["Cơ hội & Pipeline","Đưa khách qua đúng giai đoạn khi có bằng chứng thực tế: tư vấn, đi xem, giữ chỗ, cọc, hợp đồng."],
    ["Giỏ mộ phần","Kiểm tra trạng thái và vị trí trước khi tư vấn. Không cam kết một vị trí nếu CRM chưa thể hiện còn khả dụng."],
    ["Giao dịch & Tài chính","Theo dõi giữ chỗ/cọc/hợp đồng của khách mình phụ trách; phối hợp Kế toán khi có khoản tiền cần xác nhận."]
  ],
  marketing:[
    ["Marketing","Theo dõi nguồn/campaign và chất lượng lead. Chuẩn hóa tên nguồn để báo cáo không bị phân mảnh."],
    ["Chat Fanpage","Theo dõi inbox, kịch bản tự động và các hội thoại chưa có SĐT. Không tự bật kịch bản AI khi chưa rà nội dung."],
    ["Nhập khách Excel","Chỉ nhập dữ liệu đã được làm sạch; kiểm tra SĐT, email và nguồn trước khi import để tránh xung đột nhận diện khách."],
    ["Khách hàng 360°","Dùng dữ liệu CRM để đánh giá nguồn và chiến dịch; không sửa thông tin nghiệp vụ Sale nếu không có căn cứ."],
    ["Automation","Theo dõi rule phục vụ marketing/chăm sóc khách; test kịch bản trước khi bật rộng."]
  ],
  accounting:[
    ["Hợp đồng & Tài chính","Kiểm tra hợp đồng, công nợ, khoản đến hạn và trạng thái thanh toán. Chỉ đánh dấu đã thu khi có chứng từ/xác nhận phù hợp."],
    ["Giao dịch","Đối chiếu giao dịch, khách hàng và vị trí trước khi xác nhận dữ liệu tài chính."],
    ["Khách hàng","Được xem thông tin phục vụ đối chiếu; hạn chế thay đổi dữ liệu bán hàng nếu không thuộc nghiệp vụ Kế toán."],
    ["Báo cáo","Kiểm tra số liệu thu, phải thu, quá hạn và hoa hồng trước khi gửi báo cáo nội bộ."]
  ],
  manager:[
    ["Tổng quan","Theo dõi lead mới, pipeline, hiệu suất Sale, công việc và cảnh báo vận hành mỗi ngày."],
    ["Khách hàng & Pipeline","Kiểm tra lead tồn, lead quá hạn chăm sóc và cơ hội đứng yên quá lâu; yêu cầu nhân viên cập nhật CRM thay vì báo cáo miệng."],
    ["Chat Fanpage","Theo dõi tốc độ phản hồi, hội thoại chưa có SĐT và automation đang bật."],
    ["KPI & Báo cáo","Dùng cùng một nguồn dữ liệu CRM khi họp team; xử lý dữ liệu thiếu trước khi đánh giá KPI."],
    ["Automation","Chỉ bật rule đã kiểm tra điều kiện, đối tượng và nội dung gửi khách."],
    ["Đội ngũ","Xem cơ cấu nhân sự; việc tạo/khóa tài khoản thuộc quyền Admin."]
  ],
  ceo:[
    ["Tổng quan điều hành","Theo dõi các chỉ số đầu vào, pipeline, giao dịch, tài chính và hiệu suất theo cùng dữ liệu CRM."],
    ["Báo cáo","Ưu tiên báo cáo theo nguồn, giai đoạn, Sale và dòng tiền; drill-down khi chỉ số bất thường."],
    ["KPI","Theo dõi mục tiêu theo kỳ và đối chiếu với dữ liệu hoạt động thực tế."],
    ["Giỏ & Giao dịch","Theo dõi tốc độ bán, tồn kho và tiến độ các giao dịch quan trọng."],
    ["Automation","Phê duyệt logic vận hành quan trọng; không dùng automation để thay thế bước kiểm soát nghiệp vụ bắt buộc."]
  ],
  admin:[
    ["Đội ngũ","Tạo tài khoản, phân vai trò, khóa/mở tài khoản và duy trì thông tin nhân viên. Không dùng chung tài khoản giữa nhiều người."],
    ["Phân quyền","Cấp đúng vai trò công việc; không nâng quyền chỉ để xử lý tạm một thao tác nếu có phương án nghiệp vụ phù hợp."],
    ["Tích hợp & Automation","Theo dõi trạng thái integration, automation và lỗi hệ thống. Secret/token phải nằm trong hệ thống quản trị, không gửi qua chat."],
    ["Dữ liệu","Giám sát import, dữ liệu trùng/xung đột và các thay đổi cấu trúc; luôn test trước thay đổi lớn."],
    ["Hỗ trợ nhân viên","Hướng dẫn cài PWA, đăng nhập, đổi thiết bị và xử lý lỗi trình duyệt theo checklist trong mục này."]
  ]
};

const COMMON_MODULES=[
  ["Tổng quan","Xem nhanh KPI và tình trạng hệ thống theo quyền được cấp."],
  ["Khách hàng 360°","Một hồ sơ cho toàn bộ thông tin, lịch sử chăm sóc và nhu cầu của khách."],
  ["Công việc & Lịch hẹn","Lưu việc cần làm và lịch follow-up thay cho ghi chú rời rạc."],
  ["Thông báo","Theo dõi lead, tác vụ và cảnh báo mới ở góc trên bên phải."],
  ["Làm mới dữ liệu","Dùng nút ↻ khi vừa có thay đổi từ người khác hoặc từ integration."],
  ["Đăng xuất","Đăng xuất khi dùng máy lạ/thiết bị dùng chung; không lưu mật khẩu trên thiết bị công cộng."]
];

const INSTALL_GUIDE=[
  ["Android · Chrome","Mở PTM CRM bằng Chrome. Nếu có nút Cài ứng dụng, bấm Cài. Nếu không: ⋮ → Cài đặt ứng dụng hoặc Thêm vào màn hình chính."],
  ["iPhone/iPad · Safari","Mở PTM CRM bằng Safari → nút Chia sẻ (ô vuông có mũi tên lên) → Thêm vào Màn hình chính → Thêm."],
  ["Windows · Chrome/Edge","Mở PTM CRM → menu trình duyệt → Apps/Cài đặt PTM CRM. Sau khi cài có thể ghim vào Start/Taskbar."],
  ["macOS","Chrome/Edge: menu → Cài đặt PTM CRM. Safari phiên bản hỗ trợ web app: File → Add to Dock."]
];

const RULES=[
  "Không chia sẻ tài khoản, mật khẩu hoặc token CRM cho người khác.",
  "Không copy toàn bộ danh sách khách ra thiết bị cá nhân nếu không được phép.",
  "AI chỉ hỗ trợ soạn/gợi ý; nhân viên chịu trách nhiệm kiểm tra nội dung trước khi gửi khách.",
  "Giá, ưu đãi, pháp lý, vị trí và tình trạng sản phẩm phải đối chiếu dữ liệu chính thức trước khi cam kết.",
  "Nếu dữ liệu SĐT/email mâu thuẫn hoặc CRM báo xung đột khách, dừng ghép và báo quản lý/Admin kiểm tra.",
  "Khi mất mạng, không nhập dữ liệu quan trọng vào màn hình offline; kết nối lại rồi thao tác trên CRM."
];

export function HelpCenter({data}){
  const[query,setQuery]=useState("");
  const role=data?.user?.role||"sale";
  const roleItems=ROLE_GUIDES[role]||ROLE_GUIDES.sale;
  const q=query.trim().toLowerCase();

  const common=useMemo(()=>COMMON_MODULES.filter(([a,b])=>!q||(`${a} ${b}`).toLowerCase().includes(q)),[q]);
  const tailored=useMemo(()=>roleItems.filter(([a,b])=>!q||(`${a} ${b}`).toLowerCase().includes(q)),[q,roleItems]);

  return <div className="suite-page">
    <div className="suite-page-head">
      <div>
        <h1>Cài app & Hướng dẫn nhân viên</h1>
        <p>Cài PTM CRM như một ứng dụng và sử dụng đúng quy trình theo vai trò được cấp.</p>
      </div>
      <span className="suite-live">PWA · Nhân viên</span>
    </div>

    <div className="guide-layout">
      <div className="guide-stack">
        <PwaInstallCard />

        <section className="guide-card">
          <h2>Hướng dẫn cài theo thiết bị</h2>
          <p>PTM CRM là Progressive Web App, không cần tải từ App Store hoặc CH Play.</p>
          <div className="guide-platforms">
            {INSTALL_GUIDE.map(([name,body])=><div key={name} className="guide-platform"><b>{name}</b><p>{body}</p></div>)}
          </div>
        </section>

        <section className="guide-card">
          <h2>6 nguyên tắc sử dụng an toàn</h2>
          <p>Áp dụng cho mọi nhân viên và mọi thiết bị.</p>
          <div className="guide-rules">
            {RULES.map((rule,index)=><div className="guide-rule" key={rule}><i>{index+1}</i><span>{rule}</span></div>)}
          </div>
        </section>
      </div>

      <div className="guide-stack">
        <section className="guide-card">
          <h2>Quy trình chuẩn mỗi ngày</h2>
          <p>Làm theo thứ tự này giúp dữ liệu CRM đầy đủ và giảm bỏ sót khách/công việc.</p>
          <div className="guide-steps">
            {DAILY_STEPS.map(([n,title,body])=><div className="guide-step" key={n}><span>{n}</span><div><b>{title}</b><p>{body}</p></div></div>)}
          </div>
        </section>

        <section className="guide-card">
          <div className="guide-role-banner">
            <div><b>Hướng dẫn theo vai trò của bạn</b><span>Nội dung ưu tiên theo quyền và trách nhiệm trong CRM.</span></div>
            <div className="guide-role-badge">{roleLabel(role)}</div>
          </div>
          <input className="guide-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm: khách hàng, Fanpage, hợp đồng, KPI, automation..."/>
          <div className="guide-module-grid">
            {tailored.map(([name,body])=><div className="guide-module" key={name}><b>{name}</b><p>{body}</p></div>)}
            {common.map(([name,body])=><div className="guide-module" key={"common-"+name}><b>{name}</b><p>{body}</p></div>)}
          </div>
          {!tailored.length&&!common.length&&<div className="suite-empty">Không tìm thấy nội dung phù hợp. Hãy thử từ khóa khác.</div>}
        </section>

        <section className="guide-card">
          <h2>Khi app có vấn đề</h2>
          <p>Thực hiện lần lượt trước khi báo Admin để loại trừ lỗi kết nối/trình duyệt.</p>
          <div className="guide-steps">
            <div className="guide-step"><span>1</span><div><b>Kiểm tra Internet</b><p>Đổi Wi-Fi/4G/5G và thử mở lại PTM CRM.</p></div></div>
            <div className="guide-step"><span>2</span><div><b>Làm mới ứng dụng</b><p>Dùng nút ↻ trong CRM hoặc đóng app rồi mở lại từ biểu tượng.</p></div></div>
            <div className="guide-step"><span>3</span><div><b>Đăng xuất/đăng nhập lại</b><p>Dùng khi quyền hoặc dữ liệu phiên đăng nhập có dấu hiệu không đồng bộ.</p></div></div>
            <div className="guide-step"><span>4</span><div><b>Gửi thông tin lỗi cho Admin</b><p>Ghi rõ thời điểm, màn hình đang dùng, thao tác vừa thực hiện và ảnh chụp lỗi. Không gửi mật khẩu/token.</p></div></div>
          </div>
        </section>
      </div>
    </div>
  </div>;
}
