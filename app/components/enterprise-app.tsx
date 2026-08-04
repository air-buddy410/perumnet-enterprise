"use client";

import {
  Bell,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleUserRound,
  ClipboardSignature,
  ClipboardCheck,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { canAccess, type AccessModule } from "@/shared/access";
import { api, SessionUser } from "../api-client";
import { Project, ViewKey } from "../data";
import { AppLanguage, translate } from "../i18n";
import { appPath } from "../paths";
import { AuthScreen } from "./auth-screen";
import { BastView } from "./bast-view";
import { BillingView } from "./billing-view";
import { BoqView } from "./boq-view";
import { CatalogView } from "./catalog-view";
import { DashboardView } from "./dashboard-view";
import { FinanceView } from "./finance-view";
import { ProjectExpenseView } from "./project-expense-view";
import { HelpView } from "./help-view";
import { ProcurementViewV2 as ProcurementView } from "./procurement-v2-view";
import { ProfileView } from "./profile-view";
import { ProjectView } from "./project-view";
import { SettingsView } from "./settings-view";
import { StandaloneBoqView } from "./standalone-boq-view";
import { UserAvatar } from "./user-avatar";
import { UsersView } from "./users-view";
import { ValidationView } from "./validation-view";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface NavigationItem {
  id: ViewKey;
  labelKey: "dashboard" | "projects" | "expenses" | "boq" | "catalog" | "billing" | "procurement" | "validation" | "bast" | "finance" | "users";
  module: AccessModule;
  icon: typeof LayoutDashboard;
  badge?: string;
  roles?: SessionUser["role"][];
}

interface EmailDeliveryNotification {
  id: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  createdAt: string;
}

const mainNavigation: NavigationItem[] = [
  { id: "dashboard", labelKey: "dashboard", module: "dashboard", icon: LayoutDashboard },
  { id: "project", labelKey: "projects", module: "projects", icon: FolderKanban },
  { id: "boq", labelKey: "boq", module: "boq", icon: FileSpreadsheet },
  { id: "billing", labelKey: "billing", module: "billing", icon: ReceiptText },
];

const operationsNavigation: NavigationItem[] = [
  { id: "expenses", labelKey: "expenses", module: "projects", icon: ReceiptText },
  { id: "procurement", labelKey: "procurement", module: "procurement", icon: PackageSearch },
  { id: "validation", labelKey: "validation", module: "bast", icon: ClipboardCheck },
  { id: "bast", labelKey: "bast", module: "bast", icon: ClipboardSignature },
  { id: "finance", labelKey: "finance", module: "finance", icon: WalletCards },
];

const administrationNavigation: NavigationItem[] = [
  { id: "catalog", labelKey: "catalog", module: "boq", icon: LibraryBig, roles: ["Admin", "Finance"] },
  { id: "users", labelKey: "users", module: "users", icon: ShieldCheck },
];

function viewMeta(language: AppLanguage, view: ViewKey) {
  const id = language === "id";
  const meta: Record<ViewKey, { title: string; subtitle: string }> = {
    dashboard: { title: "Dashboard", subtitle: id ? "Pusat kendali operasional" : "Operations control center" },
    project: { title: translate(language, "projects"), subtitle: id ? "Jadwal, tugas, dan dokumentasi" : "Schedules, tasks, and documentation" },
    expenses: { title: translate(language, "expenses"), subtitle: id ? "Nota, uang muka, dan reimbursement proyek" : "Project receipts, advances, and reimbursements" },
    boq: { title: "BoQ Generator", subtitle: id ? "Kalkulasi kebutuhan dan margin" : "Requirements and margin calculation" },
    catalog: { title: translate(language, "catalog"), subtitle: id ? "Kategori, merek, item, dan standar harga" : "Categories, brands, items, and standard pricing" },
    billing: { title: translate(language, "billing"), subtitle: id ? "Penawaran dan penagihan proyek" : "Project quotations and billing" },
    procurement: { title: translate(language, "procurement"), subtitle: id ? "Mitra kerja dan Surat Perintah Kerja" : "Vendors and work orders" },
    validation: { title: translate(language, "validation"), subtitle: id ? "Checklist wajib sebelum BAST" : "Required checklist before handover" },
    bast: { title: translate(language, "bast"), subtitle: id ? "Serah terima dan tanda tangan digital" : "Handover and digital signatures" },
    finance: { title: translate(language, "finance"), subtitle: id ? "Arus kas dan rekonsiliasi" : "Cash flow and reconciliation" },
    users: { title: translate(language, "users"), subtitle: id ? "Akun tim dan otorisasi per modul" : "Team accounts and module permissions" },
    profile: { title: translate(language, "profile"), subtitle: id ? "Foto dan informasi pribadi" : "Photo and personal information" },
    settings: { title: translate(language, "settings"), subtitle: id ? "Bahasa, notifikasi, dan keamanan" : "Language, notifications, and security" },
    help: { title: translate(language, "help"), subtitle: id ? "Panduan penggunaan aplikasi" : "Application user guide" },
  };
  return meta[view];
}

function SidebarNavigation({
  currentView,
  navigate,
  onClose,
  user,
  language,
  projects,
  selectedProjectId,
  onSelectProject,
}: {
  currentView: ViewKey;
  navigate: (view: ViewKey) => void;
  onClose: () => void;
  user: SessionUser;
  language: AppLanguage;
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
}) {
  function renderItems(items: NavigationItem[]) {
    return items.filter((item) => canAccess(user.permissions, item.module) && (!item.roles || item.roles.includes(user.role))).map((item) => {
      const Icon = item.icon;
      return (
        <button className={`sidebar-link ${currentView === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => { navigate(item.id); onClose(); }}>
          <Icon size={18} /><span>{translate(language, item.labelKey)}</span>{item.badge && <small>{item.badge}</small>}
        </button>
      );
    });
  }

  const administration = renderItems(administrationNavigation);
  return (
    <>
      <div className="sidebar-brand">
        <img src={appPath("/perumnet-mark.png")} alt="" width={42} height={42} />
        <div><strong>PerumNet</strong><span>Enterprise</span></div>
        <button className="icon-button sidebar-close" type="button" aria-label={language === "id" ? "Tutup navigasi" : "Close navigation"} onClick={onClose}><X size={18} /></button>
      </div>
      <WorkspaceSwitcher projects={projects} selectedProjectId={selectedProjectId} language={language} onSelect={onSelectProject} />
      <nav className="sidebar-nav" aria-label={language === "id" ? "Navigasi utama" : "Main navigation"}>
        <span className="nav-section-label">{translate(language, "main")}</span>
        {renderItems(mainNavigation)}
        <span className="nav-section-label">{translate(language, "operations")}</span>
        {renderItems(operationsNavigation)}
        {administration.length > 0 && <><span className="nav-section-label">{translate(language, "administration")}</span>{administration}</>}
        {canAccess(user.permissions, "settings") && (
          <button className={`sidebar-link ${currentView === "settings" ? "active" : ""}`} type="button" onClick={() => { navigate("settings"); onClose(); }}>
            <Settings size={18} /><span>{translate(language, "settings")}</span>
          </button>
        )}
      </nav>
    </>
  );
}

function ProjectContextEmpty({
  language,
  onDashboard,
}: {
  language: AppLanguage;
  onDashboard: () => void;
}) {
  return (
    <section className="panel empty-state">
      <FolderKanban size={32} />
      <h2>{language === "id" ? "Pilih proyek terlebih dahulu" : "Select a project first"}</h2>
      <p>
        {language === "id"
          ? "Pilih workspace proyek dari sidebar atau buka proyek melalui Dashboard."
          : "Choose a project workspace from the sidebar or open one from the Dashboard."}
      </p>
      <button className="button primary" type="button" onClick={onDashboard}>
        {language === "id" ? "Buka Dashboard" : "Open Dashboard"}
      </button>
    </section>
  );
}

export function EnterpriseApp() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [currentView, setCurrentView] = useState<ViewKey>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [language, setLanguage] = useState<AppLanguage>("id");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; type: "project" | "invoice" | "vendor"; title: string; subtitle: string }>>([]);
  const [emailNotifications, setEmailNotifications] = useState<EmailDeliveryNotification[]>([]);
  const [notificationsReadAt, setNotificationsReadAt] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<{ user: SessionUser | null }>("/api/auth/session")
      .then((result) => {
        if (!active) return;
        setUser(result.user);
        if (result.user) {
          setLanguage(result.user.preferredLanguage);
          window.localStorage.setItem("perumnet-language", result.user.preferredLanguage);
        } else if (window.localStorage.getItem("perumnet-language") === "en") {
          setLanguage("en");
        }
      })
      .catch(() => active && setUser(null))
      .finally(() => active && setCheckingSession(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function sessionExpired() {
      setUser(null);
      setCurrentView("dashboard");
      setToast(language === "id" ? "Sesi telah berakhir. Silakan masuk kembali." : "Your session has expired. Please sign in again.");
    }
    window.addEventListener("perumnet:session-expired", sessionExpired);
    return () => window.removeEventListener("perumnet:session-expired", sessionExpired);
  }, [language]);

  useEffect(() => {
    if (!user || !canAccess(user.permissions, "projects")) return;
    let active = true;
    api<Project[]>("/api/projects")
      .then((data) => {
        if (!active) return;
        setProjects(data);
        const stored = window.localStorage.getItem("perumnet-workspace") ?? "";
        const selected = data.some((project) => project.id === stored) ? stored : "";
        setSelectedProjectId(selected);
      })
      .catch(() => setProjects([]));
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user || !canAccess(user.permissions, "settings")) return;
    let active = true;
    api<EmailDeliveryNotification[]>("/api/notifications/email")
      .then((deliveries) => {
        if (!active) return;
        setEmailNotifications(deliveries);
        setNotificationsReadAt(
          Number(window.localStorage.getItem(`perumnet-notifications-read-${user.id}`) ?? 0),
        );
      })
      .catch(() => {
        if (active) setEmailNotifications([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      api<typeof searchResults>(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`).then(setSearchResults).catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string) => setToast(message), []);

  function navigate(view: ViewKey) {
    setCurrentView(view);
    setNotificationsOpen(false);
    setProfileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    window.localStorage.setItem("perumnet-workspace", projectId);
    notify(language === "id" ? "Workspace proyek aktif diperbarui." : "Active project workspace updated.");
  }, [language, notify]);

  const projectCreated = useCallback((project: Project) => {
    setProjects((current) => [
      project,
      ...current.filter((item) => item.id !== project.id),
    ]);
  }, []);

  const projectDeleted = useCallback((projectId: string) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setSelectedProjectId((current) => {
      if (current !== projectId) return current;
      window.localStorage.removeItem("perumnet-workspace");
      return "";
    });
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setCurrentView("dashboard");
    setProfileOpen(false);
    notify("");
  }

  async function refreshEmailNotifications() {
    if (!user || !canAccess(user.permissions, "settings")) return;
    const deliveries = await api<EmailDeliveryNotification[]>("/api/notifications/email")
      .catch(() => []);
    setEmailNotifications(deliveries);
  }

  function markNotificationsRead() {
    if (!user) return;
    const timestamp = Date.now();
    setNotificationsReadAt(timestamp);
    window.localStorage.setItem(
      `perumnet-notifications-read-${user.id}`,
      String(timestamp),
    );
    setNotificationsOpen(false);
  }

  if (checkingSession) {
    return <main className="auth-shell"><section className="auth-form-panel"><div className="auth-form-wrap"><img src={appPath("/perumnet-enterprise-brand.png")} alt="PerumNet Enterprise" width={190} height={200} /><p>{translate(language, "loading")}</p></div></section></main>;
  }

  if (!user) {
    return <AuthScreen language={language} onLogin={(loggedInUser) => { setUser(loggedInUser); setLanguage(loggedInUser.preferredLanguage); window.localStorage.setItem("perumnet-language", loggedInUser.preferredLanguage); }} />;
  }

  const activeProjectId = selectedProjectId;
  const meta = viewMeta(language, currentView);
  const canUse = (module: AccessModule) => canAccess(user.permissions, module);
  const canManage = (module: AccessModule) => canAccess(user.permissions, module, "manage");
  const hasUnreadNotifications = emailNotifications.some(
    (delivery) => new Date(delivery.createdAt).getTime() > notificationsReadAt,
  );

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <SidebarNavigation currentView={currentView} navigate={navigate} onClose={() => setMobileNavOpen(false)} user={user} language={language} projects={projects} selectedProjectId={selectedProjectId} onSelectProject={selectProject} />
        <div className="sidebar-footer">
          <button className="sidebar-help" type="button" onClick={() => navigate("help")}><span><BookOpenCheck size={18} /></span><span><strong>{translate(language, "helpQuestion")}</strong><small>{translate(language, "helpCaption")}</small></span></button>
          <button className="sidebar-user" type="button" onClick={() => { navigate("profile"); setMobileNavOpen(false); }}>
            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} />
            <span><strong>{user.name}</strong><small>{user.role}</small></span><ChevronDown size={15} />
          </button>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-nav-backdrop" type="button" aria-label={language === "id" ? "Tutup navigasi" : "Close navigation"} onClick={() => setMobileNavOpen(false)} />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" type="button" aria-label={language === "id" ? "Buka navigasi" : "Open navigation"} onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
            <button className="icon-button desktop-collapse" type="button" aria-label={sidebarCollapsed ? (language === "id" ? "Tampilkan navigasi samping" : "Show sidebar") : (language === "id" ? "Sembunyikan navigasi samping" : "Hide sidebar")} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
            <div className="topbar-title"><strong>{meta.title}</strong><span>{meta.subtitle}</span></div>
          </div>
          <div className="topbar-actions">
            <div className="dropdown-anchor global-search-anchor">
              <label className="global-search"><Search size={17} /><input ref={searchInputRef} value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); if (event.target.value.trim().length < 2) setSearchResults([]); }} placeholder={translate(language, "search")} /><kbd>⌘ K</kbd></label>
              {searchResults.length > 0 && (
                <div className="topbar-dropdown search-dropdown">
                  <div className="dropdown-head"><strong>{translate(language, "searchResults")}</strong></div>
                  {searchResults.filter((result) => result.type === "project" ? canUse("projects") : result.type === "invoice" ? canUse("billing") : canUse("procurement")).map((result) => (
                    <button type="button" key={`${result.type}-${result.id}`} onClick={() => { if (result.type === "project") selectProject(result.id); navigate(result.type === "project" ? "project" : result.type === "invoice" ? "billing" : "procurement"); setSearchQuery(""); setSearchResults([]); }}>
                      <Search size={15} /><span><strong>{result.title}</strong><small>{result.subtitle}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="dropdown-anchor">
              <button className={`icon-button notification-button ${notificationsOpen ? "active" : ""}`} type="button" aria-label={translate(language, "notifications")} aria-expanded={notificationsOpen} onClick={() => { const next = !notificationsOpen; setNotificationsOpen(next); setProfileOpen(false); if (next) void refreshEmailNotifications(); }}><Bell size={18} />{hasUnreadNotifications ? <span /> : null}</button>
              {notificationsOpen && (
                <div className="topbar-dropdown notifications-dropdown">
                  <div className="dropdown-head"><strong>{translate(language, "notifications")}</strong><button className="text-button" type="button" onClick={markNotificationsRead}>{translate(language, "markRead")}</button></div>
                  {emailNotifications.slice(0, 5).map((delivery) => (
                    <button type="button" key={delivery.id} onClick={() => navigate("settings")}>
                      <span className={`notification-icon ${delivery.status === "sent" ? "success" : delivery.status === "failed" ? "warning" : "info"}`}>
                        {delivery.status === "sent" ? <Check size={16} /> : delivery.status === "failed" ? <Bell size={16} /> : <ReceiptText size={16} />}
                      </span>
                      <span>
                        <strong>{delivery.subject}</strong>
                        <small>
                          {delivery.status === "sent"
                            ? language === "id" ? "Terkirim" : "Sent"
                            : delivery.status === "failed"
                              ? language === "id" ? "Gagal dikirim" : "Failed"
                              : language === "id" ? "Dilewati" : "Skipped"}
                          {" · "}
                          {new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
                            dateStyle: "long",
                            timeStyle: "short",
                            timeZone: "Asia/Makassar",
                          }).format(new Date(delivery.createdAt))}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!emailNotifications.length ? (
                    <div className="notification-empty">
                      <Bell size={19} />
                      <span>{language === "id" ? "Belum ada aktivitas notifikasi email." : "No email notification activity yet."}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="dropdown-anchor">
              <button className="topbar-profile" type="button" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false); }}>
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} className="small" />
                <span><strong>{user.name.split(" ")[0]}</strong><small>{user.role}</small></span><ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="topbar-dropdown profile-dropdown">
                  <div className="profile-dropdown-head"><UserAvatar name={user.name} avatarUrl={user.avatarUrl} /><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
                  <button type="button" onClick={() => navigate("profile")}><CircleUserRound size={16} /> {translate(language, "profile")}</button>
                  {canUse("settings") && <button type="button" onClick={() => navigate("settings")}><Settings size={16} /> {translate(language, "accountSettings")}</button>}
                  <button type="button" onClick={() => navigate("help")}><BookOpenCheck size={16} /> {translate(language, "help")}</button>
                  <div className="dropdown-separator" />
                  <button className="logout-action" type="button" onClick={logout}><LogOut size={16} /> {translate(language, "logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          {demoMode ? (
            <section className="demo-environment-banner" role="status">
              <ShieldCheck size={17} />
              <span>
                <strong>{language === "id" ? "Mode demo terisolasi" : "Isolated demo mode"}</strong>
                {language === "id"
                  ? " Data pada workspace ini terpisah dari database live dan email keluar dinonaktifkan."
                  : " This workspace is separate from the live database and outbound email is disabled."}
              </span>
            </section>
          ) : null}
          {currentView === "dashboard" && canUse("dashboard") && <DashboardView language={language} navigate={navigate} notify={notify} selectedProjectId={selectedProjectId} userName={user.name} canManage={canManage("projects")} canUseBoq={canUse("boq")} canUseBilling={canUse("billing")} onSelectProject={selectProject} onProjectCreated={projectCreated} />}
          {currentView === "project" && canUse("projects") && (activeProjectId ? <ProjectView language={language} navigate={navigate} notify={notify} projectId={activeProjectId} project={projects.find((item) => item.id === activeProjectId)} canManage={canManage("projects")} canDelete={user.role === "Admin"} canManageAccess={user.role === "Admin"} onProjectDeleted={projectDeleted} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "expenses" && canUse("projects") && (activeProjectId || ["Admin", "Finance"].includes(user.role) ? <ProjectExpenseView language={language} notify={notify} projectId={activeProjectId || undefined} projects={projects} userId={user.id} userRole={user.role} canCreate={canManage("projects") || canManage("finance")} canReview={["Admin", "Finance"].includes(user.role) && canManage("finance")} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "boq" && canUse("boq") && (activeProjectId ? <BoqView language={language} navigate={navigate} notify={notify} projectId={activeProjectId} canManage={canManage("boq")} canManageCatalog={["Admin", "Finance"].includes(user.role)} /> : ["Admin", "Finance"].includes(user.role) && canManage("boq") ? <StandaloneBoqView language={language} notify={notify} projects={projects} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "catalog" && canUse("boq") && ["Admin", "Finance"].includes(user.role) && <CatalogView language={language} notify={notify} />}
          {currentView === "billing" && canUse("billing") && (activeProjectId ? <BillingView language={language} notify={notify} projectId={activeProjectId} canManage={canManage("billing")} canManagePayments={canManage("billing") && canManage("finance")} canManageTaxes={["Admin", "Finance"].includes(user.role) && canManage("billing") && canManage("finance")} canManageValidity={["Admin", "Finance"].includes(user.role) && canManage("billing")} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "procurement" && canUse("procurement") && (activeProjectId || ["Admin", "Finance"].includes(user.role) ? <ProcurementView language={language} notify={notify} projectId={activeProjectId || undefined} canManage={canManage("procurement")} canManageCommercial={canManage("boq") && canManage("billing")} canManageVendors={["Admin", "Finance"].includes(user.role) && canManage("procurement")} canManagePayments={canManage("procurement") && canManage("finance")} userRole={user.role} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "validation" && canUse("bast") && (activeProjectId ? <ValidationView projectId={activeProjectId} language={language} canManage={canManage("bast")} notify={notify} navigate={navigate} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "bast" && canUse("bast") && (activeProjectId ? <BastView language={language} navigate={navigate} notify={notify} projectId={activeProjectId} canManage={canManage("bast")} isAdmin={user.role === "Admin"} userName={user.name} onProjectUpdated={projectCreated} /> : <ProjectContextEmpty language={language} onDashboard={() => navigate("dashboard")} />)}
          {currentView === "finance" && canUse("finance") && (
            <FinanceView
              language={language}
              notify={notify}
              projectId={selectedProjectId}
              projects={projects}
              canManage={canManage("finance")}
              isAdmin={user.role === "Admin"}
              canUseBanking={user.role === "Admin" || user.role === "Finance"}
              canConfigureBanking={
                user.role === "Admin" && canManage("finance")
              }
              canApproveProfitShares={
                user.role === "Admin" && canManage("finance")
              }
              canConfigureTax={
                user.role === "Admin" &&
                canManage("finance") &&
                canManage("settings")
              }
            />
          )}
          {currentView === "users" && canUse("users") && <UsersView notify={notify} language={language} currentUserId={user.id} canManage={user.role === "Admin"} />}
          {currentView === "profile" && <ProfileView language={language} user={user} notify={notify} onUserChange={setUser} />}
          {currentView === "settings" && canUse("settings") && <SettingsView language={language} notify={notify} isAdmin={user.role === "Admin"} onLanguageChange={(next) => { setLanguage(next); window.localStorage.setItem("perumnet-language", next); setUser((current) => current ? { ...current, preferredLanguage: next } : current); }} />}
          {currentView === "help" && <HelpView language={language} />}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label={language === "id" ? "Navigasi cepat" : "Quick navigation"}>
        {canUse("dashboard") && <button className={currentView === "dashboard" ? "active" : ""} type="button" onClick={() => navigate("dashboard")}><LayoutDashboard size={19} /><span>{translate(language, "home")}</span></button>}
        {canUse("projects") && <button className={currentView === "project" ? "active" : ""} type="button" onClick={() => navigate("project")}><FolderKanban size={19} /><span>{translate(language, "project")}</span></button>}
        {canUse("boq") && <button className={currentView === "boq" ? "active" : ""} type="button" onClick={() => navigate("boq")}><FileSpreadsheet size={19} /><span>BoQ</span></button>}
        {canUse("finance") ? <button className={currentView === "finance" ? "active" : ""} type="button" onClick={() => navigate("finance")}><WalletCards size={19} /><span>{translate(language, "money")}</span></button> : canUse("procurement") ? <button className={currentView === "procurement" ? "active" : ""} type="button" onClick={() => navigate("procurement")}><PackageSearch size={19} /><span>{translate(language, "vendor")}</span></button> : null}
        <button type="button" onClick={() => setMobileNavOpen(true)}><Menu size={19} /><span>{translate(language, "more")}</span></button>
      </nav>

      {toast && <div className="toast" role="status"><span><Check size={16} /></span><p>{toast}</p><button className="icon-button" type="button" aria-label={language === "id" ? "Tutup notifikasi" : "Close notification"} onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}
