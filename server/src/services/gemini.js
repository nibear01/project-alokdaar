/**
 * Google Gemini wrapper (ARCHITECTURE §5.8) behind one boundary with a timeout.
 * Dev fallback (no GEMINI_API_KEY): callers build deterministic answers from the
 * retrieved context instead, so the assistant and reviewer run without a key.
 */

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

/** One-shot text generation. Throws on HTTP/parse errors — callers catch. */
export async function generate(prompt, { system } = {}) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error('Gemini returned no text');
  return text.trim();
}
