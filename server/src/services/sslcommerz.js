/**
 * SSLCommerz wrapper (ARCHITECTURE §5.3): session create + IPN validation behind
 * one boundary with timeouts. Dev fallback: when store credentials are absent,
 * isConfigured() is false and the donations module exposes a dev-confirm path
 * instead of redirecting to the gateway (never in production).
 */

export function isConfigured() {
  return Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD);
}

function baseUrl() {
  return process.env.SSLCOMMERZ_SANDBOX === 'false'
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';
}

/** Create a hosted-checkout session → { gatewayUrl }. Throws on gateway failure. */
export async function createSession({ tranId, total, donorName, donorEmail, donorPhone, purpose }) {
  const app = process.env.APP_URL || 'http://localhost:4000';
  const body = new URLSearchParams({
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: String(total),
    currency: 'BDT',
    tran_id: tranId,
    success_url: process.env.SSLCOMMERZ_SUCCESS_URL || `${app}/donate/result?state=success`,
    fail_url: process.env.SSLCOMMERZ_FAIL_URL || `${app}/donate/result?state=failed`,
    cancel_url: process.env.SSLCOMMERZ_CANCEL_URL || `${app}/donate/result?state=cancelled`,
    ipn_url: `${app}/api/donations/ipn`,
    product_name: purpose,
    product_category: 'donation',
    product_profile: 'non-physical-goods',
    cus_name: donorName || 'Alokdaar donor',
    cus_email: donorEmail || 'donor@alokdaar.local',
    cus_phone: donorPhone || '01700000000',
    cus_add1: 'Bangladesh',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    shipping_method: 'NO',
    num_of_item: '1',
  });
  const res = await fetch(`${baseUrl()}/gwprocess/v4/api.php`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SSLCommerz HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'SUCCESS' || !json.GatewayPageURL) {
    throw new Error(json.failedreason || 'SSLCommerz session failed');
  }
  return { gatewayUrl: json.GatewayPageURL, raw: json };
}

/**
 * Server-to-server IPN validation (never trust the POST body alone — RULES §3).
 * @returns validator JSON: { status: 'VALID'|'VALIDATED'|..., tran_id, amount, ... }
 */
export async function validateIpn(valId) {
  const url = new URL(`${baseUrl()}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', process.env.SSLCOMMERZ_STORE_ID);
  url.searchParams.set('store_passwd', process.env.SSLCOMMERZ_STORE_PASSWORD);
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SSLCommerz validator HTTP ${res.status}`);
  return res.json();
}
