# Mailcow → Brevo relay untuk PerumNet Enterprise

Mailcow tetap berjalan di host email khusus `perumnet-mail`. Jangan memasang
Mailcow kedua pada VPS ERP.

## 1. Backup sebelum perubahan

Jalankan backup resmi Mailcow pada host email dan simpan snapshot konfigurasi
DNS Cloudflare. Pastikan backup dapat dibaca sebelum mengubah relayhost.

## 2. Sender-dependent relayhost

Di Mailcow UI, buat sender-dependent transport untuk domain `perumnet.id`:

- Next hop: `smtp-relay.brevo.com:587`
- Autentikasi: login SMTP Brevo dan **SMTP key**, bukan API key
- Enkripsi: STARTTLS
- Sender/domain: `perumnet.id`

Assign transport tersebut ke domain `perumnet.id`, lalu kirim pesan uji langsung
dari mailbox `it@perumnet.id`. SMTP key hanya dimasukkan melalui Mailcow UI atau
secret file dengan izin ketat; jangan menyimpannya di repository atau database
Enterprise.

## 3. DNS

- Pertahankan tepat satu SPF record dan pastikan mekanisme Brevo termasuk di
  dalamnya.
- Publikasikan DKIM Brevo yang diberikan untuk domain.
- Pertahankan DMARC pada `p=none` selama masa observasi, periksa alignment dan
  laporan, lalu tingkatkan kebijakan setelah delivery stabil.
- Jangan menghapus DKIM Mailcow bila email masuk/keluar lain masih
  menandatangani melalui Mailcow.

## 4. App password Enterprise

Buat app password baru khusus aplikasi Enterprise untuk mailbox
`it@perumnet.id`. Konfigurasi pada secret environment production:

```bash
SMTP_HOST=100.65.248.6
SMTP_PORT=465
SMTP_SECURE=true
SMTP_TLS_SERVERNAME=mail.perumnet.id
SMTP_USER=it@perumnet.id
SMTP_PASS=<app-password-khusus-enterprise>
EMAIL_FROM="PerumNet Enterprise <it@perumnet.id>"
EMAIL_REPLY_TO="PerumNet Enterprise <it@perumnet.id>"
```

Uji sertifikat TLS menggunakan nama `mail.perumnet.id`; jangan menonaktifkan
validasi sertifikat.

## 5. Verifikasi

1. Kirim uji dari Mailcow dan pastikan Brevo menerima relay.
2. Kirim uji dari Pengaturan Enterprise.
3. Pastikan outbox berubah Pending → Sent dan provider ID tersimpan.
4. Periksa inbox penerima, header SPF/DKIM/DMARC, dan Reply-To.
5. Simulasikan kredensial salah, pastikan retry 1/5/15/60 menit dan tombol retry
   Admin berfungsi.
6. Pastikan instance demo berstatus capture dan tidak mengirim ke penerima.
