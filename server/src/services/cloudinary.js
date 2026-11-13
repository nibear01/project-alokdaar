import crypto from 'crypto';

/**
 * Cloudinary wrapper (ARCHITECTURE §8: presigned uploads; secrets in env only).
 * No SDK — signatures are plain SHA-1 over sorted params, so the REST API is enough.
 * Dev fallback: when CLOUDINARY_* env keys are absent, isConfigured() is false and
 * the documents module accepts a direct file_url instead (never in production).
 */

export function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

function sign(params) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(toSign + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');
}

/**
 * Parameters for a client-side (presigned) upload straight to Cloudinary.
 * The browser POSTs the file to uploadUrl with these fields; the API secret never leaves the server.
 */
export function signUpload({ folder, publicId }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: publicId, timestamp };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
    fields: {
      ...params,
      api_key: process.env.CLOUDINARY_API_KEY,
      signature: sign(params),
    },
  };
}

/** Delivery URL for a stored asset (documents live in a non-public folder). */
export function urlFor(publicId) {
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${publicId}`;
}

/** Best-effort destroy on replace/delete; never throws (timeout 10s). */
export async function destroy(publicId) {
  if (!isConfigured() || !publicId) return { skipped: true };
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  try {
    const body = new URLSearchParams({
      ...params,
      api_key: process.env.CLOUDINARY_API_KEY,
      signature: sign(params),
    });
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
      { method: 'POST', body, signal: AbortSignal.timeout(10_000) },
    );
    return await res.json();
  } catch (err) {
    console.error('[cloudinary] destroy failed (ignored):', err.message);
    return { skipped: true, error: err.message };
  }
}
