"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Mail, ShieldCheck, Wifi } from "lucide-react";
import { FormEvent, useState } from "react";

interface AuthScreenProps {
  onLogin: (email: string) => void;
}

type AuthMode = "login" | "forgot" | "reset";

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("admin@perumnet.id");
  const [password, setPassword] = useState("perumnet123");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 6) {
      setError("Email atau kata sandi tidak sesuai.");
      return;
    }
    onLogin(email);
  }

  function submitForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!email.includes("@")) {
      setError("Masukkan alamat email yang valid.");
      return;
    }
    setSent(true);
  }

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Kata sandi minimal 8 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi kata sandi belum sama.");
      return;
    }
    setPassword(newPassword);
    setNewPassword("");
    setConfirmPassword("");
    setSent(false);
    setMode("login");
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-label="PerumNet Enterprise">
        <div className="auth-grid" />
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
        <div className="auth-brand-top">
          <img
            src="/perumnet-mark.png"
            alt=""
            width={58}
            height={58}
            className="auth-mark"
          />
          <span>PERUMNET ENTERPRISE</span>
        </div>
        <div className="auth-brand-copy">
          <span className="eyebrow light">OPERASIONAL DALAM SATU SISTEM</span>
          <h1>
            Kelola proyek IT
            <br />
            <span>lebih terukur.</span>
          </h1>
          <p>
            Dari penawaran, pelaksanaan lapangan, hingga profitabilitas proyek—semua
            terhubung dalam ruang kerja yang ringkas.
          </p>
          <div className="auth-trust-card">
            <span className="auth-trust-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>Akses aman berbasis peran</strong>
              <small>Data operasional hanya untuk tim yang berwenang</small>
            </div>
            <span className="status-dot online" />
          </div>
        </div>
        <div className="auth-network-pill">
          <Wifi size={16} />
          <span>Sistem operasional siap digunakan</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-logo">
            <img
              src="/perumnet-enterprise-logo.png"
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
                  Portal operasional PerumNet
                </span>
                <span className="eyebrow">AKSES TIM</span>
                <h2>Selamat datang kembali.</h2>
                <p>Masuk untuk melanjutkan pekerjaan dan memantau proyek Anda.</p>
              </div>
              <form className="auth-form" onSubmit={submitLogin}>
                <label className="field">
                  <span>Email</span>
                  <span className="input-with-icon">
                    <Mail size={17} />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      aria-invalid={Boolean(error)}
                    />
                  </span>
                </label>
                <label className="field">
                  <span>Kata sandi</span>
                  <span className="input-with-icon">
                    <KeyRound size={17} />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                    />
                    <button
                      className="icon-button inline"
                      type="button"
                      aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>
                <div className="auth-options">
                  <label className="checkbox-label">
                    <input type="checkbox" defaultChecked />
                    <span>Ingat saya</span>
                  </label>
                  <button className="text-button" type="button" onClick={() => setMode("forgot")}>
                    Lupa kata sandi?
                  </button>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button primary auth-submit" type="submit">
                  Masuk ke Dashboard <ArrowRight size={17} />
                </button>
              </form>
              <div className="demo-access">
                <span className="demo-access-icon"><ShieldCheck size={18} /></span>
                <div>
                  <strong>Akun demo sudah terisi</strong>
                  <small>Klik tombol masuk untuk menjelajahi seluruh modul frontend.</small>
                </div>
              </div>
            </>
          )}

          {mode === "forgot" && (
            <>
              <button className="back-button" type="button" onClick={() => { setMode("login"); setSent(false); setError(""); }}>
                <ArrowLeft size={17} /> Kembali ke login
              </button>
              <div className="auth-heading compact">
                <span className="auth-page-icon"><Mail size={24} /></span>
                <span className="eyebrow">PEMULIHAN AKSES</span>
                <h2>Lupa kata sandi?</h2>
                <p>Kami akan mengirimkan tautan pemulihan ke email yang terdaftar.</p>
              </div>
              {!sent ? (
                <form className="auth-form" onSubmit={submitForgot}>
                  <label className="field">
                    <span>Email terdaftar</span>
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
                  <button className="button primary auth-submit" type="submit">
                    Kirim tautan pemulihan <ArrowRight size={17} />
                  </button>
                </form>
              ) : (
                <div className="success-panel" role="status">
                  <span className="success-panel-icon"><Mail size={25} /></span>
                  <h3>Email pemulihan terkirim</h3>
                  <p>
                    Simulasi tautan reset telah dikirim ke <strong>{email}</strong>.
                  </p>
                  <button className="button primary" type="button" onClick={() => setMode("reset")}>
                    Buka halaman reset <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "reset" && (
            <>
              <button className="back-button" type="button" onClick={() => setMode("forgot")}>
                <ArrowLeft size={17} /> Kembali
              </button>
              <div className="auth-heading compact">
                <span className="auth-page-icon"><KeyRound size={24} /></span>
                <span className="eyebrow">KATA SANDI BARU</span>
                <h2>Amankan akun Anda.</h2>
                <p>Gunakan minimal 8 karakter agar akun tetap terlindungi.</p>
              </div>
              <form className="auth-form" onSubmit={submitReset}>
                <label className="field">
                  <span>Kata sandi baru</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span>Konfirmasi kata sandi</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button primary auth-submit" type="submit">
                  Simpan kata sandi <ArrowRight size={17} />
                </button>
              </form>
            </>
          )}

          <p className="auth-footer">© 2026 PerumNet Enterprise · Konsultan IT</p>
        </div>
      </section>
    </main>
  );
}
