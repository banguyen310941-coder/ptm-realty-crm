import { requireUser, canManageAll } from "@/lib/auth";
import { getProperties } from "@/lib/data";
import { createPropertyAction, updatePropertyAction, deletePropertyAction } from "@/lib/actions";
import { propertyStatus, money } from "@/lib/format";

export const dynamic = "force-dynamic";

function PropertyForm({ item, action }) {
  return (
    <form action={action} className="form-grid">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <label>Tên sản phẩm<input name="name" required defaultValue={item?.name || ""} /></label>
      <label>Mã căn / nền<input name="code" required defaultValue={item?.code || ""} /></label>
      <label>Dự án<input name="project" required defaultValue={item?.project || ""} /></label>
      <label>Loại BĐS
        <select name="property_type" defaultValue={item?.property_type || "Căn hộ"}>
          {["Căn hộ","Nhà phố","Biệt thự","Shophouse","Đất nền","Officetel"].map(x => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>Diện tích m²<input name="area" type="number" step="0.01" min="0" defaultValue={item?.area || 0} /></label>
      <label>Phòng ngủ<input name="bedrooms" type="number" min="0" defaultValue={item?.bedrooms || 0} /></label>
      <label>Giá bán (VND)<input name="price" type="number" min="0" defaultValue={item?.price || 0} /></label>
      <label>Trạng thái
        <select name="status" defaultValue={item?.status || "available"}>
          {Object.entries(propertyStatus).map(([k,v]) => <option value={k} key={k}>{v}</option>)}
        </select>
      </label>
      <label className="full">Ghi chú<textarea name="notes" defaultValue={item?.notes || ""} /></label>
      <div className="form-actions full"><button className="btn primary">Lưu sản phẩm</button></div>
    </form>
  );
}

export default async function PropertiesPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = String(sp?.q || "").trim();
  const properties = await getProperties(q);

  return (
    <>
      <div className="page-title">
        <div><h1>Sản phẩm BĐS</h1><p>Giỏ hàng tập trung theo dự án và trạng thái.</p></div>
        {canManageAll(user) ? (
          <details className="dialog">
            <summary className="btn primary">+ Thêm sản phẩm</summary>
            <div className="dialog-card"><div className="panel-head"><div><h2>Sản phẩm mới</h2><p>Thêm vào giỏ hàng công ty.</p></div></div><PropertyForm action={createPropertyAction} /></div>
          </details>
        ) : null}
      </div>

      <form className="filters top-filter">
        <input name="q" defaultValue={q} placeholder="Tìm sản phẩm, mã căn, dự án..." />
        <button className="btn secondary">Tìm</button>
        <a href="/properties" className="btn ghost">Xóa lọc</a>
      </form>

      <section className="property-grid">
        {properties.map(item => (
          <article className="property-card" key={item.id}>
            <div className="property-visual"><span>⌂</span><em className={`badge property-${item.status}`}>{propertyStatus[item.status]}</em></div>
            <div className="property-body">
              <span className="eyebrow">{item.project}</span>
              <h2>{item.name}</h2>
              <p>Mã: <b>{item.code}</b></p>
              <p>{item.property_type} · {Number(item.area)} m²{item.bedrooms ? ` · ${item.bedrooms} PN` : ""}</p>
              <strong className="property-price">{money(item.price)}</strong>
              {canManageAll(user) ? (
                <div className="row-actions property-actions">
                  <details className="dialog">
                    <summary>Sửa</summary>
                    <div className="dialog-card"><div className="panel-head"><div><h2>Cập nhật sản phẩm</h2><p>{item.code}</p></div></div><PropertyForm item={item} action={updatePropertyAction} /></div>
                  </details>
                  <form action={deletePropertyAction}><input type="hidden" name="id" value={item.id}/><button className="danger-link">Xóa</button></form>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {!properties.length ? <div className="panel empty">Không tìm thấy sản phẩm.</div> : null}
    </>
  );
}
