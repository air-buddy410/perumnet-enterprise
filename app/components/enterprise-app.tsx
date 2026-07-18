"use client";

import {
  Bell,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleUserRound,
  ClipboardSignature,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
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
import { DashboardView } from "./dashboard-view";
import { FinanceView } from "./finance-view";
import { HelpView } from "./help-view";
import { ProcurementView } from "./procurement-view";
import { ProfileView } from "./profile-view";
import { ProjectView } from "./project-view";
import { SettingsView } from "./settings-view";
import { UserAvatar } from "./user-avatar";
import { UsersView } from "./users-view";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface NavigationItem {
  id: ViewKey;
  labelKey: "dashboard" | "projects" | "boq" | "billing" | "procurement" | "bast" | "finance" | "users";
  module: AccessModule;
  icon: typeof LayoutDashboard;
  badge?: string;
}

const mainNavigation: NavigationItem[] = [
  { id: "dashboard", labelKey: "dashboard", module: "dashboard", icon: LayoutDashboard },
  { id: "project", labelKey: "projects", module: "projects", icon: FolderKanban, badge: "3" },
  { id: "boq", labelKey: "boq", module: "boq", icon: FileSpreadsheet },
  { id: "billing", labelKey: "billing", module: "billing", icon: ReceiptText, badge: "2" },
];

const operationsNavigation: NavigationItem[] = [
  { id: "procurement", labelKey: "procurement", module: "procurement", icon: PackageSearch },
  { id: "bast", labelKey: "bast", module: "bast", icon: ClipboardSignature },
  { id: "finance", labelKey: "finance", module: "finance", icon: WalletCards },
];

const administrationNavigation: NavigationItem[] = [
  { id: "users", labelKey: "users", module: "users", icon: ShieldCheck },
];

function viewMeta(language: AppLanguage, view: ViewKey) {
  const id = language === "id";
  const meta: Record<ViewKey, { title: string; subtitle: string }> = {
    dashboard: { title: "Dashboard", subtitle: id ? "Pusat kendali operasional" : "Operations control center" },
    project: { title: translate(language, "projects"), subtitle: id ? "Jadwal, tugas, dan dokumentasi" : "Schedules, tasks, and documentation" },
    boq: { title: "BoQ Generator", subtitle: id ? "Kalkulasi kebutuhan dan margin" : "Requirements and margin calculation" },
    billing: { title: translate(language, "billing"), subtitle: id ? "Penawaran dan penagihan proyek" : "Project quotations and billing" },
    procurement: { title: translate(language, "procurement"), subtitle: id ? "Mitra kerja dan Surat Perintah Kerja" : "Vendors and work orders" },
    bast: { title: translate(language, "bast"), subtitle: id ? "Serah terima dan tanda tangan digital" : "Handover and digital signatures" },
    finance: { title: translate(language, "finance"), subtitle: id ? "Arus kas dan profitabilitas proyek" : "Project cash flow and profitability" },
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
    return items.filter((item) => canAccess(user.permissions, item.module)).map((item) => {
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

export function EnterpriseApp() {
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<{ user: SessionUser | null }>("/api/auth/session")
      .then((result) => {
        if (!active) return;
        setUser(result.user);
        if (result.user) setLanguage(result.user.preferredLanguage);
      })
      .catch(() => active && setUser(null))
      .finally(() => active && setCheckingSession(false));
    return () => { active = false; };
  }, []);

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

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    window.localStorage.setItem("perumnet-workspace", projectId);
    notify(language === "id" ? "Workspace proyek aktif diperbarui." : "Active project workspace updated.");
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setCurrentView("dashboard");
    setProfileOpen(false);
    notify("");
  }

  if (checkingSession) {
    return <main className="auth-shell"><section className="auth-form-panel"><div className="auth-form-wrap"><img src={appPath("/perumnet-enterprise-logo.png")} alt="PerumNet Enterprise" width={190} height={200} /><p>{translate(language, "loading")}</p></div></section></main>;
  }

  if (!user) {
    return <AuthScreen onLogin={(loggedInUser) => { setUser(loggedInUser); setLanguage(loggedInUser.preferredLanguage); }} />;
  }

  const activeProjectId = selectedProjectId || projects.find((project) => project.id === "project-1")?.id || projects[0]?.id || "project-1";
  const meta = viewMeta(language, currentView);
  const canUse = (module: AccessModule) => canAccess(user.permissions, module);

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
                    <button type="button" key={`${result.type}-${result.id}`} onClick={() => { navigate(result.type === "project" ? "project" : result.type === "invoice" ? "billing" : "procurement"); setSearchQuery(""); setSearchResults([]); }}>
                      <Search size={15} /><span><strong>{result.title}</strong><small>{result.subtitle}</small></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="dropdown-anchor">
              <button className={`icon-button notification-button ${notificationsOpen ? "active" : ""}`} type="button" aria-label={translate(language, "notifications")} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setProfileOpen(false); }}><Bell size={18} /><span /></button>
              {notificationsOpen && (
                <div className="topbar-dropdown notifications-dropdown">
                  <div className="dropdown-head"><strong>{translate(language, "notifications")}</strong><button className="text-button" type="button" onClick={() => setNotificationsOpen(false)}>{translate(language, "markRead")}</button></div>
                  {canUse("billing") && <button type="button" onClick={() => navigate("billing")}><span className="notification-icon warning"><ReceiptText size={16} /></span><span><strong>{language === "id" ? "Invoice jatuh tempo" : "Invoice due"}</strong><small>{language === "id" ? "Pelunasan WiFi Resort jatuh tempo 2 Agu." : "WiFi Resort balance is due Aug 2."}</small></span></button>}
                  {canUse("projects") && <button type="button" onClick={() => navigate("project")}><span className="notification-icon info"><FolderKanban size={16} /></span><span><strong>{language === "id" ? "Dokumentasi baru" : "New documentation"}</strong><small>{language === "id" ? "Agus mengunggah 8 foto lapangan." : "Agus uploaded 8 field photos."}</small></span></button>}
                  {canUse("bast") && <button type="button" onClick={() => navigate("bast")}><span className="notification-icon success"><ClipboardSignature size={16} /></span><span><strong>{language === "id" ? "BAST siap" : "Handover ready"}</strong><small>{language === "id" ? "Villa Complex menunggu tanda tangan." : "Villa Complex is awaiting signatures."}</small></span></button>}
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
                  <button type="button" onClick={() => navigate("settings")}><Settings size={16} /> {translate(language, "accountSettings")}</button>
                  <button type="button" onClick={() => navigate("help")}><BookOpenCheck size={16} /> {translate(language, "help")}</button>
                  <div className="dropdown-separator" />
                  <button className="logout-action" type="button" onClick={logout}><LogOut size={16} /> {translate(language, "logout")}</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          {currentView === "dashboard" && canUse("dashboard") && <DashboardView navigate={navigate} notify={notify} selectedProjectId={selectedProjectId} userName={user.name} />}
          {currentView === "project" && canUse("projects") && <ProjectView navigate={navigate} notify={notify} projectId={activeProjectId} project={projects.find((item) => item.id === activeProjectId)} />}
          {currentView === "boq" && canUse("boq") && <BoqView navigate={navigate} notify={notify} projectId={activeProjectId} />}
          {currentView === "billing" && canUse("billing") && <BillingView notify={notify} projectId={activeProjectId} />}
          {currentView === "procurement" && canUse("procurement") && <ProcurementView notify={notify} projectId={activeProjectId} />}
          {currentView === "bast" && canUse("bast") && <BastView notify={notify} projectId={activeProjectId} />}
          {currentView === "finance" && canUse("finance") && <FinanceView notify={notify} projectId={selectedProjectId} />}
          {currentView === "users" && canUse("users") && <UsersView notify={notify} language={language} currentUserId={user.id} />}
          {currentView === "profile" && <ProfileView language={language} user={user} notify={notify} onUserChange={setUser} />}
          {currentView === "settings" && <SettingsView language={language} notify={notify} onLanguageChange={(next) => { setLanguage(next); setUser((current) => current ? { ...current, preferredLanguage: next } : current); }} />}
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
