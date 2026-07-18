"use client";

import {
  Bell,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleUserRound,
  ClipboardSignature,
  FileSpreadsheet,
  Files,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  PanelLeftClose,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ViewKey } from "../data";
import { AuthScreen } from "./auth-screen";
import { BastView } from "./bast-view";
import { BillingView } from "./billing-view";
import { BoqView } from "./boq-view";
import { DashboardView } from "./dashboard-view";
import { FinanceView } from "./finance-view";
import { ProcurementView } from "./procurement-view";
import { ProjectView } from "./project-view";
import { UsersView } from "./users-view";

interface NavigationItem {
  id: ViewKey;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}

const mainNavigation: NavigationItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "project", label: "Manajemen Proyek", icon: FolderKanban, badge: "3" },
  { id: "boq", label: "BoQ Generator", icon: FileSpreadsheet },
  { id: "billing", label: "Quotation & Invoice", icon: ReceiptText, badge: "2" },
];

const operationsNavigation: NavigationItem[] = [
  { id: "procurement", label: "Procurement & Vendor", icon: PackageSearch },
  { id: "bast", label: "BAST Digital", icon: ClipboardSignature },
  { id: "finance", label: "Pembukuan", icon: WalletCards },
];

const administrationNavigation: NavigationItem[] = [
  { id: "users", label: "Pengguna & Akses", icon: ShieldCheck },
];

const viewMeta: Record<ViewKey, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Pusat kendali operasional" },
  project: { title: "Manajemen Proyek", subtitle: "Jadwal, tugas, dan dokumentasi" },
  boq: { title: "BoQ Generator", subtitle: "Kalkulasi kebutuhan dan margin" },
  billing: { title: "Quotation & Invoice", subtitle: "Penawaran dan penagihan proyek" },
  procurement: { title: "Procurement & Vendor", subtitle: "Mitra kerja dan Surat Perintah Kerja" },
  bast: { title: "BAST Digital", subtitle: "Serah terima dan tanda tangan digital" },
  finance: { title: "Pembukuan", subtitle: "Arus kas dan profitabilitas proyek" },
  users: { title: "Pengguna & Akses", subtitle: "Akun tim dan otorisasi peran" },
};

function SidebarNavigation({
  currentView,
  navigate,
  onClose,
}: {
  currentView: ViewKey;
  navigate: (view: ViewKey) => void;
  onClose: () => void;
}) {
  function renderItems(items: NavigationItem[]) {
    return items.map((item) => {
      const Icon = item.icon;
      return (
        <button
          className={`sidebar-link ${currentView === item.id ? "active" : ""}`}
          type="button"
          key={item.id}
          onClick={() => {
            navigate(item.id);
            onClose();
          }}
        >
          <Icon size={18} />
          <span>{item.label}</span>
          {item.badge && <small>{item.badge}</small>}
        </button>
      );
    });
  }

  return (
    <>
      <div className="sidebar-brand">
        <img src="/perumnet-mark.png" alt="" width={42} height={42} />
        <div><strong>PerumNet</strong><span>Enterprise</span></div>
        <button className="icon-button sidebar-close" type="button" aria-label="Tutup navigasi" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="workspace-switcher">
        <span className="workspace-icon"><Files size={17} /></span>
        <div><span>Workspace</span><strong>PerumNet Enterprise</strong></div>
        <ChevronDown size={15} />
      </div>
      <nav className="sidebar-nav" aria-label="Navigasi utama">
        <span className="nav-section-label">UTAMA</span>
        {renderItems(mainNavigation)}
        <span className="nav-section-label">OPERASIONAL</span>
        {renderItems(operationsNavigation)}
        <span className="nav-section-label">ADMINISTRASI</span>
        {renderItems(administrationNavigation)}
        <button className="sidebar-link" type="button">
          <Settings size={18} /><span>Pengaturan</span>
        </button>
      </nav>
    </>
  );
}

export function EnterpriseApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<ViewKey>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function notify(message: string) {
    setToast(message);
  }

  function navigate(view: ViewKey) {
    setCurrentView(view);
    setNotificationsOpen(false);
    setProfileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function logout() {
    setIsAuthenticated(false);
    setCurrentView("dashboard");
    setProfileOpen(false);
    notify("");
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <SidebarNavigation currentView={currentView} navigate={navigate} onClose={() => setMobileNavOpen(false)} />
        <div className="sidebar-footer">
          <div className="sidebar-help">
            <span><BookOpenCheck size={18} /></span>
            <div><strong>Butuh bantuan?</strong><small>Pusat panduan PerumNet</small></div>
          </div>
          <button className="sidebar-user" type="button" onClick={() => setProfileOpen((value) => !value)}>
            <span className="avatar">DM</span>
            <span><strong>Dewa Mahardika</strong><small>Administrator</small></span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Tutup navigasi" onClick={() => setMobileNavOpen(false)} />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" type="button" aria-label="Buka navigasi" onClick={() => setMobileNavOpen(true)}>
              <Menu size={20} />
            </button>
            <button className="icon-button desktop-collapse" type="button" aria-label="Navigasi samping"><PanelLeftClose size={18} /></button>
            <div className="topbar-title">
              <strong>{viewMeta[currentView].title}</strong>
              <span>{viewMeta[currentView].subtitle}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={17} />
              <input placeholder="Cari proyek, invoice, atau vendor..." />
              <kbd>⌘ K</kbd>
            </label>
            <div className="dropdown-anchor">
              <button
                className={`icon-button notification-button ${notificationsOpen ? "active" : ""}`}
                type="button"
                aria-label="Notifikasi"
                aria-expanded={notificationsOpen}
                onClick={() => { setNotificationsOpen((value) => !value); setProfileOpen(false); }}
              >
                <Bell size={18} /><span />
              </button>
              {notificationsOpen && (
                <div className="topbar-dropdown notifications-dropdown">
                  <div className="dropdown-head"><strong>Notifikasi</strong><button className="text-button" type="button" onClick={() => setNotificationsOpen(false)}>Tandai dibaca</button></div>
                  <button type="button" onClick={() => navigate("billing")}><span className="notification-icon warning"><ReceiptText size={16} /></span><span><strong>Invoice jatuh tempo</strong><small>Pelunasan WiFi Resort jatuh tempo 2 Agu.</small></span></button>
                  <button type="button" onClick={() => navigate("project")}><span className="notification-icon info"><FolderKanban size={16} /></span><span><strong>Dokumentasi baru</strong><small>Agus mengunggah 8 foto lapangan.</small></span></button>
                  <button type="button" onClick={() => navigate("bast")}><span className="notification-icon success"><ClipboardSignature size={16} /></span><span><strong>BAST siap</strong><small>Villa Complex menunggu tanda tangan.</small></span></button>
                </div>
              )}
            </div>
            <div className="dropdown-anchor">
              <button className="topbar-profile" type="button" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false); }}>
                <span className="avatar small">DM</span>
                <span><strong>Dewa</strong><small>Admin</small></span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="topbar-dropdown profile-dropdown">
                  <div className="profile-dropdown-head"><span className="avatar">DM</span><div><strong>Dewa Mahardika</strong><small>admin@perumnet.id</small></div></div>
                  <button type="button"><CircleUserRound size={16} /> Profil saya</button>
                  <button type="button"><Settings size={16} /> Pengaturan akun</button>
                  <div className="dropdown-separator" />
                  <button className="logout-action" type="button" onClick={logout}><LogOut size={16} /> Keluar</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          {currentView === "dashboard" && <DashboardView navigate={navigate} notify={notify} />}
          {currentView === "project" && <ProjectView navigate={navigate} notify={notify} />}
          {currentView === "boq" && <BoqView navigate={navigate} notify={notify} />}
          {currentView === "billing" && <BillingView notify={notify} />}
          {currentView === "procurement" && <ProcurementView notify={notify} />}
          {currentView === "bast" && <BastView notify={notify} />}
          {currentView === "finance" && <FinanceView notify={notify} />}
          {currentView === "users" && <UsersView notify={notify} />}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Navigasi cepat">
        <button className={currentView === "dashboard" ? "active" : ""} type="button" onClick={() => navigate("dashboard")}><LayoutDashboard size={19} /><span>Beranda</span></button>
        <button className={currentView === "project" ? "active" : ""} type="button" onClick={() => navigate("project")}><FolderKanban size={19} /><span>Proyek</span></button>
        <button className={currentView === "boq" ? "active" : ""} type="button" onClick={() => navigate("boq")}><FileSpreadsheet size={19} /><span>BoQ</span></button>
        <button className={currentView === "finance" ? "active" : ""} type="button" onClick={() => navigate("finance")}><WalletCards size={19} /><span>Keuangan</span></button>
        <button type="button" onClick={() => setMobileNavOpen(true)}><Menu size={19} /><span>Lainnya</span></button>
      </nav>

      {toast && (
        <div className="toast" role="status">
          <span><Check size={16} /></span>
          <p>{toast}</p>
          <button className="icon-button" type="button" aria-label="Tutup notifikasi" onClick={() => setToast("")}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
