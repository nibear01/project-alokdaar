import { query } from '../../config/db.js';

/** Public campaign cards: open programs + funding progress (FR-DN-01). */
export async function listCampaigns({ closing_soon, page, limit }) {
  const where = [`p.status = 'open'`];
  if (closing_soon === 'true') {
    where.push(`p.deadline IS NOT NULL AND p.deadline < now() + interval '14 days'`);
  }
  const params = [limit, (page - 1) * limit];
  const { rows } = await query(
    `SELECT p.id, p.title, p.description, p.location_district, p.deadline,
            p.total_fund, p.fund_raised, p.amount_per_student, p.seats, p.seats_available,
            u.name AS provider_name,
            (SELECT count(DISTINCT COALESCE(d.donor_id, d.id)) FROM donations d
              WHERE d.program_id = p.id AND d.status = 'confirmed') AS donor_count,
            count(*) OVER() AS total_count
     FROM programs p
     JOIN users u ON u.id = p.provider_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.deadline ASC NULLS LAST, p.id
     LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

export async function campaignDetail(programId) {
  const { rows } = await query(
    `SELECT p.id, p.title, p.description, p.location_district, p.deadline, p.status,
            p.total_fund, p.fund_raised, p.amount_per_student, p.seats, p.seats_available,
            u.name AS provider_name
     FROM programs p JOIN users u ON u.id = p.provider_id
     WHERE p.id = $1`,
    [programId],
  );
  return rows[0] || null;
}

/** Recent donations for a campaign page — anonymised (FR-DN-02, PII rule §8). */
export async function recentDonations(programId, limit = 8) {
  const { rows } = await query(
    `SELECT d.amount, d.recurring, d.confirmed_at,
            CASE WHEN d.anonymous OR d.donor_id IS NULL THEN NULL
                 ELSE (SELECT split_part(u.name, ' ', 1) || ' ' ||
                              left(split_part(u.name, ' ', array_length(string_to_array(u.name, ' '), 1)), 1) || '.'
                       FROM users u WHERE u.id = d.donor_id) END AS donor_label
     FROM donations d
     WHERE d.program_id = $1 AND d.status = 'confirmed'
     ORDER BY d.confirmed_at DESC
     LIMIT $2`,
    [programId, limit],
  );
  return rows;
}

export async function generalFundStats() {
  const { rows } = await query(
    `SELECT COALESCE(sum(amount), 0) AS raised,
            count(*) AS donations
     FROM donations WHERE program_id IS NULL AND status = 'confirmed'`,
  );
  return rows[0];
}

export async function insert(data) {
  const { rows } = await query(
    `INSERT INTO donations
       (donor_id, program_id, amount, tip_amount, recurring, recurring_state,
        anonymous, donor_name, donor_email, donor_phone, tran_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.donor_id, data.program_id, data.amount, data.tip_amount,
      data.recurring, data.recurring ? 'active' : null,
      data.anonymous, data.donor_name, data.donor_email, data.donor_phone, data.tran_id,
    ],
  );
  return rows[0];
}

export async function findByTranId(tranId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT * FROM donations WHERE tran_id = $1`, [tranId]);
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT d.*, r.receipt_no, r.issued_at AS receipt_issued_at, p.title AS program_title,
            (SELECT name FROM users WHERE id = d.donor_id) AS account_name
     FROM donations d
     LEFT JOIN receipts r ON r.donation_id = d.id
     LEFT JOIN programs p ON p.id = d.program_id
     WHERE d.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Confirm inside a tx: donation row (idempotent), fund increment, receipt. */
export async function confirm(client, donation, { valId, payload }) {
  const { rows } = await client.query(
    `UPDATE donations
     SET status = 'confirmed', val_id = $2, gateway_payload = $3,
         confirmed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [donation.id, valId ?? null, payload ? JSON.stringify(payload) : null],
  );
  if (!rows[0]) return null; // raced — already processed
  if (donation.program_id) {
    await client.query(
      `UPDATE programs SET fund_raised = fund_raised + $2, updated_at = now() WHERE id = $1`,
      [donation.program_id, donation.amount],
    );
  }
  const receiptNo = `RCP-${new Date().getFullYear()}-${String(donation.id).padStart(6, '0')}`;
  await client.query(
    `INSERT INTO receipts (donation_id, receipt_no) VALUES ($1, $2)
     ON CONFLICT (donation_id) DO NOTHING`,
    [donation.id, receiptNo],
  );
  return { ...rows[0], receipt_no: receiptNo };
}

export async function markFailed(tranId, payload) {
  const { rows } = await query(
    `UPDATE donations
     SET status = 'failed', gateway_payload = $2, updated_at = now()
     WHERE tran_id = $1 AND status = 'pending'
     RETURNING id`,
    [tranId, payload ? JSON.stringify(payload) : null],
  );
  return rows[0] || null;
}

export async function listMine(donorId, { page, limit }) {
  const { rows } = await query(
    `SELECT d.id, d.program_id, p.title AS program_title, d.amount, d.tip_amount,
            d.recurring, d.recurring_state, d.status, d.tran_id, d.confirmed_at,
            d.created_at, r.receipt_no,
            count(*) OVER() AS total_count
     FROM donations d
     LEFT JOIN programs p ON p.id = d.program_id
     LEFT JOIN receipts r ON r.donation_id = d.id
     WHERE d.donor_id = $1
     ORDER BY d.created_at DESC
     LIMIT $2 OFFSET $3`,
    [donorId, limit, (page - 1) * limit],
  );
  return rows;
}

export async function setRecurringState(donorId, id, state) {
  const { rows } = await query(
    `UPDATE donations
     SET recurring_state = $3, updated_at = now()
     WHERE id = $1 AND donor_id = $2 AND recurring = TRUE
       AND recurring_state IS DISTINCT FROM 'cancelled'
     RETURNING id, recurring_state`,
    [id, donorId, state],
  );
  return rows[0] || null;
}

/** Donor "My impact" (FR-DN-07): anonymised outcomes in programs I funded. */
export async function donorImpact(donorId) {
  const { rows } = await query(
    `WITH my_programs AS (
       SELECT DISTINCT program_id FROM donations
       WHERE donor_id = $1 AND status = 'confirmed' AND program_id IS NOT NULL
     ),
     scholars AS (
       SELECT a.student_id, a.program_id FROM applications a
       WHERE a.status = 'approved' AND a.program_id IN (SELECT program_id FROM my_programs)
     )
     SELECT
       (SELECT COALESCE(sum(amount), 0) FROM donations
         WHERE donor_id = $1 AND status = 'confirmed') AS total_given,
       (SELECT count(*) FROM scholars) AS students_supported,
       (SELECT count(DISTINCT p.location_district) FROM my_programs mp
         JOIN programs p ON p.id = mp.program_id
         WHERE p.location_district IS NOT NULL) AS districts_reached,
       (SELECT round(avg(first_cgpa)::numeric, 2) FROM (
          SELECT (SELECT ar.cgpa FROM academic_records ar
                  WHERE ar.student_id = s.student_id ORDER BY ar.term ASC LIMIT 1) AS first_cgpa
          FROM scholars s) t WHERE first_cgpa IS NOT NULL) AS avg_cgpa_first_term,
       (SELECT round(avg(last_cgpa)::numeric, 2) FROM (
          SELECT (SELECT ar.cgpa FROM academic_records ar
                  WHERE ar.student_id = s.student_id ORDER BY ar.term DESC LIMIT 1) AS last_cgpa
          FROM scholars s) t WHERE last_cgpa IS NOT NULL) AS avg_cgpa_latest_term`,
    [donorId],
  );
  return rows[0];
}

/** Provider dashboard: totals + rows for the received-donations table (FR-DN-08). */
export async function providerDonations(providerId, f) {
  const where = [`p.provider_id = $1`, `d.status = 'confirmed'`];
  const params = [providerId];
  if (f.program_id) { params.push(f.program_id); where.push(`d.program_id = $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`d.confirmed_at >= $${params.length}`); }
  if (f.to) { params.push(f.to); where.push(`d.confirmed_at <= $${params.length}`); }
  params.push(f.limit, (f.page - 1) * f.limit);

  const { rows } = await query(
    `SELECT d.id, d.confirmed_at, d.amount, d.recurring, d.tran_id,
            p.id AS program_id, p.title AS program_title,
            CASE WHEN d.anonymous THEN NULL
                 ELSE COALESCE((SELECT name FROM users WHERE id = d.donor_id), d.donor_name) END AS donor_name,
            CASE WHEN d.anonymous THEN NULL
                 ELSE COALESCE((SELECT email FROM users WHERE id = d.donor_id), d.donor_email) END AS donor_email,
            count(*) OVER() AS total_count,
            sum(d.amount) OVER() AS sum_amount,
            sum(d.amount) FILTER (WHERE d.recurring) OVER() AS sum_recurring,
            count(*) FILTER (WHERE d.recurring) OVER() AS count_recurring
     FROM donations d
     JOIN programs p ON p.id = d.program_id
     WHERE ${where.join(' AND ')}
     ORDER BY d.confirmed_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}
