"use client";

import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import Script from "next/script";
import { FormEvent, useMemo, useRef, useState } from "react";
import { api, messageOf } from "../api-client";
import type { CmsService } from "@/server/cms";
import type { PublicLanguage } from "@/server/public-language";
import styles from "../site.module.css";

function localized(primary: string, english: string, language: PublicLanguage) {
  return language === "en" && english ? english : primary;
}

export function PublicLeadForm({
  language,
  services,
  sourcePath,
  compact = false,
}: {
  language: PublicLanguage;
  services: CmsService[];
  sourcePath: string;
  compact?: boolean;
}) {
  const id = language === "id";
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const publishedServices = useMemo(
    () => services.filter((service) => service.isPublished),
    [services],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requestKey = idempotencyKey || crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    setSubmitting(true);
    setError("");
    try {
      await api("/api/cms/leads", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          whatsapp: form.get("whatsapp"),
          email: form.get("email") || "",
          companyName: form.get("companyName") || "",
          jobTitle: form.get("jobTitle") || "",
          location: form.get("location"),
          serviceInterest: form.get("serviceInterest"),
          budgetRange: form.get("budgetRange") || "",
          targetStart: form.get("targetStart") || "",
          message: form.get("message"),
          privacyConsent: form.get("privacyConsent") === "on",
          sourcePath,
          language,
          turnstileToken: form.get("cf-turnstile-response") || "",
          website: form.get("website") || "",
        }),
      });
      setSuccess(true);
      setIdempotencyKey(crypto.randomUUID());
      formRef.current?.reset();
      const turnstile = (window as Window & { turnstile?: { reset: () => void } }).turnstile;
      turnstile?.reset();
    } catch (caught) {
      setError(messageOf(caught, language));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className={styles.leadSuccess} role="status">
        <CheckCircle2 size={30} />
        <div>
          <strong>{id ? "Kebutuhan Anda sudah kami terima." : "We have received your request."}</strong>
          <p>{id ? "Tim PerumNet Enterprise akan meninjau detailnya dan menghubungi Anda melalui WhatsApp." : "The PerumNet Enterprise team will review the details and contact you via WhatsApp."}</p>
          <button type="button" onClick={() => setSuccess(false)}>{id ? "Kirim kebutuhan lain" : "Submit another request"}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {turnstileSiteKey ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      ) : null}
      <form ref={formRef} className={`${styles.leadForm} ${compact ? styles.leadFormCompact : ""}`} onSubmit={submit}>
        <div className={styles.leadFormHeader}>
          <span>{id ? "KONSULTASI PROYEK" : "PROJECT ENQUIRY"}</span>
          <h3>{id ? "Ceritakan kebutuhan lokasi Anda." : "Tell us what your site needs."}</h3>
          <p>{id ? "Isi ringkas. Tim kami akan menghubungi Anda untuk memahami kebutuhan teknis lebih lanjut." : "Share the essentials. Our team will contact you to understand the technical requirements."}</p>
        </div>
        <div className={styles.leadFields}>
          <label><span>{id ? "Nama lengkap" : "Full name"} *</span><input name="fullName" required minLength={2} autoComplete="name" /></label>
          <label><span>WhatsApp *</span><input name="whatsapp" required inputMode="tel" autoComplete="tel" placeholder="+62..." /></label>
          {!compact ? <label><span>Email</span><input name="email" type="email" autoComplete="email" /></label> : null}
          {!compact ? <label><span>{id ? "Perusahaan" : "Company"}</span><input name="companyName" autoComplete="organization" /></label> : null}
          {!compact ? <label><span>{id ? "Jabatan" : "Job title"}</span><input name="jobTitle" autoComplete="organization-title" /></label> : null}
          <label><span>{id ? "Lokasi proyek" : "Project location"} *</span><input name="location" required placeholder={id ? "Contoh: Ubud, Gianyar" : "Example: Ubud, Gianyar"} /></label>
          <label><span>{id ? "Layanan yang diminati" : "Service of interest"} *</span><select name="serviceInterest" required defaultValue=""><option value="" disabled>{id ? "Pilih layanan" : "Choose a service"}</option>{publishedServices.map((service) => <option key={service.id} value={service.title}>{localized(service.title, service.titleEn, language)}</option>)}</select></label>
          {!compact ? <label><span>{id ? "Perkiraan budget" : "Estimated budget"}</span><select name="budgetRange" defaultValue=""><option value="">{id ? "Belum ditentukan" : "Not decided"}</option><option>&lt; Rp25 juta</option><option>Rp25–75 juta</option><option>Rp75–250 juta</option><option>&gt; Rp250 juta</option></select></label> : null}
          {!compact ? <label><span>{id ? "Target mulai" : "Target start"}</span><input name="targetStart" type="date" /></label> : null}
          <label className={styles.leadFieldFull}><span>{id ? "Pesan / kebutuhan" : "Message / requirements"} *</span><textarea name="message" required minLength={8} rows={compact ? 3 : 5} placeholder={id ? "Contoh: perlu penataan WiFi untuk villa 12 kamar..." : "Example: WiFi redesign for a 12-room villa..."} /></label>
          <label className={styles.honeypot} aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <label className={styles.privacyConsent}><input name="privacyConsent" type="checkbox" required /><span>{id ? "Saya menyetujui penggunaan data ini untuk konsultasi dan tindak lanjut layanan sesuai Kebijakan Privasi." : "I consent to the use of this data for consultation and service follow-up under the Privacy Policy."}</span></label>
        {turnstileSiteKey ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="customer_lead" data-theme="light" /> : null}
        {error ? <p className={styles.leadError} role="alert">{error}</p> : null}
        <button className={styles.leadSubmit} type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className={styles.spin} size={18} /> : <ArrowRight size={18} />}
          {submitting ? (id ? "Mengirim..." : "Sending...") : (id ? "Kirim kebutuhan" : "Send enquiry")}
        </button>
        <small className={styles.leadSecurity}><ShieldCheck size={14} /> {id ? "Dilindungi dari spam dan disimpan maksimal 24 bulan." : "Spam-protected and retained for no more than 24 months."}</small>
      </form>
    </>
  );
}
