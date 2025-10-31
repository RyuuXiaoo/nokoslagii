const wallets = new Map(); // key: userId, val: number

export function getSaldo(userId) { return wallets.get(userId) ?? 0; }
export function addSaldo(userId, nominal) {
  const cur = getSaldo(userId); wallets.set(userId, cur + Number(nominal));
  return wallets.get(userId);
}
export function minSaldo(userId, nominal) {
  const cur = getSaldo(userId); const next = cur - Number(nominal);
  if (next < 0) throw new Error('Saldo tidak cukup');
  wallets.set(userId, next); return wallets.get(userId);
}
export function ensureUser(userId) { if(!wallets.has(userId)) wallets.set(userId, 0); }
