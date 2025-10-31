# Nokos Order Web (QRIS + OTP Auto)

## Cara cepat
1. Backend
```bash
cd server
cp .env.example .env    # edit API key JasaOTP & Atlantic
npm i
npm run dev
```
2. Frontend
- Buka `web/index.html` dengan Live Server (VSCode) atau serahkan ke hosting statis.
- Pastikan `API_BASE` di `web/app.jsx` mengarah ke URL backend kamu.

## Fitur
- Pilih Negara → Layanan → Operator.
- Beli → Loading → QRIS otomatis muncul bila saldo kurang.
- Setelah dibayar, backend otomatis commit order, polling OTP, dan push status.
- Riwayat pesanan: pending/success/failed + OTP tampil.
