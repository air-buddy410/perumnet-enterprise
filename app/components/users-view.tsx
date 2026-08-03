"use client";

import {
  ChevronDown,
  Eye,
  Filter,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  UserRoundX,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accessModules,
  defaultPermissions,
  moduleLabels,
  type AccessLevel,
  type AccessPermissions,
} from "@/shared/access";
import { api, messageOf } from "../api-client";
import { TeamUser } from "../data";
import { localizedLabel, type AppLanguage } from "../i18n";
import { UserAvatar } from "./user-avatar";

interface UsersViewProps {
  notify: (message: string) => void;
  language: AppLanguage;
  currentUserId: string;
  canManage: boolean;
}

const roles: TeamUser["role"][] = ["Admin", "Project Manager", "Engineer", "Finance"];

function roleClass(role: TeamUser["role"]) {
  if (role === "Admin") return "admin";
  if (role === "Project Manager") return "pm";
  if (role === "Finance") return "finance";
  return "engineer";
}

function withPermissions(user: TeamUser): TeamUser {
  return { ...user, permissions: user.permissions ?? defaultPermissions(user.role) };
}

export function UsersView({ notify, language, currentUserId, canManage }: UsersViewProps) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Semua peran");
  const [editing, setEditing] = useState<TeamUser | "new" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamUser["role"]>("Engineer");
  const [status, setStatus] = useState<TeamUser["status"]>("Aktif");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [permissions, setPermissions] = useState<AccessPermissions>(defaultPermissions("Engineer"));
  const id = language === "id";

  useEffect(() => {
    let active = true;
    api<TeamUser[]>("/api/users")
      .then((data) => {
        if (active) setUsers(data.map(withPermissions));
      })
      .catch((error) => notify(messageOf(error, language)));
    return () => { active = false; };
  }, [language, notify]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !normalized || [user.name, user.email, user.role].join(" ").toLowerCase().includes(normalized);
      const matchesFilter = filter === "Semua peran" || user.role === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, users]);

  function openNewUser() {
    setEditing("new");
    setName("");
    setEmail("");
    setRole("Engineer");
    setStatus("Aktif");
    setPassword("");
    setPermissions(defaultPermissions("Engineer"));
  }

  function openEditUser(user: TeamUser) {
    setEditing(user);
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setStatus(user.status);
    setPassword("");
    setPermissions(user.permissions ?? defaultPermissions(user.role));
  }

  function changeRole(nextRole: TeamUser["role"]) {
    setRole(nextRole);
    setPermissions(defaultPermissions(nextRole));
  }

  function setPermission(module: keyof AccessPermissions, level: AccessLevel) {
    setPermissions((current) => ({ ...current, [module]: level }));
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === "new" && password.length < 10) {
      notify(id ? "Kata sandi awal minimal 10 karakter." : "The initial password must be at least 10 characters.");
      return;
    }
    try {
      const payload = { name: name.trim(), email: email.trim(), role, status, permissions, ...(password ? { password } : {}) };
      if (editing === "new") {
        const user = withPermissions(await api<TeamUser>("/api/users", {
          method: "POST",
          body: JSON.stringify(payload),
        }));
        setUsers((current) => [user, ...current]);
        notify(id ? "Akun siap dipakai. Sampaikan email dan kata sandi awal kepada pengguna secara aman." : "The account is ready. Share the email and initial password securely.");
      } else if (editing) {
        const updated = withPermissions(await api<TeamUser>(`/api/users/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }));
        setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
        notify(id ? "Akun dan hak akses berhasil diperbarui." : "Account and permissions updated.");
      }
      setEditing(null);
      setPassword("");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function toggleUser(user: TeamUser) {
    try {
      const updated = withPermissions(await api<TeamUser>(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: user.status === "Aktif" ? "Nonaktif" : "Aktif" }),
      }));
      setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
      notify(id ? "Status akses pengguna diperbarui." : "User access status updated.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  async function deleteUser() {
    if (!editing || editing === "new" || editing.id === currentUserId) return;
    if (!window.confirm(id ? `Hapus akun ${editing.name}? Tindakan ini tidak dapat dibatalkan.` : `Delete ${editing.name}'s account? This cannot be undone.`)) return;
    try {
      await api(`/api/users/${editing.id}`, { method: "DELETE" });
      setUsers((current) => current.filter((user) => user.id !== editing.id));
      setEditing(null);
      notify(id ? "Akun pengguna berhasil dihapus." : "User account deleted.");
    } catch (error) {
      notify(messageOf(error, language));
    }
  }

  const activeCount = users.filter((user) => user.status === "Aktif").length;

  return (
    <div className="page-stack" data-testid="users-view">
      <section className="page-title-row">
        <div><span className="eyebrow">{id ? "AKSES & OTORISASI" : "ACCESS & AUTHORIZATION"}</span><h1>{id ? "Manajemen Pengguna" : "User Management"}</h1><p>{id ? "Buat akun dan tentukan akses setiap modul secara rinci." : "Create accounts and configure detailed module access."}</p></div>
        {canManage && <button className="button primary" type="button" onClick={openNewUser}><Plus size={16} /> {id ? "Tambah pengguna" : "Add user"}</button>}
      </section>

      <section className="metric-grid user-metrics">
        <article className="metric-card"><span className="metric-icon teal"><UsersRound size={20} /></span><div className="metric-main"><span>{id ? "Total pengguna" : "Total users"}</span><strong>{users.length}</strong></div><span className="metric-change">4 {id ? "peran" : "roles"}</span></article>
        <article className="metric-card"><span className="metric-icon green"><UserCheck size={20} /></span><div className="metric-main"><span>{id ? "Akun aktif" : "Active accounts"}</span><strong>{activeCount}</strong></div><span className="metric-change positive">{users.length ? Math.round((activeCount / users.length) * 100) : 0}% {id ? "tim" : "team"}</span></article>
        <article className="metric-card"><span className="metric-icon orange"><UserCog size={20} /></span><div className="metric-main"><span>Admin & PM</span><strong>{users.filter((user) => user.role === "Admin" || user.role === "Project Manager").length}</strong></div><span className="metric-change">{id ? "Akses pengelola" : "Manager access"}</span></article>
        <article className="metric-card"><span className="metric-icon blue"><ShieldCheck size={20} /></span><div className="metric-main"><span>{id ? "Keamanan" : "Security"}</span><strong>{id ? "Aktif" : "Active"}</strong></div><span className="metric-change positive">RBAC</span></article>
      </section>

      <section className="panel users-panel">
        <div className="panel-head users-head">
          <div><span className="eyebrow">{id ? "DIREKTORI TIM" : "TEAM DIRECTORY"}</span><h2>{id ? "Daftar pengguna" : "User list"}</h2></div>
          <div className="project-tools">
            <label className="search-field compact"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari nama atau email..." : "Search name or email..."} /></label>
            <label className="select-compact"><Filter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="Semua peran">{id ? "Semua peran" : "All roles"}</option>{roles.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
          </div>
        </div>
        <div className="user-list">
          {visibleUsers.map((user) => (
            <article className={`user-row ${user.status === "Nonaktif" ? "disabled" : ""}`} key={user.id}>
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                className={`user-avatar ${roleClass(user.role)}`}
              />
              <div className="user-primary"><strong>{user.name}</strong><span><Mail size={13} /> {user.email}</span></div>
              <span className={`role-chip ${roleClass(user.role)}`}>{user.role}</span>
              <div className="user-last-active"><span>{id ? "Aktivitas terakhir" : "Last activity"}</span><strong>{user.lastActive}</strong></div>
              <span className={`status-badge ${user.status === "Aktif" ? "success" : "neutral"}`}><span className="badge-dot" /> {localizedLabel(language, user.status)}</span>
              {canManage && <button className={`button small ${user.status === "Aktif" ? "subtle" : "secondary"}`} type="button" disabled={user.id === currentUserId} onClick={() => toggleUser(user)}>{user.status === "Aktif" ? <UserRoundX size={15} /> : <UserCheck size={15} />}{user.status === "Aktif" ? (id ? "Nonaktifkan" : "Disable") : (id ? "Aktifkan" : "Enable")}</button>}
              {canManage && <button className="icon-button" type="button" aria-label={`${id ? "Atur" : "Edit"} ${user.name}`} onClick={() => openEditUser(user)}><Pencil size={15} /></button>}
            </article>
          ))}
        </div>
        {!visibleUsers.length && <div className="empty-state"><Search size={28} /><h3>{id ? "Pengguna tidak ditemukan" : "No users found"}</h3></div>}
      </section>

      <section className="role-overview">
        <div className="role-overview-copy"><span className="metric-icon teal"><ShieldCheck size={21} /></span><div><span className="eyebrow">{id ? "KONTROL AKSES" : "ACCESS CONTROL"}</span><h2>{id ? "Akses per modul" : "Module-level access"}</h2><p>{id ? "Peran memberikan rekomendasi awal; Admin tetap dapat menyesuaikan setiap modul." : "Roles provide a starting point; Admins can still customize every module."}</p></div></div>
      </section>

      {editing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}>
          <section className="modal-card user-access-modal" role="dialog" aria-modal="true" aria-labelledby="user-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">{editing === "new" ? (id ? "PENGGUNA BARU" : "NEW USER") : (id ? "EDIT PENGGUNA" : "EDIT USER")}</span><h2 id="user-form-title">{editing === "new" ? (id ? "Buat akun anggota tim" : "Create a team account") : name}</h2></div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={() => setEditing(null)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={saveUser}>
              <label className="field"><span>{id ? "Nama lengkap" : "Full name"}</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="field"><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="field"><span>{id ? "Peran" : "Role"}</span><select value={role} onChange={(event) => changeRole(event.target.value as TeamUser["role"])}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field"><span>Status</span><select value={status} disabled={editing !== "new" && editing.id === currentUserId} onChange={(event) => setStatus(event.target.value as TeamUser["status"])}><option value="Aktif">{id ? "Aktif" : "Active"}</option><option value="Nonaktif">{id ? "Nonaktif" : "Inactive"}</option></select></label>
              <label className="field full"><span>{editing === "new" ? (id ? "Kata sandi awal" : "Initial password") : (id ? "Kata sandi baru (opsional)" : "New password (optional)")}</span><div className="password-field"><input type={showPassword ? "text" : "password"} required={editing === "new"} minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button type="button" aria-label={id ? "Tampilkan kata sandi" : "Show password"} onClick={() => setShowPassword((value) => !value)}><Eye size={16} /></button></div><small>{id ? "Minimal 10 karakter. Sampaikan secara aman kepada pengguna." : "At least 10 characters. Share it securely with the user."}</small></label>
              <div className="permission-editor full">
                <div><ShieldCheck size={18} /><span><strong>{id ? "Hak akses modul" : "Module permissions"}</strong><small>{id ? "Tidak ada = disembunyikan, Lihat = baca saja, Kelola = dapat mengubah data." : "No access = hidden, View = read-only, Manage = can change data."}</small></span></div>
                <div className="permission-table">
                  {accessModules.map((module) => (
                    <div className="permission-row" key={module}>
                      <strong>{moduleLabels[module][language]}</strong>
                      <div>
                        {(["none", "view", "manage"] as AccessLevel[]).map((level) => (
                          <label className={permissions[module] === level ? "active" : ""} key={level}>
                            <input type="radio" name={`permission-${module}`} checked={permissions[module] === level} onChange={() => setPermission(module, level)} />
                            {level === "none" ? (id ? "Tidak ada" : "None") : level === "view" ? (id ? "Lihat" : "View") : (id ? "Kelola" : "Manage")}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-actions full">
                {editing !== "new" && editing.id !== currentUserId && <button className="button danger" type="button" onClick={deleteUser}><Trash2 size={16} /> {id ? "Hapus akun" : "Delete account"}</button>}
                <span className="modal-action-spacer" />
                <button className="button secondary" type="button" onClick={() => setEditing(null)}>{id ? "Batal" : "Cancel"}</button>
                <button className="button primary" type="submit">{editing === "new" ? <Plus size={16} /> : <KeyRound size={16} />}{editing === "new" ? (id ? "Buat akun" : "Create account") : (id ? "Simpan perubahan" : "Save changes")}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
