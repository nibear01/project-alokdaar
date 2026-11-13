import crypto from 'crypto';
import { getClient } from '../../config/db.js';
import { notify } from '../../lib/notify.js';
import * as gateway from '../../services/sslcommerz.js';
import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

function progress(p) {
  const goal = Number(p.total_fund) || 0;
  const raised = Number(p.fund_raised) || 0;
  return {
    raised,
    goal,
    pct: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null,
    days_left: p.deadline ? Math.max(0, Math.ceil((new Date(p.deadline) - Date.now()) / 864e5)) : null,
  };
}

/** Public campaigns page (FR-DN-01): cards + general fund tile. */
export async function listCampaigns(filters) {
  const rows = await repo.listCampaigns(filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...p }) => ({ ...p, progress: progress(p) })),
    general_fund: await repo.generalFundStats(),
    page: filters.page,
    limit: filters.limit,
    total,
  };
}

/** Campaign detail + recent anonymised donations (FR-DN-02). */
export async function campaignDetail(programId) {
  const p = await repo.campaignDetail(programId);
  if (!p) throw err('Campaign not found', 'NOT_FOUND', 404);
  return {
    campaign: { ...p, progress: progress(p) },
    recent_donations: await repo.recentDonations(programId),
  };
}

/**
 * Checkout (FR-DN-03): create a pending donation + SSLCommerz session.
 * Fund is NOT touched here — only the validated IPN confirms (RULES §2 Money).
 */
export async function createOrder(user, data) {
  if (!user && !(data.donor_name && data.donor_email)) {
    throw err('Guest donations need donor_name and donor_email', 'GUEST_DETAILS_REQUIRED', 400);
  }
  if (data.program_id) {
    const p = await repo.campaignDetail(data.program_id);
    if (!p) throw err('Campaign not found', 'NOT_FOUND', 404);
    if (p.status !== 'open') throw err('This campaign is not accepting donations', 'CAMPAIGN_CLOSED', 409);
  }

  const tranId = `ALOK-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const donation = await repo.insert({
    donor_id: user?.id ?? null,
    program_id: data.program_id,
    amount: data.amount,
    tip_amount: data.tip_amount,
    recurring: data.recurring,
    anonymous: data.anonymous,
    donor_name: data.donor_name ?? user?.name ?? null,
    donor_email: data.donor_email ?? null,
    donor_phone: data.donor_phone ?? null,
    tran_id: tranId,
  });

  if (!gateway.isConfigured()) {
    return {
      donation_id: donation.id,
      tran_id: tranId,
      dev: true,
      message:
        'SSLCommerz is not configured — POST /api/donations/:id/dev-confirm to simulate a validated IPN (dev only)',
    };
  }

  const session = await gateway.createSession({
    tranId,
    total: Number(data.amount) + Number(data.tip_amount),
    donorName: donation.donor_name,
    donorEmail: donation.donor_email,
    donorPhone: donation.donor_phone,
    purpose: data.program_id ? `Donation — programme #${data.program_id}` : 'Donation — general fund',
  });
  return { donation_id: donation.id, tran_id: tranId, dev: false, gateway_url: session.gatewayUrl };
}

async function confirmDonation(donation, { valId, payload }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const confirmed = await repo.confirm(client, donation, { valId, payload });
    if (!confirmed) {
      await client.query('ROLLBACK');
      return { already: true }; // idempotent retry
    }
    if (donation.donor_id) {
      await notify(client, {
        userId: donation.donor_id,
        kind: `donation_confirmed:${donation.id}`,
        title: 'Thank you — donation confirmed',
        body: `Your ৳${donation.amount} donation is confirmed. Receipt ${confirmed.receipt_no}.`,
      });
    }
    await client.query('COMMIT');
    return { confirmed: true, receipt_no: confirmed.receipt_no };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * IPN webhook (FR-DN-09): verify with the validator API before any DB write;
 * idempotent on tran_id/val_id; always answers 200 so the gateway stops retrying
 * only once we've durably recorded the outcome.
 */
export async function handleIpn(body) {
  const donation = await repo.findByTranId(body.tran_id);
  if (!donation) return { ok: false, reason: 'unknown tran_id' };
  if (donation.status === 'confirmed') return { ok: true, already: true };

  const status = (body.status || '').toUpperCase();
  if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
    await repo.markFailed(body.tran_id, body);
    return { ok: true, marked: 'failed' };
  }
  if (!body.val_id) return { ok: false, reason: 'missing val_id' };

  const v = await gateway.validateIpn(body.val_id);
  const vStatus = (v.status || '').toUpperCase();
  const expected = Number(donation.amount) + Number(donation.tip_amount);
  if (!['VALID', 'VALIDATED'].includes(vStatus)) {
    return { ok: false, reason: `validator says ${v.status}` };
  }
  if (v.tran_id !== donation.tran_id || Math.abs(Number(v.amount) - expected) > 0.01) {
    return { ok: false, reason: 'tran_id/amount mismatch' };
  }
  return confirmDonation(donation, { valId: body.val_id, payload: v });
}

/** Dev-only IPN simulator — blocked in production or when the gateway is configured. */
export async function devConfirm(id) {
  if (process.env.NODE_ENV === 'production' || gateway.isConfigured()) {
    throw err('dev-confirm is disabled', 'FORBIDDEN', 403);
  }
  const donation = await repo.findById(id);
  if (!donation) throw err('Donation not found', 'NOT_FOUND', 404);
  if (donation.status !== 'pending') throw err(`Donation is ${donation.status}`, 'INVALID_STATUS', 409);
  return confirmDonation(donation, { valId: `DEV-${id}`, payload: { dev: true } });
}

/** Verifying-screen poll (FR-DN-04). Owner or guest with the tran_id. */
export async function statusOf(user, id, tranId) {
  const d = await repo.findById(id);
  if (!d) throw err('Donation not found', 'NOT_FOUND', 404);
  const owner = user && d.donor_id && Number(d.donor_id) === user.id;
  if (!owner && d.tran_id !== tranId) throw err('Not your donation', 'FORBIDDEN', 403);
  return {
    id: d.id, status: d.status, amount: d.amount, tip_amount: d.tip_amount,
    recurring: d.recurring, recurring_state: d.recurring_state,
    program_title: d.program_title, receipt_no: d.receipt_no, confirmed_at: d.confirmed_at,
  };
}

export async function listMine(user, filters) {
  const rows = await repo.listMine(user.id, filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    items: rows.map(({ total_count, ...d }) => d),
    recurring: rows.filter((d) => d.recurring && d.recurring_state !== 'cancelled')
      .map(({ total_count, ...d }) => d),
    page: filters.page, limit: filters.limit, total,
  };
}

/** Pause / resume / cancel a monthly gift (FR-DN-06). */
export async function setRecurring(user, id, action) {
  const state = { pause: 'paused', resume: 'active', cancel: 'cancelled' }[action];
  const row = await repo.setRecurringState(user.id, id, state);
  if (!row) throw err('No active recurring donation found', 'NOT_FOUND', 404);
  return { id: row.id, recurring_state: row.recurring_state };
}

/** Printable receipt JSON — confirmed donations only (FR-DN-05). */
export async function receipt(user, id) {
  const d = await repo.findById(id);
  if (!d) throw err('Donation not found', 'NOT_FOUND', 404);
  if (user.role !== 'admin' && Number(d.donor_id) !== user.id) {
    throw err('Not your donation', 'FORBIDDEN', 403);
  }
  if (d.status !== 'confirmed') throw err('Receipts exist only for confirmed donations', 'NOT_CONFIRMED', 409);
  return {
    receipt: {
      receipt_no: d.receipt_no,
      issued_at: d.receipt_issued_at,
      donor: d.anonymous ? 'Anonymous donor' : (d.account_name || d.donor_name),
      email: d.donor_email,
      program: d.program_title || 'General fund',
      type: d.recurring ? 'Monthly recurring' : 'One-time',
      amount: d.amount,
      tip_amount: d.tip_amount,
      total: Number(d.amount) + Number(d.tip_amount),
      currency: 'BDT',
      transaction_ref: d.tran_id,
      confirmed_at: d.confirmed_at,
    },
  };
}

/** Provider "Donations received" + CSV (FR-DN-08). */
export async function providerReceived(user, filters) {
  const rows = await repo.providerDonations(user.id, filters);
  const first = rows[0];
  const summary = {
    total_raised: first ? Number(first.sum_amount) : 0,
    recurring_amount: first ? Number(first.sum_recurring || 0) : 0,
    recurring_count: first ? Number(first.count_recurring || 0) : 0,
    donations: first ? Number(first.total_count) : 0,
  };
  const items = rows.map(({ total_count, sum_amount, sum_recurring, count_recurring, ...d }) => d);
  if (filters.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'date,program,donor,email,type,amount_bdt,reference',
      ...items.map((d) =>
        [d.confirmed_at, d.program_title, d.donor_name ?? 'Anonymous', d.donor_email ?? '',
          d.recurring ? 'monthly' : 'one-time', d.amount, d.tran_id].map(esc).join(','),
      ),
    ].join('\n');
    return { csv };
  }
  return { summary, items, page: filters.page, limit: filters.limit, total: summary.donations };
}

export function donorImpact(user) {
  return repo.donorImpact(user.id);
}
