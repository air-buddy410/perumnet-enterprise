export const accessModules = [
  "dashboard",
  "projects",
  "boq",
  "billing",
  "procurement",
  "bast",
  "finance",
  "users",
  "settings",
] as const;

export type AccessModule = (typeof accessModules)[number];
export type AccessLevel = "none" | "view" | "manage";
export type AccessPermissions = Record<AccessModule, AccessLevel>;
export type EnterpriseRole = "Admin" | "Project Manager" | "Engineer" | "Finance";

export const moduleLabels: Record<AccessModule, { id: string; en: string }> = {
  dashboard: { id: "Dashboard", en: "Dashboard" },
  projects: { id: "Manajemen Proyek", en: "Project Management" },
  boq: { id: "BoQ Generator", en: "BoQ Generator" },
  billing: { id: "Quotation & Invoice", en: "Quotations & Invoices" },
  procurement: { id: "Procurement & Vendor", en: "Procurement & Vendors" },
  bast: { id: "BAST Digital", en: "Digital Handover" },
  finance: { id: "Pembukuan", en: "Finance" },
  users: { id: "Pengguna & Akses", en: "Users & Access" },
  settings: { id: "Pengaturan", en: "Settings" },
};

const roleDefaults: Record<EnterpriseRole, AccessPermissions> = {
  Admin: {
    dashboard: "manage",
    projects: "manage",
    boq: "manage",
    billing: "manage",
    procurement: "manage",
    bast: "manage",
    finance: "manage",
    users: "manage",
    settings: "manage",
  },
  "Project Manager": {
    dashboard: "view",
    projects: "manage",
    boq: "manage",
    billing: "manage",
    procurement: "manage",
    bast: "manage",
    finance: "view",
    users: "none",
    settings: "view",
  },
  Engineer: {
    dashboard: "view",
    projects: "manage",
    boq: "view",
    billing: "none",
    procurement: "view",
    bast: "manage",
    finance: "none",
    users: "none",
    settings: "view",
  },
  Finance: {
    dashboard: "view",
    projects: "view",
    boq: "view",
    billing: "manage",
    procurement: "manage",
    bast: "view",
    finance: "manage",
    users: "none",
    settings: "view",
  },
};

export function defaultPermissions(role: EnterpriseRole): AccessPermissions {
  return { ...roleDefaults[role] };
}

export function normalizePermissions(
  role: EnterpriseRole,
  value?: Partial<Record<AccessModule, unknown>> | null,
): AccessPermissions {
  const fallback = defaultPermissions(role);
  if (role === "Admin" && !value) return fallback;

  for (const accessModule of accessModules) {
    const level = value?.[accessModule];
    if (level === "none" || level === "view" || level === "manage") {
      fallback[accessModule] = level;
    }
  }
  return fallback;
}

export function canAccess(
  permissions: AccessPermissions,
  module: AccessModule,
  required: Exclude<AccessLevel, "none"> = "view",
) {
  const actual = permissions[module];
  return required === "view" ? actual === "view" || actual === "manage" : actual === "manage";
}
