export const ROLE_LABELS = {
  ceo: "Giám đốc điều hành",
  admin: "Admin",
  marketing: "Marketing",
  sale: "Sale",
  accounting: "Kế toán",
  manager: "Quản lý"
};

export const ROLE_OPTIONS = [
  ["ceo", "Giám đốc điều hành"],
  ["admin", "Admin"],
  ["manager", "Quản lý"],
  ["marketing", "Marketing"],
  ["sale", "Sale"],
  ["accounting", "Kế toán"]
];

const FULL = {
  dashboard_view: true,
  leads_view: true,
  leads_scope: "all",
  leads_create: true,
  leads_update: true,
  leads_delete: true,
  leads_assign: true,
  properties_view: true,
  properties_manage: true,
  deals_view: true,
  deals_scope: "all",
  deals_create: true,
  deals_update: true,
  deals_delete: true,
  tasks_view: true,
  tasks_scope: "all",
  tasks_create: true,
  tasks_update: true,
  tasks_delete: true,
  team_view: true,
  users_manage: false,
  finance_view: true
};

export const DEFAULT_PERMISSIONS = {
  ceo: { ...FULL },
  manager: { ...FULL },
  admin: { ...FULL, users_manage: true },
  marketing: {
    dashboard_view: true,
    leads_view: true,
    leads_scope: "all",
    leads_create: true,
    leads_update: true,
    leads_delete: false,
    leads_assign: true,
    properties_view: true,
    properties_manage: false,
    deals_view: true,
    deals_scope: "all",
    deals_create: false,
    deals_update: false,
    deals_delete: false,
    tasks_view: true,
    tasks_scope: "own",
    tasks_create: true,
    tasks_update: true,
    tasks_delete: true,
    team_view: false,
    users_manage: false,
    finance_view: false
  },
  sale: {
    dashboard_view: true,
    leads_view: true,
    leads_scope: "own",
    leads_create: true,
    leads_update: true,
    leads_delete: false,
    leads_assign: false,
    properties_view: true,
    properties_manage: false,
    deals_view: true,
    deals_scope: "own",
    deals_create: true,
    deals_update: true,
    deals_delete: false,
    tasks_view: true,
    tasks_scope: "own",
    tasks_create: true,
    tasks_update: true,
    tasks_delete: true,
    team_view: false,
    users_manage: false,
    finance_view: true
  },
  accounting: {
    dashboard_view: true,
    leads_view: true,
    leads_scope: "all",
    leads_create: false,
    leads_update: false,
    leads_delete: false,
    leads_assign: false,
    properties_view: true,
    properties_manage: false,
    deals_view: true,
    deals_scope: "all",
    deals_create: false,
    deals_update: true,
    deals_delete: false,
    tasks_view: true,
    tasks_scope: "own",
    tasks_create: true,
    tasks_update: true,
    tasks_delete: true,
    team_view: true,
    users_manage: false,
    finance_view: true
  }
};

export const NAV_PERMISSION = {
  dashboard: "dashboard_view",
  leads: "leads_view",
  properties: "properties_view",
  deals: "deals_view",
  tasks: "tasks_view",
  team: "team_view"
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "Nhân viên";
}

export function getPermissions(data) {
  const role = data?.user?.role || "sale";
  return {
    ...(DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.sale),
    ...(data?.permissions || {})
  };
}
