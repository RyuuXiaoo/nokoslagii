import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import moment from 'moment-timezone';
import { ensureUser, getSaldo, addSaldo, minSaldo } from './lib/wallet.js';
import { listOrders, getOrder, setOrder, updateOrder, pollOtpUntilDone } from './lib/orders.js';

const app = express();
app.use(cors());
app.use(express.json());

const JASA = process.env.JASAOTP_API_KEY;
const ATL = process.env.ATLANTIC_API_KEY;
const MARGIN_V1 = Number(process.env.MARGIN_V1 || 0);

// Middleware user demo (ganti ke auth beneran di produksi)
app.use((req, res, next) => {
  const userId = req.header('x-user-id') || 'demo-user';
  req.userId = userId; ensureUser(userId); next();
});

// ===== Helper =====
const toRupiah = n => Number(n||0).toLocaleString('id-ID');

// ===== API: Negara & Layanan =====
app.get('/api/countries', async (req, res) => {
  try {
    const r = await fetch('https://api.jasaotp.id/v1/negara.php');
    const j = await r.json();
    if (!j.success) return res.status(400).json({ ok:false, message:j.message });
    res.json({ ok:true, data: j.data });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

app.get('/api/services', async (req, res) => {
  const negara = req.query.negara;
  if (!negara) return res.status(400).json({ ok:false, message:'negara required' });
  try {
    const r = await fetch(`https://api.jasaotp.id/v1/layanan.php?negara=${negara}`);
    const j = await r.json();
    const data = j?.[negara] || {};
    // tambah kode ke setiap item
    const list = Object.entries(data).map(([kode, item]) => ({ ...item, kode }));
    res.json({ ok:true, data:list });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

// ===== API: Quote harga + saldo =====
app.post('/api/order/quote', async (req, res) => {
  const { negara, layanan } = req.body;
  if (!negara || !layanan) return res.status(400).json({ ok:false, message:'negara & layanan wajib' });
  try {
    const r = await fetch(`https://api.jasaotp.id/v1/layanan.php?negara=${negara}`);
    const j = await r.json();
    const price = Number(j?.[negara]?.[layanan]?.harga || 0) + MARGIN_V1;
    const saldo = getSaldo(req.userId);
    res.json({ ok:true, price, saldo, needTopup: saldo < price });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

// ===== API: Buat QRIS jika saldo kurang =====
app.post('/api/payment/create', async (req, res) => {
  const { nominal } = req.body;
  if (!nominal || Number(nominal) <= 0) return res.status(400).json({ ok:false, message:'nominal invalid' });
  try {
    const reff = uuidv4().split('-')[0].toUpperCase();
    const form = new URLSearchParams();
    form.append('api_key', ATL);
    form.append('reff_id', reff);
    form.append('nominal', String(nominal));
    form.append('type', 'ewallet');
    form.append('metode', 'qrisfast');

    const r = await fetch('https://atlantich2h.com/deposit/create', { method:'POST', body: form });
    const j = await r.json();
    if (!j.status) return res.status(400).json({ ok:false, message: j.message });

    const qrPng = await QRCode.toDataURL(j.data.qr_string, { margin: 2, scale: 8 });
    const expiredAt = moment().tz('Asia/Jakarta').add(15, 'minutes').toISOString();

    res.json({ ok:true, paymentId: j.data.id, reffId: reff, qrImage: qrPng, expiredAt });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

app.get('/api/payment/status', async (req, res) => {
  const { id } = req.query; if (!id) return res.status(400).json({ ok:false, message:'id required' });
  try {
    const form = new URLSearchParams(); form.append('api_key', ATL); form.append('id', id);
    const r = await fetch('https://atlantich2h.com/deposit/status', { method:'POST', body: form });
    const j = await r.json();
    const status = j?.data?.status || 'unknown';
    res.json({ ok:true, status });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

// ===== API: Commit order (saldo cukup atau setelah topup sukses) =====
app.post('/api/order/commit', async (req, res) => {
  const { negara, layanan, operator = 'any' } = req.body;
  if (!negara || !layanan) return res.status(400).json({ ok:false, message:'negara & layanan wajib' });
  try {
    // cek harga
    const r = await fetch(`https://api.jasaotp.id/v1/layanan.php?negara=${negara}`);
    const j = await r.json();
    const priceAsli = Number(j?.[negara]?.[layanan]?.harga || 0);
    const price = priceAsli + MARGIN_V1;

    // potong saldo
    try { minSaldo(req.userId, price); } catch (e) { return res.status(400).json({ ok:false, message:'Saldo kurang' }); }

    // call JasaOTP order
    const url = `https://api.jasaotp.id/v1/order.php?api_key=${JASA}&negara=${negara}&layanan=${layanan}&operator=${operator}`;
    const r2 = await fetch(url); const j2 = await r2.json();
    if (!j2.success) { addSaldo(req.userId, price); return res.status(400).json({ ok:false, message:j2.message }); }

    const { order_id, number: nomor, app: aplikasi = layanan } = j2.data;
    const order = {
      orderId: String(order_id), userId: req.userId, negara, layanan, operator,
      aplikasi, nomor, price, status: 'pending', createdAt: Date.now(), otp: null
    };
    setOrder(order);

    // mulai polling OTP di background (server side)
    pollOtpUntilDone({ jasaKey: JASA, orderId, onUpdate: async (patch) => {
      updateOrder(orderId, patch);
    }});

    res.json({ ok:true, order });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

// ===== API: List & detail order =====
app.get('/api/orders', (req, res) => {
  res.json({ ok:true, data: listOrders(req.userId) });
});
app.get('/api/order/:id', (req, res) => {
  const o = getOrder(req.params.id);
  if (!o || o.userId !== req.userId) return res.status(404).json({ ok:false, message:'not found' });
  res.json({ ok:true, data: o });
});

// ===== API: Cancel manual (refund) =====
app.post('/api/order/:id/cancel', async (req, res) => {
  const { id } = req.params; const o = getOrder(id);
  if (!o || o.userId !== req.userId) return res.status(404).json({ ok:false, message:'not found' });
  if (o.status !== 'pending') return res.status(400).json({ ok:false, message:'Tidak bisa cancel, sudah bukan pending' });

  try {
    const url = `https://api.jasaotp.id/v1/cancel.php?api_key=${JASA}&id=${id}`;
    const r = await fetch(url); const j = await r.json();
    if (!j.success) return res.status(400).json({ ok:false, message:j.message });

    updateOrder(id, { status: 'failed' });
    addSaldo(req.userId, o.price); // refund
    res.json({ ok:true, message:'dibatalkan & refund' });
  } catch (e) { res.status(500).json({ ok:false, message:e.message }); }
});

app.listen(process.env.PORT, () => {
  console.log(`API running on :${process.env.PORT}`);
});
