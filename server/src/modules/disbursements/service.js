import crypto from 'crypto';
import { getClient } from '../../config/db.js';
import { GENESIS, entryHash, verifyChain } from '../../lib/ledger.js';
import { notify } from '../../lib/notify.js';
import * as repo from './repository.js';

function err(message, code, status = 400, details) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  if (details) e.details = details;
  return e;
}

const LEDGER_LOCK = 471_0001; // advisory lock key: serialises chain appends

function assertProviderOwns(ctx, actor) {
  if (actor.role === 'admin') return;
  if (actor.role !== 'provider' || Number(ctx.provider_id) !== actor.id) {
    throw err('Not your programme', 'FORBIDDEN', 403);
  }
}

// ----------------------------------------------- installments (M5.9)

/** Create the schedule for an approved application: N monthly, or a custom list. */
export async function createSchedule(actor, applicationId, data) {
  const ctx = await repo.appContext(applicationId);
  if (!ctx) throw err('Application not found', 'NOT_FOUND', 404);
  assertProviderOwns(ctx, actor);
  if (ctx.status !== 'approved') {
    throw err('Installments can only be scheduled for approved applications', 'NOT_APPROVED', 409);
  }
  const existing = await repo.installmentsFor(applicationId);
  if (existing.length) {
    throw err('A schedule already exists for this application', 'INSTALLMENTS_EXIST', 409, {
      count: existing.length,
    });
  }

  let items;
  if (data.custom?.length) {
    items = data.custom.map((c, i) => ({ seq: i + 1, amount: c.amount, due_date: c.due_date }));
  } else {
    const amount = data.amount ?? Number(ctx.amount_per_student);
    if (!amount || amount <= 0) throw err('No amount per installment', 'AMOUNT_REQUIRED', 400);
    const start = data.start_date ? new Date(data.start_date) : new Date();
    items = Array.from({ length: data.months }, (_, i) => {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      return { seq: i + 1, amount, due_date: d.toISOString().slice(0, 10) };
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const rows = await repo.insertInstallments(client, applicationId, items);
    await notify(client, {
      userId: ctx.student_id,
      applicationId,
      kind: `installments_scheduled:${applicationId}`,
      title: `Payment schedule for ${ctx.program_title}`,
      body: `${rows.length} installments scheduled, first due ${rows[0].due_date instanceof Date ? rows[0].due_date.toISOString().slice(0, 10) : rows[0].due_date}.`,
    });
    await client.query('COMMIT');
    return { installments: rows };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function schedule(actor, applicationId) {
  const ctx = await repo.appContext(applicationId);
  if (!ctx) throw err('Application not found', 'NOT_FOUND', 404);
  if (actor.role === 'student' && Number(ctx.student_id) !== actor.id) {
    throw err('Not your application', 'FORBIDDEN', 403);
  }
  if (actor.role === 'provider') assertProviderOwns(ctx, actor);
  const installments = await repo.installmentsFor(applicationId);
  const paid = installments.filter((i) => i.status === 'paid');
  return {
    installments,
    totals: {
      scheduled: installments.length,
      paid: paid.length,
      amount_paid: paid.reduce((s, i) => s + Number(i.amount), 0),
      amount_total: installments.reduce((s, i) => s + Number(i.amount), 0),
    },
  };
}

// ----------------------------------------------- disburse + ledger (M5.9/M5.10)

/**
 * Record a payment: disbursement row + chained ledger entry + fund decrement,
 * one transaction under an advisory lock so the chain never forks.
 */
export async function disburse(actor, installmentId, data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK]);

    const inst = await repo.installmentContext(installmentId, client);
    if (!inst) throw err('Installment not found', 'NOT_FOUND', 404);
    assertProviderOwns(inst, actor);
    if (inst.status === 'paid') throw err('Installment is already paid', 'ALREADY_PAID', 409);
    if (inst.status === 'void') throw err('Installment is void', 'INVALID_STATUS', 409);

    const amount = data.amount ?? Number(inst.amount);
    const total = Number(inst.total_fund);
    if (total > 0 && Number(inst.fund_disbursed) + amount > total) {
      throw err('Programme fund exhausted', 'FUND_EXHAUSTED', 409, {
        remaining: total - Number(inst.fund_disbursed),
      });
    }

    const paidAt = new Date().toISOString();
    const { rows: dRows } = await client.query(
      `INSERT INTO disbursements (installment_id, amount, method, ref, note, paid_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [installmentId, amount, data.method, data.ref, data.note ?? null, paidAt, actor.id],
    );
    const disb = dRows[0];

    const payload = {
      entry_type: 'disbursement',
      disbursement_id: Number(disb.id),
      installment_id: Number(installmentId),
      application_id: Number(inst.application_id),
      program_id: Number(inst.program_id),
      amount,
      method: data.method,
      ref: data.ref,
      paid_at: paidAt,
      reason: null,
    };
    const prevHash = (await repo.lastLedgerHash(client)) ?? GENESIS;
    const hash = entryHash(prevHash, payload);
    const entry = await repo.appendLedger(client, {
      entryType: 'disbursement', disbursementId: disb.id, payload, prevHash, hash,
    });

    await client.query(
      `UPDATE installments SET status = 'paid', updated_at = now() WHERE id = $1`,
      [installmentId],
    );
    await client.query(
      `UPDATE programs SET fund_disbursed = fund_disbursed + $2, updated_at = now() WHERE id = $1`,
      [inst.program_id, amount],
    );
    await notify(client, {
      userId: inst.student_id,
      applicationId: inst.application_id,
      kind: `disbursement_paid:${disb.id}`,
      title: `৳${amount} sent — ${inst.program_title}`,
      body: `Installment ${inst.seq} was paid by ${data.method} (ref ${data.ref}). Please confirm you received it.`,
    });
    await client.query('COMMIT');
    return { disbursement: disb, ledger: { id: entry.id, hash: entry.hash, prev_hash: prevHash } };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Void with a reason: flags the row and APPENDS a 'void' entry — never deletes. */
export async function voidDisbursement(actor, disbursementId, { reason }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LEDGER_LOCK]);

    const d = await repo.disbursementContext(disbursementId);
    if (!d) throw err('Disbursement not found', 'NOT_FOUND', 404);
    assertProviderOwns(d, actor);
    if (d.voided) throw err('Already voided', 'ALREADY_VOIDED', 409);

    await client.query(
      `UPDATE disbursements SET voided = TRUE, void_reason = $2, voided_by = $3, voided_at = now()
       WHERE id = $1`,
      [disbursementId, reason, actor.id],
    );
    await client.query(
      `UPDATE installments SET status = 'scheduled', updated_at = now() WHERE id = $1`,
      [d.installment_id],
    );
    await client.query(
      `UPDATE programs SET fund_disbursed = fund_disbursed - $2, updated_at = now() WHERE id = $1`,
      [d.program_id, d.amount],
    );

    const payload = {
      entry_type: 'void',
      disbursement_id: Number(disbursementId),
      installment_id: Number(d.installment_id),
      application_id: Number(d.application_id),
      program_id: Number(d.program_id),
      amount: Number(d.amount),
      method: d.method,
      ref: d.ref,
      paid_at: new Date(d.paid_at).toISOString(),
      reason,
    };
    const prevHash = (await repo.lastLedgerHash(client)) ?? GENESIS;
    const hash = entryHash(prevHash, payload);
    const entry = await repo.appendLedger(client, {
      entryType: 'void', disbursementId, payload, prevHash, hash,
    });

    await notify(client, {
      userId: d.student_id,
      applicationId: d.application_id,
      kind: `disbursement_voided:${disbursementId}`,
      title: `A payment record was voided — ${d.program_title}`,
      body: `Installment ${d.seq} (৳${d.amount}, ref ${d.ref}) was voided: ${reason}. It is back on the schedule.`,
    });
    await client.query('COMMIT');
    return { voided: true, ledger: { id: entry.id, hash: entry.hash } };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ----------------------------------------------- ledger views + verify (M5.10)

export async function ledger(actor, filters) {
  const providerId = actor.role === 'provider' ? actor.id : null;
  const rows = await repo.ledgerView(filters, providerId);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { items: rows.map(({ total_count, ...r }) => r), page: filters.page, limit: filters.limit, total };
}

export async function publicLedger(filters) {
  const rows = await repo.publicLedger(filters);
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { items: rows.map(({ total_count, ...r }) => r), page: filters.page, limit: filters.limit, total };
}

/** Walk the whole chain and recompute every hash (FR-M3-01 "verify integrity"). */
export async function verify() {
  const entries = await repo.allLedgerEntries();
  return verifyChain(entries);
}

// ----------------------------------------------- student side (M5.12)

export async function confirmReceipt(actor, disbursementId) {
  const d = await repo.disbursementContext(disbursementId);
  if (!d) throw err('Disbursement not found', 'NOT_FOUND', 404);
  if (Number(d.student_id) !== actor.id) throw err('Not your payment', 'FORBIDDEN', 403);
  if (d.voided) throw err('This payment was voided', 'INVALID_STATUS', 409);
  const client = await getClient();
  try {
    await client.query(
      `UPDATE disbursements SET receipt_confirmed_at = COALESCE(receipt_confirmed_at, now())
       WHERE id = $1`,
      [disbursementId],
    );
  } finally {
    client.release();
  }
  return { confirmed: true, id: disbursementId };
}

export async function myPayments(actor) {
  const rows = await repo.paymentsForStudent(actor.id);
  return {
    items: rows,
    totals: {
      received: rows.filter((r) => r.status === 'paid')
        .reduce((s, r) => s + Number(r.amount), 0),
      upcoming: rows.filter((r) => r.status === 'scheduled').length,
    },
  };
}

// ----------------------------------------------- award letters (M5.11)

export async function issueAward(actor, applicationId) {
  const ctx = await repo.appContext(applicationId);
  if (!ctx) throw err('Application not found', 'NOT_FOUND', 404);
  assertProviderOwns(ctx, actor);
  if (ctx.status !== 'approved') throw err('Award letters are for approved applications', 'NOT_APPROVED', 409);
  const existing = await repo.awardByApplication(applicationId);
  if (existing) return { award: existing, created: false };
  const code = crypto.randomBytes(10).toString('hex');
  const award = await repo.upsertAwardLetter(applicationId, code, actor.id);
  return { award, created: true };
}

export function verifyUrl(code) {
  const base = process.env.PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}/api/verify/award/${code}`;
}

/** Printable HTML award letter with an embedded QR (browser print → PDF). */
export async function awardLetter(actor, applicationId, format) {
  const ctx = await repo.appContext(applicationId);
  if (!ctx) throw err('Application not found', 'NOT_FOUND', 404);
  if (actor.role === 'student' && Number(ctx.student_id) !== actor.id) {
    throw err('Not your application', 'FORBIDDEN', 403);
  }
  if (actor.role === 'provider') assertProviderOwns(ctx, actor);
  const award = await repo.awardByApplication(applicationId);
  if (!award) throw err('No award letter issued yet', 'NOT_FOUND', 404);

  const url = verifyUrl(award.code);
  if (format !== 'html') {
    return { award: { ...award, verify_url: url }, program_title: ctx.program_title, student_name: ctx.student_name };
  }

  const { default: QRCode } = await import('qrcode');
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 180 });
  const issued = new Date(award.issued_at).toDateString();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Award Letter</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#1E2A14}
.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1E2A14;padding-bottom:16px}
.badge{background:#F2B705;border-radius:10px;padding:6px 14px;font-weight:bold}
h1{font-size:26px}.muted{color:#55604B;font-size:14px}.qr{text-align:center}
.foot{margin-top:40px;border-top:1px solid #ccc;padding-top:12px;font-size:12px;color:#55604B}
@media print {.noprint{display:none}}</style></head><body>
<div class="head"><div><h1>Alokdaar — Award Letter</h1>
<div class="muted">Education Aid Disbursement System</div></div><div class="badge">AWARDED</div></div>
<p>This certifies that</p><h2>${ctx.student_name}</h2>
<p>has been awarded a place in</p><h3>${ctx.program_title}</h3>
<p>with a stipend of <b>৳${Number(ctx.amount_per_student).toLocaleString('en-US')}</b> per installment,
recorded on Alokdaar's tamper-evident disbursement ledger.</p>
<div class="qr"><img src="${qr}" alt="QR"><div class="muted">Scan to verify authenticity<br>${url}</div></div>
<div class="foot">Issued ${issued} · Code ${award.code} · This letter is valid only while the QR
verification page confirms it. Alokdaar never asks for fees to issue or verify an award.</div>
<button class="noprint" onclick="print()">Print / Save as PDF</button>
</body></html>`;
  return { html };
}

/** Public authenticity page data — initials only, never full PII (ARCH §8). */
export async function verifyAward(code) {
  const row = await repo.awardByCode(code);
  if (!row) return { valid: false };
  const initials = row.student_name.split(/\s+/).map((w) => w[0]?.toUpperCase()).join('. ') + '.';
  return {
    valid: row.application_status === 'approved',
    program_title: row.program_title,
    provider_name: row.provider_name,
    amount_per_student: row.amount_per_student,
    student: initials,
    issued_at: row.issued_at,
    application_status: row.application_status,
  };
}
