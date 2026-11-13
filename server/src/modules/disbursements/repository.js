import { query } from '../../config/db.js';

/** Application + programme + student context for installment/award operations. */
export async function appContext(applicationId) {
  const { rows } = await query(
    `SELECT a.id, a.student_id, a.status, a.program_id,
            p.title AS program_title, p.provider_id, p.amount_per_student,
            p.total_fund, p.fund_disbursed, p.location_district,
            u.name AS student_name
     FROM applications a
     JOIN programs p ON p.id = a.program_id
     JOIN users u ON u.id = a.student_id
     WHERE a.id = $1`,
    [applicationId],
  );
  return rows[0] || null;
}

export async function installmentsFor(applicationId) {
  const { rows } = await query(
    `SELECT i.*, d.id AS disbursement_id, d.method, d.ref, d.paid_at,
            d.receipt_confirmed_at, d.voided
     FROM installments i
     LEFT JOIN disbursements d ON d.installment_id = i.id AND NOT d.voided
     WHERE i.application_id = $1
     ORDER BY i.seq`,
    [applicationId],
  );
  return rows;
}

export async function insertInstallments(client, applicationId, items) {
  const out = [];
  for (const it of items) {
    const { rows } = await client.query(
      `INSERT INTO installments (application_id, seq, amount, due_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [applicationId, it.seq, it.amount, it.due_date],
    );
    out.push(rows[0]);
  }
  return out;
}

export async function installmentContext(installmentId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT i.*, a.student_id, a.program_id, a.status AS application_status,
            p.provider_id, p.title AS program_title, p.total_fund, p.fund_disbursed,
            p.location_district
     FROM installments i
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = a.program_id
     WHERE i.id = $1`,
    [installmentId],
  );
  return rows[0] || null;
}

export async function disbursementContext(disbursementId) {
  const { rows } = await query(
    `SELECT d.*, i.application_id, i.seq, i.amount AS installment_amount,
            a.student_id, a.program_id, p.provider_id, p.title AS program_title
     FROM disbursements d
     JOIN installments i ON i.id = d.installment_id
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = a.program_id
     WHERE d.id = $1`,
    [disbursementId],
  );
  return rows[0] || null;
}

/** Append one entry to the chain. Caller holds the advisory lock. */
export async function appendLedger(client, { entryType, disbursementId, payload, prevHash, hash }) {
  const { rows } = await client.query(
    `INSERT INTO ledger_entries (entry_type, disbursement_id, payload, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, hash`,
    [entryType, disbursementId, JSON.stringify(payload), prevHash, hash],
  );
  return rows[0];
}

export async function lastLedgerHash(client) {
  const { rows } = await client.query(
    `SELECT hash FROM ledger_entries ORDER BY id DESC LIMIT 1`,
  );
  return rows[0]?.hash ?? null;
}

export async function allLedgerEntries() {
  const { rows } = await query(
    `SELECT id, entry_type, disbursement_id, payload, prev_hash, hash, created_at
     FROM ledger_entries ORDER BY id ASC`,
  );
  return rows;
}

/** Provider/admin ledger view with business context. */
export async function ledgerView({ program_id, page, limit }, providerId) {
  const where = ['TRUE'];
  const params = [];
  if (program_id) { params.push(program_id); where.push(`a.program_id = $${params.length}`); }
  if (providerId) { params.push(providerId); where.push(`p.provider_id = $${params.length}`); }
  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT le.id, le.entry_type, le.payload, le.prev_hash, le.hash, le.created_at,
            p.title AS program_title, u.name AS student_name,
            count(*) OVER() AS total_count
     FROM ledger_entries le
     JOIN disbursements d ON d.id = le.disbursement_id
     JOIN installments i ON i.id = d.installment_id
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = a.program_id
     JOIN users u ON u.id = a.student_id
     WHERE ${where.join(' AND ')}
     ORDER BY le.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

/** Public ledger: confirmation only, no student PII (ARCHITECTURE §8). */
export async function publicLedger({ page, limit }) {
  const params = [limit, (page - 1) * limit];
  const { rows } = await query(
    `SELECT le.id, le.entry_type,
            left(le.hash, 12) AS hash_prefix,
            (le.payload->>'amount')::numeric AS amount,
            to_char(le.created_at, 'YYYY-MM') AS month,
            p.title AS program_title, p.location_district AS district,
            count(*) OVER() AS total_count
     FROM ledger_entries le
     JOIN disbursements d ON d.id = le.disbursement_id
     JOIN installments i ON i.id = d.installment_id
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = a.program_id
     ORDER BY le.id DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Student payment history across all their applications (M5.12). */
export async function paymentsForStudent(studentId) {
  const { rows } = await query(
    `SELECT i.id AS installment_id, i.seq, i.amount, i.due_date, i.status,
            a.id AS application_id, p.title AS program_title,
            d.id AS disbursement_id, d.method, d.ref, d.paid_at, d.receipt_confirmed_at
     FROM installments i
     JOIN applications a ON a.id = i.application_id
     JOIN programs p ON p.id = a.program_id
     LEFT JOIN disbursements d ON d.installment_id = i.id AND NOT d.voided
     WHERE a.student_id = $1
     ORDER BY i.due_date, i.seq`,
    [studentId],
  );
  return rows;
}

export async function upsertAwardLetter(applicationId, code, issuedBy) {
  const { rows } = await query(
    `INSERT INTO award_letters (application_id, code, issued_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id) DO UPDATE SET application_id = EXCLUDED.application_id
     RETURNING *`,
    [applicationId, code, issuedBy],
  );
  return rows[0];
}

export async function awardByApplication(applicationId) {
  const { rows } = await query(
    `SELECT * FROM award_letters WHERE application_id = $1`, [applicationId],
  );
  return rows[0] || null;
}

export async function awardByCode(code) {
  const { rows } = await query(
    `SELECT al.code, al.issued_at, a.status AS application_status,
            p.title AS program_title, p.amount_per_student,
            u.name AS student_name, pu.name AS provider_name
     FROM award_letters al
     JOIN applications a ON a.id = al.application_id
     JOIN programs p ON p.id = a.program_id
     JOIN users u ON u.id = a.student_id
     JOIN users pu ON pu.id = p.provider_id
     WHERE al.code = $1`,
    [code],
  );
  return rows[0] || null;
}
