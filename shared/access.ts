export const accessModules = [
  "dashboard",
  "projects",
  "expenses",
  "boq",
  "billing",
  "procurement",
  "bast",
  "finance",
  "margin",
  "prospects",
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
  expenses: { id: "Belanja Proyek", en: "Project Expenses" },
  boq: { id: "BoQ Generator", en: "BoQ Generator" },
  billing: { id: "Quotation & Invoice", en: "Quotations & Invoices" },
  procurement: { id: "Procurement & Vendor", en: "Procurement & Vendors" },
  bast: { id: "BAST Digital", en: "Digital Handover" },
  finance: { id: "Pembukuan", en: "Finance" },
  margin: { id: "Laba & Bagi Hasil", en: "Profit & Profit Sharing" },
  prospects: { id: "Calon Klien", en: "Prospects" },
  users: { id: "Pengguna & Akses", en: "Users & Access" },
  settings: { id: "Pengaturan", en: "Settings" },
};

const roleDefaults: Record<EnterpriseRole, AccessPermissions> = {
  Admin: {
    dashboard: "manage",
    projects: "manage",
    expenses: "manage",
    boq: "manage",
    billing: "manage",
    procurement: "manage",
    bast: "manage",
    finance: "manage",
    margin: "manage",
    prospects: "manage",
    users: "manage",
    settings: "manage",
  },
  "Project Manager": {
    dashboard: "view",
    projects: "manage",
    expenses: "manage",
    boq: "manage",
    billing: "manage",
    procurement: "manage",
    bast: "manage",
    finance: "view",
    margin: "none",
    prospects: "none",
    users: "none",
    settings: "view",
  },
  Engineer: {
    dashboard: "view",
    projects: "manage",
    expenses: "manage",
    boq: "view",
    billing: "none",
    procurement: "view",
    bast: "manage",
    finance: "none",
    margin: "none",
    prospects: "none",
    users: "none",
    settings: "view",
  },
  Finance: {
    dashboard: "view",
    projects: "view",
    expenses: "manage",
    boq: "manage",
    billing: "manage",
    procurement: "manage",
    bast: "view",
    finance: "manage",
    margin: "manage",
    // Diberikan atas permintaan pemilik 2026-08-20. Finance yang menyusun dan
    // mengirim penawaran, jadi modul ini memang pekerjaannya — bukan kelonggaran.
    prospects: "manage",
    users: "none",
    settings: "view",
  },
};

// Permissions are stored per user as a JSON object, so a module added after an
// account was last edited is simply missing from that object. Falling back to
// the role default is right for a brand new module only when the role default
// happens to equal what the person could already reach — otherwise the upgrade
// silently grants or silently revokes, which is the one thing a permission
// change must never do behind an administrator's back.
//
// `expenses` was carved out of an OR: Project Expenses used to open for anyone
// holding `projects` OR `finance` at the required level. An account whose
// `projects` had been deliberately lowered to "none" would be handed the role
// default ("manage") and gain a menu somebody took away on purpose. So the
// missing key is derived from the strongest of the two modules it used to ride
// on, which reproduces the old answer exactly for every stored combination.
//
// `prospects` is also NOT derived, for the same reason and with the same
// intent: it is a brand new surface, not a slice carved out of something people
// already reached. Falling back to the role default hands it to Admin and
// Finance — who do the outreach — and to nobody else. An Admin can grant it per
// person from Users & Access; the module appears there automatically because
// that grid is generated from `accessModules`.
//
// `margin` is deliberately NOT derived. Splitting margin out of `finance: view`
// is the point of the change: a Project Manager keeps the cash ledger and loses
// the profit figures. Taking the role default is the intended, documented
// outcome, and an Admin can hand it back per person.
const LEVEL_ORDER: Record<AccessLevel, number> = { none: 0, view: 1, manage: 2 };

function strongest(...levels: AccessLevel[]): AccessLevel {
  return levels.reduce((best, level) =>
    LEVEL_ORDER[level] > LEVEL_ORDER[best] ? level : best,
  );
}

function storedLevel(
  value: Partial<Record<AccessModule, unknown>> | null | undefined,
  accessModule: AccessModule,
): AccessLevel | undefined {
  const level = value?.[accessModule];
  return level === "none" || level === "view" || level === "manage"
    ? level
    : undefined;
}

export function defaultPermissions(role: EnterpriseRole): AccessPermissions {
  return { ...roleDefaults[role] };
}

export function normalizePermissions(
  role: EnterpriseRole,
  value?: Partial<Record<AccessModule, unknown>> | null,
): AccessPermissions {
  const fallback = defaultPermissions(role);
  // Administrator is the recovery/owner role. It must never be possible to
  // persist a partially disabled Admin account and lock the company out. That
  // floor covers every module, including the two added later.
  if (role === "Admin") return fallback;

  for (const accessModule of accessModules) {
    const level = storedLevel(value, accessModule);
    if (level) fallback[accessModule] = level;
  }

  // Backfill for accounts saved before Project Expenses became its own module.
  // Only fires when the key is genuinely absent; once an Admin saves the user
  // again the derived level is written down explicitly.
  if (value && !storedLevel(value, "expenses")) {
    const inheritedProjects = storedLevel(value, "projects");
    const inheritedFinance = storedLevel(value, "finance");
    if (inheritedProjects || inheritedFinance) {
      fallback.expenses = strongest(
        inheritedProjects ?? "none",
        inheritedFinance ?? "none",
      );
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
