/**
 * OCR wrapper (ARCHITECTURE §5.4): Google Vision DOCUMENT_TEXT_DETECTION behind a
 * service boundary with timeout. Dev fallback (no key): deterministic fields built
 * from the student's own profile so the pipeline runs end-to-end — matching values
 * unless the uploaded file name contains "mismatch", which perturbs one field per
 * kind so the H1-4 confirm flow and the admin mismatch queue can be demoed.
 */

const FIELD_LABELS = {
  birth_certificate: ['full_name', 'birth_certificate_no'],
  transcript: ['full_name', 'cgpa', 'institution'],
  income_certificate: ['full_name', 'monthly_income', 'issuing_office'],
  institution_id: ['full_name', 'institution', 'student_id_no'],
};

export function isConfigured() {
  return Boolean(process.env.GOOGLE_VISION_API_KEY);
}

/** Pull raw text via the Vision REST API (API-key auth). */
async function visionText(fileUrl) {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { source: { imageUri: fileUrl } },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
  const json = await res.json();
  const r = json.responses?.[0];
  if (r?.error) throw new Error(r.error.message || 'Vision error');
  return r?.fullTextAnnotation?.text || '';
}

/** Best-effort field extraction from raw OCR text, per document kind. */
export function parseFields(kind, text) {
  const fields = {};
  const line = (re) => text.match(re)?.[1]?.trim();

  fields.full_name =
    line(/name\s*[:\-]\s*(.+)/i) || line(/নাম\s*[:\-]\s*(.+)/);

  if (kind === 'birth_certificate') {
    fields.birth_certificate_no = line(/(?:birth\s*(?:certificate|reg(?:istration)?)\s*(?:no|number)\.?|No)\s*[:\-]?\s*([0-9]{10,20})/i);
  }
  if (kind === 'transcript') {
    const g = line(/(?:cgpa|gpa)\s*[:\-]?\s*([0-5](?:\.\d{1,2})?)/i);
    fields.cgpa = g ? Number(g) : undefined;
    fields.institution = line(/(?:college|university|institution|school)\s*[:\-]\s*(.+)/i);
  }
  if (kind === 'income_certificate') {
    const inc = line(/(?:monthly\s*income|income)\s*[:\-]?\s*(?:৳|tk\.?|bdt)?\s*([\d,]+(?:\.\d{1,2})?)/i);
    fields.monthly_income = inc ? Number(inc.replace(/,/g, '')) : undefined;
    fields.issuing_office = line(/(?:issued\s*by|office)\s*[:\-]\s*(.+)/i);
  }
  if (kind === 'institution_id') {
    fields.institution = line(/(?:college|university|institution|school)\s*[:\-]\s*(.+)/i);
    fields.student_id_no = line(/(?:id|roll)\s*(?:no|number)?\.?\s*[:\-]?\s*([A-Za-z0-9\-/]{4,30})/i);
  }

  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  return fields;
}

/** Deterministic dev extraction built from profile values (see module docblock). */
function devExtract(kind, fileName, profile) {
  const wantMismatch = /mismatch/i.test(fileName || '');
  const fields = {};
  for (const f of FIELD_LABELS[kind]) {
    if (f === 'full_name') fields.full_name = profile.name;
    if (f === 'cgpa' && profile.cgpa != null) fields.cgpa = Number(profile.cgpa);
    if (f === 'institution' && profile.institution) fields.institution = profile.institution;
    if (f === 'monthly_income' && profile.monthly_income != null) {
      fields.monthly_income = Number(profile.monthly_income);
    }
    if (f === 'birth_certificate_no') fields.birth_certificate_no = '19982693417000123';
    if (f === 'issuing_office') fields.issuing_office = 'Union Parishad Office';
    if (f === 'student_id_no') fields.student_id_no = 'ID-2026-0418';
  }
  if (wantMismatch) {
    if (fields.cgpa != null) fields.cgpa = Math.max(0, Number(fields.cgpa) - 0.5);
    else if (fields.monthly_income != null) fields.monthly_income = Number(fields.monthly_income) + 2500;
    else if (fields.full_name) fields.full_name = `${fields.full_name} Khan`;
  }
  return fields;
}

/**
 * Extract OCR fields for a document.
 * @returns {{ provider: 'google_vision'|'dev', fields: object }}
 */
export async function extract({ kind, fileUrl, fileName, profile }) {
  if (isConfigured() && fileUrl) {
    const text = await visionText(fileUrl);
    return { provider: 'google_vision', fields: parseFields(kind, text) };
  }
  return { provider: 'dev', fields: devExtract(kind, fileName, profile) };
}

/**
 * Compare OCR fields to the student's stored profile (users + latest academic/household).
 * Returns [{ field, document_value, profile_value, resolution: null }] — empty when all match.
 * Numeric tolerance: cgpa ±0.01; income exact to the taka. Names compared case/space-insensitively.
 */
export function compareToProfile(kind, fields, profile) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const expectations = {
    full_name: profile.name,
    cgpa: profile.cgpa != null ? Number(profile.cgpa) : undefined,
    institution: profile.institution,
    monthly_income: profile.monthly_income != null ? Number(profile.monthly_income) : undefined,
  };

  const mismatches = [];
  for (const [field, profileValue] of Object.entries(expectations)) {
    const docValue = fields[field];
    if (docValue === undefined || profileValue === undefined || profileValue === null) continue;
    let same;
    if (field === 'cgpa') same = Math.abs(Number(docValue) - Number(profileValue)) <= 0.01;
    else if (field === 'monthly_income') same = Math.round(Number(docValue)) === Math.round(Number(profileValue));
    else same = norm(docValue) === norm(profileValue);
    if (!same) {
      mismatches.push({ field, document_value: docValue, profile_value: profileValue, resolution: null });
    }
  }
  return mismatches;
}
