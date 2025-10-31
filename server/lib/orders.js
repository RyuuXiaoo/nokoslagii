import fetch from 'node-fetch';

const orders = new Map(); // key: orderId, value: data

export function listOrders(userId) {
  return Array.from(orders.values()).filter(o => o.userId === userId)
    .sort((a,b)=> b.createdAt - a.createdAt);
}
export function getOrder(orderId) { return orders.get(orderId); }
export function setOrder(order) { orders.set(order.orderId, order); }
export function updateOrder(orderId, patch) {
  const prev = orders.get(orderId) || {}; const next = { ...prev, ...patch };
  orders.set(orderId, next); return next;
}

export async function pollOtpUntilDone({ jasaKey, orderId, onUpdate }) {
  let tries = 0; const maxTries = 36; // ~9 menit @ 15s
  while (tries < maxTries) {
    tries++;
    const url = `https://api.jasaotp.id/v1/sms.php?api_key=${jasaKey}&id=${orderId}`;
    let json;
    try {
      const res = await fetch(url); json = await res.json();
    } catch { /* ignore */ }

    const otpText = json?.data?.otp || '';
    // berhenti kalau bukan "menunggu"/"pending"
    if (json?.success && otpText && !/menunggu|pending/i.test(otpText)) {
      const angka = otpText.match(/\d{4,6}/)?.[0] || otpText;
      await onUpdate({ status: 'success', otp: angka, raw: otpText });
      return;
    }
    await new Promise(r => setTimeout(r, 15000));
  }
  await onUpdate({ status: 'failed', otp: null, raw: 'timeout' });
}
