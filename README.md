# Auto Order Web + QRIS Atlantic

Panel web sederhana untuk jual akun/produk digital berbasis file lokal (`produk.json` & `stok.json`) dengan pembayaran QRIS (Atlantic H2H).

## Fitur
- Daftar produk & stok otomatis dari JSON
- Generate QRIS pembayaran (qrisfast) via Atlantic
- Cek status pembayaran
- Auto deliver akun & kurangi stok ketika sukses
- Rekap sederhana (rekapan.json)

## Setup
1. Ekstrak project, lalu install dependency:
   ```bash
   npm install
   ```

2. Set API key Atlantic (wajib):
   ```bash
   export ATLANTIC_API_KEY=ISI_APIKEY
   # Windows (Powershell): $env:ATLANTIC_API_KEY='ISI_APIKEY'
   ```

3. Jalankan:
   ```bash
   npm start
   # buka http://localhost:3000
   ```

## Struktur Data
- `produk.json` (array produk)
- `stok.json` (object: { [idProduk]: string[] } dengan format `email|password|profil|pin|2fa`)

