// SSLCommerz: bKash, Nagad, Rocket, cards and internet banking in BDT.
// Docs: https://developer.sslcommerz.com/doc/v4/
const base = (env) => (String(env.SSLCZ_SANDBOX ?? 'true') !== 'false' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com');
export const paymentsLive = (env) => Boolean(env.SSLCZ_STORE_ID && env.SSLCZ_STORE_PASSWORD);

export async function startPayment(env, origin, order, amount) {
  const c = order.customer;
  const tranId = order.id + '-' + Date.now().toString(36);
  const form = new URLSearchParams({
    store_id: env.SSLCZ_STORE_ID, store_passwd: env.SSLCZ_STORE_PASSWORD, total_amount: String(amount), currency: 'BDT', tran_id: tranId,
    success_url: `${origin}/pay/success`, fail_url: `${origin}/pay/fail`, cancel_url: `${origin}/pay/cancel`, ipn_url: `${origin}/pay/ipn`,
    cus_name: c.name, cus_email: c.email || 'customer@woowglobal.com', cus_add1: c.address, cus_city: c.city || 'Dhaka', cus_postcode: '1000',
    cus_country: 'Bangladesh', cus_phone: c.phone, shipping_method: 'NO', product_name: `WOOW Buy For Me ${order.id}`,
    product_category: 'Buy For Me', product_profile: 'general', value_a: order.id,
  });
  const res = await fetch(base(env) + '/gwprocess/v4/api.php', { method: 'POST', body: form });
  const data = await res.json();
  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) throw new Error('Payment gateway error: ' + (data.failedreason || data.status || 'unknown'));
  return { url: data.GatewayPageURL, tranId };
}

/** Always ask SSLCommerz to confirm before trusting a payment. */
export async function validatePayment(env, valId) {
  const q = new URLSearchParams({ val_id: valId, store_id: env.SSLCZ_STORE_ID, store_passwd: env.SSLCZ_STORE_PASSWORD, format: 'json' });
  const data = await (await fetch(base(env) + '/validator/api/validationserverAPI.php?' + q.toString())).json();
  return { ok: data.status === 'VALID' || data.status === 'VALIDATED', amount: Number(data.amount || 0), orderId: data.value_a, tranId: data.tran_id, method: data.card_type, currency: data.currency };
}
