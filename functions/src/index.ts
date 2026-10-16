import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineInt } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';

// Server-side Lyria generation for production builds. The Gemini key never reaches
// the browser; callers must be signed in, pass App Check, and stay under a daily quota.
// (Text/audio understanding goes through Firebase AI Logic directly from the client.)

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const DAILY_LIMIT = defineInt('LYRIA_DAILY_LIMIT', { default: 25 });
const LYRIA_MODEL = 'lyria-3-clip-preview';

export const generateMusic = onCall(
  {
    secrets: [GEMINI_API_KEY],
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 20,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to generate audio.');
    const prompt = String(request.data?.prompt ?? '').trim();
    if (!prompt || prompt.length > 1200) throw new HttpsError('invalid-argument', 'Prompt must be 1–1200 characters.');

    const day = new Date().toISOString().slice(0, 10);
    const usageRef = getFirestore().doc(`users/${uid}/usage/${day}`);
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const used = (snap.get('lyria') as number | undefined) ?? 0;
      if (used >= DAILY_LIMIT.value()) throw new HttpsError('resource-exhausted', `Daily generation limit reached (${DAILY_LIMIT.value()}). Try again tomorrow.`);
      tx.set(usageRef, { lyria: FieldValue.increment(1), updatedAt: Date.now() }, { merge: true });
    });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const interaction = (await ai.interactions.create({ model: LYRIA_MODEL, input: prompt } as never)) as unknown as {
      output_audio?: { data?: string; mime_type?: string };
      steps?: Array<{ content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
    };
    let audio = interaction.output_audio;
    if (!audio?.data) {
      for (const step of interaction.steps ?? []) for (const c of step.content ?? []) if (c.type === 'audio' && c.data) audio = c;
    }
    if (!audio?.data) throw new HttpsError('failed-precondition', 'Lyria returned no audio. Rephrase the prompt (no artist names or lyrics).');
    return { data: audio.data, mime: audio.mime_type ?? 'audio/mpeg' };
  },
);
