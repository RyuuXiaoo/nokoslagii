
import express from "express";
import fs from "fs";
import moment from "moment-timezone";
import crypto from "crypto";
import fetch from "node-fetch";
import QRCode from "qrcode";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== KONFIGURASI ======
const pajak = 5; // Pajak / admin fee (%)
const apiKeyAtlantic = process.env.ATLANTIC_API_KEY || "ISI_APIKEY_ATLANTIC_KAMU";
const EXPIRE_MINUTES = 6;

// ====== FUNGSI BANTU ======
function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file)));
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}
function toRupiah(num) {
  try {
    return Number(num).toLocaleString("id-ID");
  } catch {
    return String(num);
  }
}

// ====== ENDPOINTS ======

// Daftar produk + stok tersisa
app.get("/produk", (_req, res) => {
  const produk = readJSON("produk.json");
  const stok = readJSON("stok.json");
  const data = produk.map(p => ({
    ...p,
    stokTersedia: Array.isArray(stok[p.id]) ? stok[p.id].length : 0
  }));
  res.json(data);
});

// Buat transaksi & QRIS
app.post("/beli", async (req, res) => {
  try {
    const { idProduk, jumlah } = req.body || {};
    if (!idProduk || !jumlah || Number.isNaN(Number(jumlah)) || Number(jumlah) <= 0) {
      return res.status(400).json({ error: "Param idProduk/jumlah tidak valid" });
    }

    const produkList = readJSON("produk.json");
    const stokList = readJSON("stok.json");

    const produk = produkList.find(p => p.id === idProduk);
    if (!produk) return res.status(400).json({ error: "Produk tidak ditemukan" });

    if (!Array.isArray(stokList[idProduk]) || stokList[idProduk].length < Number(jumlah)) {
      return res.status(400).json({ error: "Stok tidak cukup" });
    }

    const qty = Number(jumlah);
    const harga = produk.price * qty;
    const fee = Math.ceil(harga * pajak / 100);
    const total = harga + fee;

    const reff = crypto.randomBytes(5).toString("hex").toUpperCase();
    const expiredAt = Date.now() + EXPIRE_MINUTES * 60 * 1000;
    const expiredTime = moment(expiredAt).tz("Asia/Jakarta").format("HH:mm");

    // Buat QRIS via Atlantic
    const qrisParam = new URLSearchParams({
      api_key: apiKeyAtlantic,
      reff_id: reff,
      nominal: total.toString(),
      type: "ewallet",
      metode: "qrisfast"
    });

    const resp = await fetch("https://atlantich2h.com/deposit/create", {
      method: "POST",
      body: qrisParam,
      redirect: "follow"
    });

    const data = await resp.json();
    if (!data?.status) {
      return res.status(400).json({ error: "Gagal membuat QRIS: " + (data?.message || "unknown") });
    }

    const qrDataUrl = await QRCode.toDataURL(data.data.qr_string, { margin: 2, scale: 10 });

    const transaksi = {
      id: reff,
      idProduk,
      jumlah: qty,
      harga,
      fee,
      total,
      qrisId: data.data.id,
      status: "pending",
      expiredAt
    };
    writeJSON(`transaksi-${reff}.json`, transaksi);

    res.json({
      reff,
      qr: qrDataUrl,
      total: toRupiah(total),
      expiredTime
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Terjadi kesalahan server saat membuat QRIS" });
  }
});

// Cek status & auto deliver akun
app.get("/status/:reff", async (req, res) => {
  try {
    const reff = req.params.reff;
    const pathTrx = `transaksi-${reff}.json`;
    if (!fs.existsSync(path.join(__dirname, pathTrx))) {
      return res.status(404).json({ error: "Transaksi tidak ditemukan" });
    }
    const trx = readJSON(pathTrx);

    if (Date.now() > trx.expiredAt && trx.status === "pending") {
      trx.status = "expired";
      writeJSON(pathTrx, trx);
      return res.json({ status: "expired" });
    }

    if (trx.status === "success") {
      return res.json({ status: "success", akun: trx.akun });
    }

    // Hit API Atlantic untuk cek status
    const checkParam = new URLSearchParams({
      api_key: apiKeyAtlantic,
      id: String(trx.qrisId)
    });
    const statusRes = await fetch("https://atlantich2h.com/deposit/status", {
      method: "POST",
      body: checkParam,
      redirect: "follow"
    });
    const statusJson = await statusRes.json();
    const status = statusJson?.data?.status || "pending";

    if (["success", "paid"].includes(status)) {
      // deliver akun
      const stokList = readJSON("stok.json");
      const produkList = readJSON("produk.json");
      const akun = stokList[trx.idProduk].splice(0, trx.jumlah);

      const produk = produkList.find(p => p.id === trx.idProduk);
      if (produk) produk.terjual = (produk.terjual || 0) + trx.jumlah;

      writeJSON("stok.json", stokList);
      writeJSON("produk.json", produkList);

      trx.status = "success";
      trx.akun = akun;
      writeJSON(pathTrx, trx);

      // rekap sederhana
      const rekapPath = path.join(__dirname, "rekapan.json");
      const rekap = fs.existsSync(rekapPath) ? JSON.parse(fs.readFileSync(rekapPath)) : { totalTransaksi: 0, totalPenjualan: 0 };
      rekap.totalTransaksi += 1;
      rekap.totalPenjualan += trx.total;
      fs.writeFileSync(rekapPath, JSON.stringify(rekap, null, 2));

      return res.json({ status: "success", akun });
    }

    res.json({ status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal cek status" });
  }
});

// Rekap penjualan
app.get("/rekap", (_req, res) => {
  const rekapPath = path.join(__dirname, "rekapan.json");
  const rekap = fs.existsSync(rekapPath) ? JSON.parse(fs.readFileSync(rekapPath)) : { totalTransaksi: 0, totalPenjualan: 0 };
  res.json(rekap);
});

// Fallback home
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🛍️ Web store berjalan di http://localhost:${PORT}`);
});
