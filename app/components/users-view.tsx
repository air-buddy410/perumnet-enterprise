"use client";

import {
  ChevronDown,
  CircleUserRound,
  Filter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserRoundX,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, messageOf } from "../api-client";
import { initialUsers, TeamUser } from "../data";

interface UsersViewProps {
  notify: (message: string) => void;
}

const roles: TeamUser["role"][] = ["Admin", "Project Manager", "Engineer", "Finance"];

function roleClass(role: TeamUser["role"]) {
  if (role === "Admin") return "admin";
  if (role === "Project Manager") return "pm";
  if (role === "Finance") return "finance";
  return "engineer";
}

export function UsersView({ notify }: UsersViewProps) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Semua peran");
  const [showUserForm, setShowUserForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamUser["role"]>("Engineer");

  useEffect(() => {
    let active = true;
    api<TeamUser[]>("/api/users")
      .then((data) => {
        if (active) setUsers(data);
      })
      .catch((error) => notify(messageOf(error)));
    return () => {
      active = false;
    };
  }, [notify]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery =
        !normalized || [user.name, user.email, user.role].join(" ").toLowerCase().includes(normalized);
      const matchesFilter = filter === "Semua peran" || user.role === filter;
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, users]);

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !email.includes("@")) return;
    try {
      const user = await api<TeamUser>("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role, status: "Aktif" }),
      });
      setUsers((current) => [user, ...current]);
      setName("");
      setEmail("");
      setRole("Engineer");
      setShowUserForm(false);
      notify("Akun pengguna berhasil ditambahkan.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function updateRole(id: string, nextRole: TeamUser["role"]) {
    try {
      const updated = await api<TeamUser>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      setUsers((current) => current.map((user) => (user.id === id ? updated : user)));
      notify(`Peran pengguna diubah menjadi ${nextRole}.`);
    } catch (error) {
      notify(messageOf(error));
    }
  }

  async function toggleUser(id: string) {
    const currentUser = users.find((user) => user.id === id);
    if (!currentUser) return;
    try {
      const updated = await api<TeamUser>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: currentUser.status === "Aktif" ? "Nonaktif" : "Aktif" }),
      });
      setUsers((current) => current.map((user) => (user.id === id ? updated : user)));
      notify("Status akses pengguna diperbarui.");
    } catch (error) {
      notify(messageOf(error));
    }
  }

  const activeCount = users.filter((user) => user.status === "Aktif").length;

  return (
    <div className="page-stack" data-testid="users-view">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">AKSES & OTORISASI</span>
          <h1>Manajemen Pengguna</h1>
          <p>Atur akun, peran, dan status akses anggota tim PerumNet.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setShowUserForm(true)}>
          <Plus size={16} /> Tambah pengguna
        </button>
      </section>

      <section className="metric-grid user-metrics">
        <article className="metric-card">
          <span className="metric-icon teal"><UsersRound size={20} /></span>
          <div className="metric-main"><span>Total pengguna</span><strong>{users.length}</strong></div>
          <span className="metric-change">4 peran aktif</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon green"><UserCheck size={20} /></span>
          <div className="metric-main"><span>Akun aktif</span><strong>{activeCount}</strong></div>
          <span className="metric-change positive">{Math.round((activeCount / users.length) * 100)}% tim</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon orange"><UserCog size={20} /></span>
          <div className="metric-main"><span>Admin & PM</span><strong>{users.filter((user) => user.role === "Admin" || user.role === "Project Manager").length}</strong></div>
          <span className="metric-change">Akses pengelola</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue"><ShieldCheck size={20} /></span>
          <div className="metric-main"><span>Keamanan</span><strong>Aktif</strong></div>
          <span className="metric-change positive">RBAC diterapkan</span>
        </article>
      </section>

      <section className="panel users-panel">
        <div className="panel-head users-head">
          <div><span className="eyebrow">DIREKTORI TIM</span><h2>Daftar pengguna</h2></div>
          <div className="project-tools">
            <label className="search-field compact"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama atau email..." /></label>
            <label className="select-compact">
              <Filter size={15} />
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option>Semua peran</option>
                {roles.map((item) => <option key={item}>{item}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </div>
        <div className="user-list">
          {visibleUsers.map((user) => (
            <article className={`user-row ${user.status === "Nonaktif" ? "disabled" : ""}`} key={user.id}>
              <div className={`avatar user-avatar ${roleClass(user.role)}`}>
                {user.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}
              </div>
              <div className="user-primary">
                <strong>{user.name}</strong>
                <span><Mail size={13} /> {user.email}</span>
              </div>
              <label className={`role-select ${roleClass(user.role)}`}>
                <select value={user.role} onChange={(event) => updateRole(user.id, event.target.value as TeamUser["role"])}>
                  {roles.map((item) => <option key={item}>{item}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
              <div className="user-last-active"><span>Aktivitas terakhir</span><strong>{user.lastActive}</strong></div>
              <span className={`status-badge ${user.status === "Aktif" ? "success" : "neutral"}`}><span className="badge-dot" /> {user.status}</span>
              <button className={`button small ${user.status === "Aktif" ? "subtle" : "secondary"}`} type="button" onClick={() => toggleUser(user.id)}>
                {user.status === "Aktif" ? <UserRoundX size={15} /> : <UserCheck size={15} />}
                {user.status === "Aktif" ? "Nonaktifkan" : "Aktifkan"}
              </button>
              <button className="icon-button" type="button" aria-label={`Menu ${user.name}`} onClick={() => notify("Pengaturan pengguna tersedia pada daftar ini.")}><MoreHorizontal size={17} /></button>
            </article>
          ))}
        </div>
        {!visibleUsers.length && (
          <div className="empty-state"><Search size={28} /><h3>Pengguna tidak ditemukan</h3><p>Coba ubah pencarian atau filter peran.</p></div>
        )}
      </section>

      <section className="role-overview">
        <div className="role-overview-copy">
          <span className="metric-icon teal"><ShieldCheck size={21} /></span>
          <div><span className="eyebrow">KONTROL AKSES</span><h2>Hak akses berbasis peran</h2><p>Setiap pengguna hanya melihat modul yang relevan dengan tanggung jawabnya.</p></div>
        </div>
        <div className="role-permission-grid">
          <div><span className="role-chip admin"><CircleUserRound size={15} /> Admin</span><p>Akses penuh, pengguna, dan laporan keuangan.</p></div>
          <div><span className="role-chip pm"><UserCog size={15} /> Project Manager</span><p>Proyek, BoQ, jadwal, dokumentasi, dan BAST.</p></div>
          <div><span className="role-chip engineer"><UsersRound size={15} /> Engineer</span><p>Tugas lapangan, progres, foto, dan tanda tangan.</p></div>
          <div><span className="role-chip finance"><ShieldCheck size={15} /> Finance</span><p>Invoice, vendor, SPK, transaksi, dan laporan.</p></div>
        </div>
      </section>

      {showUserForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowUserForm(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="user-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="eyebrow">PENGGUNA BARU</span><h2 id="user-form-title">Tambahkan anggota tim</h2></div>
              <button className="icon-button" type="button" aria-label="Tutup" onClick={() => setShowUserForm(false)}><X size={18} /></button>
            </div>
            <form className="form-grid" onSubmit={addUser}>
              <label className="field full"><span>Nama lengkap</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama anggota tim" /></label>
              <label className="field full"><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@perumnet.id" /></label>
              <label className="field full"><span>Peran</span><select value={role} onChange={(event) => setRole(event.target.value as TeamUser["role"])}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
              <div className="new-user-security full"><ShieldCheck size={18} /><div><strong>Undangan aman</strong><span>Pengguna akan menerima email untuk membuat kata sandi pertamanya.</span></div></div>
              <div className="modal-actions full"><button className="button secondary" type="button" onClick={() => setShowUserForm(false)}>Batal</button><button className="button primary" type="submit"><Plus size={16} /> Tambah pengguna</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
