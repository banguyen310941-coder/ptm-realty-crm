import { requireUser, canManageAll } from "@/lib/auth";
import { getTasks, getLeads, getUsers } from "@/lib/data";
import { createTaskAction, toggleTaskAction, deleteTaskAction } from "@/lib/actions";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await requireUser();
  const [tasks, leads, users] = await Promise.all([getTasks(user), getLeads(user), getUsers(true)]);
  const open = tasks.filter(x=>!x.done).length;

  return (
    <>
      <div className="page-title">
        <div><h1>Công việc</h1><p>{open} công việc chưa hoàn tất.</p></div>
        <details className="dialog">
          <summary className="btn primary">+ Thêm công việc</summary>
          <div className="dialog-card">
            <div className="panel-head"><div><h2>Công việc mới</h2><p>Lịch gọi, hẹn gặp, chăm sóc khách.</p></div></div>
            <form action={createTaskAction} className="form-grid">
              <label className="full">Nội dung<input name="title" required /></label>
              <label>Loại<select name="task_type">{["call","zalo","meeting","followup","crm"].map(x=><option value={x} key={x}>{x}</option>)}</select></label>
              <label>Ưu tiên<select name="priority"><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option></select></label>
              <label>Hạn xử lý<input name="due_at" type="datetime-local" /></label>
              <label>Khách hàng<select name="lead_id"><option value="">— Không liên kết —</option>{leads.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
              {canManageAll(user) ? <label>Phụ trách<select name="owner_id" defaultValue={user.id}>{users.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label> : null}
              <div className="form-actions full"><button className="btn primary">Lưu công việc</button></div>
            </form>
          </div>
        </details>
      </div>

      <article className="panel task-panel">
        {tasks.map(t => (
          <div className={`task-row ${t.done ? "done" : ""}`} key={t.id}>
            <form action={toggleTaskAction}>
              <input type="hidden" name="id" value={t.id}/>
              <button className="task-check">{t.done ? "✓" : ""}</button>
            </form>
            <div>
              <strong>{t.title}</strong>
              <span>{t.task_type} · {t.lead_name || "Không gắn khách"} · {dateTime(t.due_at)}</span>
            </div>
            <span className={`badge priority-${t.priority}`}>{t.priority}</span>
            <span>{t.owner_name || "—"}</span>
            <form action={deleteTaskAction}><input type="hidden" name="id" value={t.id}/><button className="danger-link">Xóa</button></form>
          </div>
        ))}
        {!tasks.length ? <div className="empty">Chưa có công việc.</div> : null}
      </article>
    </>
  );
}
