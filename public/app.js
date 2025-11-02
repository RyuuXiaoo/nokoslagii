async function loadProduk(){
  const res = await fetch('/produk');
  const data = await res.json();
  const wrap = document.getElementById('produk');
  wrap.innerHTML = '';
  data.forEach(p=>{
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <h3>${p.name}</h3>
      <p>${p.desc || '-'}</p>
      <p class="small">SNK: ${p.snk || '-'}</p>
      <p><span class="price">Rp${Number(p.price).toLocaleString('id-ID')}</span> • Stok: ${p.stokTersedia}</p>
      <div>
        <input type="number" min="1" max="${p.stokTersedia}" value="1" id="qty-${p.id}" style="width:80px;padding:8px;border-radius:8px;border:1px solid #203040;background:#0b1220;color:#e6edf3" />
        <button class="btn" onclick="beli('${p.id}')">Beli</button>
      </div>
    `;
    wrap.appendChild(div);
  });
}

async function beli(idProduk){
  const qtyEl = document.getElementById('qty-'+idProduk);
  const jumlah = Number(qtyEl?.value || 1);
  const resp = await fetch('/beli',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ idProduk, jumlah })
  });
  const data = await resp.json();
  if(data.error){ alert(data.error); return; }
  const section = document.getElementById('checkout');
  const body = document.getElementById('checkout-body');
  section.classList.remove('hidden');
  body.innerHTML = `
    <div class="card">
      <h3>QRIS Pembayaran</h3>
      <div class="qr">
        <img src="${data.qr}" width="220" height="220" alt="QRIS"/>
        <div>Total Bayar: <b>Rp${data.total}</b></div>
        <div class="small">Bayar sebelum <b>${data.expiredTime} WIB</b></div>
        <button class="btn" onclick="cekStatus('${data.reff}')">Cek Status</button>
      </div>
    </div>
  `;
}

async function cekStatus(reff){
  const res = await fetch('/status/'+reff);
  const data = await res.json();
  if(data.status === 'success'){
    const akunText = data.akun.map((i)=>{
      const [email, pass, profil='-', pin='-', fa='-'] = String(i).split('|');
      return `• Email: ${email}\n  Password: ${pass}\n  Profil: ${profil}\n  Pin: ${pin}\n  2FA: ${fa}`;
    }).join('\n\n');
    alert('✅ Pembayaran berhasil!\n\n'+akunText);
    await loadProduk();
    document.getElementById('checkout').classList.add('hidden');
  }else if(data.status === 'expired'){
    alert('⏰ Waktu pembayaran habis. Silakan buat transaksi baru.');
    document.getElementById('checkout').classList.add('hidden');
  }else{
    alert('Status: '+data.status);
  }
}

loadProduk();
