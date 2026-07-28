"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Mail, ShieldCheck, Wifi } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api, messageOf, SessionUser } from "../api-client";
import { appPath } from "../paths";

interface AuthScreenProps {
  language: "id" | "en";
  onLogin: (user: SessionUser) => void;
}

type AuthMode = "login" | "forgot" | "reset";

export function AuthScreen({ language, onLogin }: AuthScreenProps) {
  const id = language === "id";
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const localDevelopment =
    process.env.NODE_ENV === "development" && !demoMode;
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState(
    demoMode
      ? "demo@perumnet.id"
      : localDevelopment
        ? "admin@perumnet.id"
        : "",
  );
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("resetToken");
    if (token) {
      const update = window.setTimeout(() => {
        setResetToken(token);
        setMode("reset");
      }, 0);
      return () => window.clearTimeout(update);
    }
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember }),
      });
      onLogin(result.user);
    } catch (requestError) {
      setError(messageOf(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!email.includes("@")) {
      setError(id ? "Masukkan alamat email yang valid." : "Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ message: string; resetToken?: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetToken(result.resetToken ?? "");
      setSent(true);
    } catch (requestError) {
      setError(messageOf(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError(id ? "Kata sandi minimal 8 karakter." : "The password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(id ? "Konfirmasi kata sandi belum sama." : "The password confirmation does not match.");
      return;
    }
    if (!resetToken) {
      setError(id ? "Tautan reset tidak ditemukan. Minta tautan pemulihan baru." : "Reset link not found. Request a new recovery link.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      setPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setSent(false);
      setResetToken("");
      window.history.replaceState({}, "", window.location.pathname);
      setMode("login");
    } catch (requestError) {
      setError(messageOf(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-label="PerumNet Enterprise">
        <div className="auth-grid" />
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
        <div className="auth-brand-top">
          <img
            src={appPath("/perumnet-mark.png")}
            alt=""
            width={58}
            height={58}
            className="auth-mark"
          />
          <span>PERUMNET ENTERPRISE</span>
        </div>
        <div className="auth-brand-copy">
          <span className="eyebrow light">{id ? "OPERASIONAL DALAM SATU SISTEM" : "OPERATIONS IN ONE SYSTEM"}</span>
          <h1>
            {id ? "Kelola proyek IT" : "Manage IT projects"}
            <br />
            <span>{id ? "lebih terukur." : "with clarity."}</span>
          </h1>
          <p>
            {id ? "Dari penawaran, pelaksanaan lapangan, hingga arus kas proyek—semua terhubung dalam ruang kerja yang ringkas." : "From quotations and field execution to project cash flow, everything is connected in one focused workspace."}
          </p>
          <div className="auth-trust-card">
            <span className="auth-trust-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>{id ? "Akses aman berbasis peran" : "Secure role-based access"}</strong>
              <small>{id ? "Data operasional hanya untuk tim yang berwenang" : "Operational data is limited to authorized teams"}</small>
            </div>
            <span className="status-dot online" />
          </div>
        </div>
        <div className="auth-network-pill">
          <Wifi size={16} />
          <span>{id ? "Sistem operasional siap digunakan" : "Operations system ready"}</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-logo">
            <img
              src={appPath("/perumnet-enterprise-brand.png")}
              alt="PerumNet Enterprise"
              width={190}
              height={200}
            />
          </div>

          {mode === "login" && (
            <>
              <div className="auth-heading">
                <span className="connection-label">
                  <span className="status-dot online" />
                  {id ? "Portal operasional PerumNet" : "PerumNet operations portal"}
                </span>
                <span className="eyebrow">{id ? "AKSES TIM" : "TEAM ACCESS"}</span>
                <h2>{id ? "Selamat datang kembali." : "Welcome back."}</h2>
                <p>{id ? "Masuk untuk melanjutkan pekerjaan dan memantau proyek Anda." : "Sign in to continue your work and monitor projects."}</p>
              </div>
              <form
                className="auth-form"
                autoComplete={localDevelopment ? "off" : "on"}
                onSubmit={submitLogin}
              >
                <label className="field">
                  <span>Email</span>
                  <span className="input-with-icon">
                    <Mail size={17} />
                    <input
                      type="email"
                      name="perumnet-login-email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete={localDevelopment ? "off" : "username"}
                      aria-invalid={Boolean(error)}
                    />
                  </span>
                </label>
                <label className="field">
                  <span>{id ? "Kata sandi" : "Password"}</span>
                  <span className="input-with-icon">
                    <KeyRound size={17} />
                    <input
                      type={showPassword ? "text" : "password"}
                      name="perumnet-login-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={
                        localDevelopment ? "off" : "current-password"
                      }
                      aria-invalid={Boolean(error)}
                    />
                    <button
                      className="icon-button inline"
                      type="button"
                      aria-label={showPassword ? (id ? "Sembunyikan kata sandi" : "Hide password") : (id ? "Tampilkan kata sandi" : "Show password")}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>
                <div className="auth-options">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                    />
                    <span>
                      {id
                        ? "Ingat saya selama 30 hari"
                        : "Remember me for 30 days"}
                    </span>
                  </label>
                  <button className="text-button" type="button" onClick={() => setMode("forgot")}>
                    {id ? "Lupa kata sandi?" : "Forgot password?"}
                  </button>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button primary auth-submit" type="submit" disabled={busy}>
                  {busy ? (id ? "Memeriksa akses..." : "Checking access...") : (id ? "Masuk ke Dashboard" : "Sign in to Dashboard")} <ArrowRight size={17} />
                </button>
              </form>
              {demoMode && (
                <div className="demo-access">
                  <span className="demo-access-icon"><ShieldCheck size={18} /></span>
                  <div>
                    <strong>{id ? "Workspace demo terisolasi" : "Isolated demo workspace"}</strong>
                    <small>{id ? "Gunakan kredensial demo yang diberikan Admin. Data pada mode ini terpisah dari database live." : "Use the demo credentials supplied by an Admin. This mode uses a database separate from live data."}</small>
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "forgot" && (
            <>
              <button className="back-button" type="button" onClick={() => { setMode("login"); setSent(false); setError(""); }}>
                <ArrowLeft size={17} /> {id ? "Kembali ke login" : "Back to sign in"}
              </button>
              <div className="auth-heading compact">
                <span className="auth-page-icon"><Mail size={24} /></span>
                <span className="eyebrow">{id ? "PEMULIHAN AKSES" : "ACCESS RECOVERY"}</span>
                <h2>{id ? "Lupa kata sandi?" : "Forgot your password?"}</h2>
                <p>{id ? "Kami akan mengirimkan tautan pemulihan ke email yang terdaftar." : "We will send a recovery link to your registered email."}</p>
              </div>
              {!sent ? (
                <form className="auth-form" onSubmit={submitForgot}>
                  <label className="field">
                    <span>{id ? "Email terdaftar" : "Registered email"}</span>
                    <span className="input-with-icon">
                      <Mail size={17} />
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                      />
                    </span>
                  </label>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button className="button primary auth-submit" type="submit" disabled={busy}>
                    {busy ? (id ? "Mengirim..." : "Sending...") : (id ? "Kirim tautan pemulihan" : "Send recovery link")} <ArrowRight size={17} />
                  </button>
                </form>
              ) : (
                <div className="success-panel" role="status">
                  <span className="success-panel-icon"><Mail size={25} /></span>
                  <h3>{id ? "Email pemulihan terkirim" : "Recovery email sent"}</h3>
                  <p>
                    {id ? "Tautan reset telah dikirim ke" : "A reset link was sent to"} <strong>{email}</strong>.
                  </p>
                  {resetToken && (
                    <button className="button primary" type="button" onClick={() => setMode("reset")}>
                      {id ? "Buka halaman reset" : "Open reset page"} <ArrowRight size={17} />
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {mode === "reset" && (
            <>
              <button className="back-button" type="button" onClick={() => setMode("forgot")}>
                <ArrowLeft size={17} /> {id ? "Kembali" : "Back"}
              </button>
              <div className="auth-heading compact">
                <span className="auth-page-icon"><KeyRound size={24} /></span>
                <span className="eyebrow">{id ? "KATA SANDI BARU" : "NEW PASSWORD"}</span>
                <h2>{id ? "Amankan akun Anda." : "Secure your account."}</h2>
                <p>{id ? "Gunakan minimal 8 karakter agar akun tetap terlindungi." : "Use at least 8 characters to protect your account."}</p>
              </div>
              <form className="auth-form" onSubmit={submitReset}>
                <label className="field">
                  <span>{id ? "Kata sandi baru" : "New password"}</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span>{id ? "Konfirmasi kata sandi" : "Confirm password"}</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button primary auth-submit" type="submit" disabled={busy}>
                  {busy ? (id ? "Menyimpan..." : "Saving...") : (id ? "Simpan kata sandi" : "Save password")} <ArrowRight size={17} />
                </button>
              </form>
            </>
          )}

          <p className="auth-footer">© 2026 PerumNet Enterprise · {id ? "Konsultan IT" : "IT Consulting"}</p>
        </div>
      </section>
    </main>
  );
}
