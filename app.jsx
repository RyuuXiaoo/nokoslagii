const { useEffect, useMemo, useRef, useState } = React;

const API_BASE = 'http://localhost:8080';
const api = axios.create({ baseURL: API_BASE, headers: { 'x-user-id': 'demo-user' }});

dayjs.extend(dayjs_plugin_relativeTime);

function Section({ title, children, right }) {
  return (
    <div className="glass rounded-2xl p-5 shadow-xl border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Select({ value, onChange, children, placeholder }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)}
      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-sky-500">
      <option value="">{placeholder || 'Pilih...'}</option>
      {children}
    </select>
  );
}

function Badge({ children, tone='slate' }) {
  const t = {
    pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    success: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    failed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    info: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  };
  return <span className={`px-2.5 py-1 rounded-full text-xs border ${t[tone]||''}`}>{children}</span>
}

function QRModal({ open, onClose, qrImage, expiredAt, nominal }) {
  const ref = useRef(null);
  useEffect(()=>{
    if (open && ref.current && qrImage) {
      ref.current.innerHTML = '';
      const img = new Image(); img.src = qrImage; img.className = 'w-64 h-64';
      ref.current.appendChild(img);
    }
  }, [open, qrImage]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="glass rounded-2xl p-6 w-[480px] border border-slate-700">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">Scan QRIS untuk bayar</h3>
          <button onClick={onClose} className="opacity-70 hover:opacity-100">✕</button>
        </div>
        <div className="mt-4 flex flex-col items-center gap-3">
          <div ref={ref} className="rounded-xl p-3 bg-white"></div>
          <div className="text-sm text-slate-300">Nominal: Rp{Number(nominal||0).toLocaleString('id-ID')}</div>
          <div className="text-xs text-slate-400">Expired: {dayjs(expiredAt).fromNow()}</div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [countries, setCountries] = useState([]);
  const [services, setServices] = useState([]);

  const [negara, setNegara] = useState('');
  const [layanan, setLayanan] = useState('');
  const [operator, setOperator] = useState('any');

  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState(null); // { paymentId, qrImage, expiredAt, nominal }

  // init
  useEffect(()=>{ (async ()=>{
    const r = await api.get('/api/countries');
    setCountries(r.data.data || []);
  })(); },[]);

  // load services saat negara berubah
  useEffect(()=>{ (async ()=>{
    setLayanan('');
    if (!negara) { setServices([]); return; }
    const r = await api.get('/api/services', { params: { negara } });
    setServices(r.data.data || []);
  })(); }, [negara]);

  const selectedService = useMemo(()=> services.find(s=>s.kode===layanan), [services, layanan]);

  async function refreshOrders() {
    const r = await api.get('/api/orders');
    setOrders(r.data.data || []);
  }
  useEffect(()=>{ refreshOrders(); const t=setInterval(refreshOrders, 5000); return ()=>clearInterval(t); },[]);

  async function handleQuote() {
    if (!negara || !layanan) return alert('Lengkapi pilihan');
    setLoadingQuote(true);
    try {
      const r = await api.post('/api/order/quote', { negara, layanan });
      setQuote(r.data);
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setLoadingQuote(false); }
  }

  async function handleBuy() {
    if (!quote) return;
    setBusy(true);
    try {
      // jika saldo kurang → buat QRIS & poll status
      if (quote.needTopup) {
        const nominal = quote.price - quote.saldo;
        const c = await api.post('/api/payment/create', { nominal });
        const { paymentId, qrImage, expiredAt } = c.data;
        setQrData({ paymentId, qrImage, expiredAt, nominal });
        setQrOpen(true);

        // poll sampai success/cancel/expired
        let done = false; let tries=0;
        while(!done && tries<180) { // max ~15 menit @5s
          tries++;
          await new Promise(r=>setTimeout(r, 5000));
          const s = await api.get('/api/payment/status', { params: { id: paymentId } });
          if (s.data.status === 'success') {
            setQrOpen(false); done=true; break;
          }
          if ([ 'cancel', 'expired', 'failed' ].includes(s.data.status)) {
            setQrOpen(false); alert('Pembayaran '+s.data.status.toUpperCase()); return;
          }
        }
      }
      // commit order (saldo cukup)
      const o = await api.post('/api/order/commit', { negara, layanan, operator });
      const order = o.data.order;
      await refreshOrders();
      // poll status order ini saja supaya live
      let status = order.status; let tries=0;
      while(['pending'].includes(status) && tries<60) { // ~5 menit @5s
        tries++; await new Promise(r=>setTimeout(r, 5000));
        const d = await api.get('/api/order/'+order.orderId);
        status = d.data.data.status; setOrders(prev=>prev.map(x=>x.orderId===order.orderId? d.data.data : x));
      }
      if (status==='success') alert('OTP berhasil diterima!');
      if (status==='failed') alert('Order gagal / timeout');
    } catch (e) {
      alert(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">⚡ Nokos Order</h1>
        <a href="#" className="text-sm opacity-70 hover:opacity-100">@workspace-denai</a>
      </header>

      <Section title="Pilih Layanan" right={<Badge tone="info">Step 1</Badge>}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm text-slate-300">Negara</label>
            <Select value={negara} onChange={setNegara} placeholder="Pilih negara">
              {countries.map(c=> (
                <option key={c.id_negara} value={c.id_negara}>{c.nama_negara}</option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm text-slate-300">Layanan</label>
            <Select value={layanan} onChange={setLayanan} placeholder="Pilih layanan">
              {services.map(s=> (
                <option key={s.kode} value={s.kode}>{s.layanan} — Rp{Number((Number(s.harga)||0)).toLocaleString('id-ID')}</option>
              ))}
            </Select>
            {selectedService && (
              <p className="text-xs text-slate-400 mt-1">Stok: {selectedService.stok} | Kode: {selectedService.kode}</p>
            )}
          </div>
          <div>
            <label className="text-sm text-slate-300">Operator</label>
            <Select value={operator} onChange={setOperator} placeholder="Pilih operator">
              <option value="any">Any</option>
              <option value="telkomsel">Telkomsel</option>
              <option value="indosat">Indosat</option>
              <option value="xl">XL</option>
              <option value="axis">Axis</option>
              <option value="tri">Tri</option>
              <option value="smartfren">Smartfren</option>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={handleQuote} disabled={!negara||!layanan||loadingQuote}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40">Lihat Harga</button>
          {quote && (
            <div className="text-sm text-slate-300 flex items-center gap-3">
              <Badge tone={quote.needTopup? 'pending':'success'}>
                {quote.needTopup? 'Saldo kurang':'Saldo cukup'}
              </Badge>
              <span>Harga: <b>Rp{Number(quote.price).toLocaleString('id-ID')}</b></span>
              <span>Saldo: Rp{Number(quote.saldo).toLocaleString('id-ID')}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Checkout" right={<Badge tone="info">Step 2</Badge>}>
        <button onClick={handleBuy} disabled={!quote || busy}
          className="px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40">
          {busy ? 'Memproses…' : 'Beli Sekarang'}
        </button>
        <p className="text-xs text-slate-400 mt-2">Saat saldo kurang, QRIS akan muncul otomatis. Setelah bayar, OTP akan dikirim otomatis dan status berubah real‑time.</p>
      </Section>

      <Section title="Riwayat Pesanan" right={<Badge tone="info">Step 3</Badge>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-300">
              <tr className="text-left">
                <th className="py-2">Waktu</th>
                <th>Order ID</th>
                <th>Negara</th>
                <th>Layanan</th>
                <th>Nomor</th>
                <th>Harga</th>
                <th>Status</th>
                <th>OTP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o=> (
                <tr key={o.orderId} className="border-t border-slate-800">
                  <td className="py-2">{dayjs(o.createdAt).fromNow()}</td>
                  <td className="font-mono">{o.orderId}</td>
                  <td>{o.negara}</td>
                  <td className="truncate max-w-[220px]" title={o.layanan}>{o.layanan}</td>
                  <td className="font-mono">{o.nomor || '-'}</td>
                  <td>Rp{Number(o.price).toLocaleString('id-ID')}</td>
                  <td>
                    {o.status==='pending' && <Badge tone="pending">pending</Badge>}
                    {o.status==='success' && <Badge tone="success">success</Badge>}
                    {o.status==='failed' && <Badge tone="failed">failed</Badge>}
                  </td>
                  <td className="font-bold text-lg">{o.otp || '-'}</td>
                  <td className="text-right">
                    {o.status==='pending' && (
                      <button onClick={async ()=>{ try{ await api.post(`/api/order/${o.orderId}/cancel`); await refreshOrders(); }catch(e){ alert(e.response?.data?.message||e.message); } }}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500">Batalkan</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <QRModal open={qrOpen} onClose={()=>setQrOpen(false)} {...(qrData||{})} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
