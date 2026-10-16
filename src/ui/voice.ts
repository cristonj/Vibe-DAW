import { useEffect, useRef, useState } from 'react';
import { transcribeSpeech } from '../agent/ears';
import { explainError } from '../agent/llm';
import { aiAvailable } from '../state/settings';

// Voice input for the Producer chat. Browsers with built-in speech recognition
// (Chrome, Edge, Safari) show words live as you speak; elsewhere we record and have
// Gemini transcribe when you stop. Either way the text lands in the message box to
// review before sending.

export type VoiceState = 'idle' | 'listening' | 'transcribing';

interface SpeechResultList { length: number; [i: number]: { 0: { transcript: string } } }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

const MAX_RECORD_MS = 120_000;

function speechCtor(): SpeechCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

// Some browsers expose the API but have no recognition service behind it (e.g. Brave);
// after the first such failure, record and transcribe instead.
let nativeBroken = false;

export function voiceSupported(): boolean {
  return !!speechCtor() || canRecord();
}

/**
 * `onText` receives the whole transcript of the current take (it grows while listening).
 * `cancel()` stops without delivering anything more, e.g. when the message is sent.
 */
export function useVoiceInput(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const stopRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  const finish = () => { stopRef.current = null; cancelRef.current = null; setState('idle'); };

  const record = async () => {
    const avail = aiAvailable();
    if (!avail.ok) { cb.current.onError(`Voice input in this browser uses Gemini to transcribe. ${avail.reason}`); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      cb.current.onError('Microphone access was blocked. Allow it in your browser’s site settings to talk to the Producer.');
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const ctrl = new AbortController();
    let cancelled = false;
    const release = () => stream.getTracks().forEach((t) => t.stop());
    const limit = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_RECORD_MS);
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearTimeout(limit);
      release();
      if (cancelled) return finish();
      setState('transcribing');
      try {
        const data = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
        const text = data.byteLength ? await transcribeSpeech(data, ctrl.signal) : '';
        if (!ctrl.signal.aborted) {
          if (text) cb.current.onText(text);
          else cb.current.onError('Didn’t catch any speech. Try again a little closer to the mic.');
        }
      } catch (e) {
        if (!ctrl.signal.aborted) cb.current.onError(`Couldn’t transcribe: ${explainError(e)}`);
      }
      finish();
    };
    stopRef.current = () => { if (rec.state === 'recording') rec.stop(); };
    cancelRef.current = () => { cancelled = true; ctrl.abort(); if (rec.state === 'recording') rec.stop(); else finish(); };
    rec.start();
    setState('listening');
  };

  const dictate = (Ctor: SpeechCtor) => {
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let heard = false;
    let live = true;
    rec.onresult = (e) => {
      if (!live) return;
      // Rebuild from every result each time; appending deltas duplicates words in some browsers.
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard ||= !!text.trim();
      cb.current.onText(text.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted' || e.error === 'no-speech') return;
      live = false;
      if (e.error === 'not-allowed') {
        cb.current.onError('Microphone access was blocked. Allow it in your browser’s site settings to talk to the Producer.');
      } else if (!heard && canRecord()) {
        // No recognition service available ('network', 'service-not-allowed', …): fall back.
        nativeBroken = true;
        rec.onend = null;
        finish();
        void record();
      } else {
        cb.current.onError(`Voice input stopped (${e.error}).`);
      }
    };
    rec.onend = finish;
    stopRef.current = () => rec.stop();
    cancelRef.current = () => { live = false; rec.abort(); };
    try {
      rec.start();
      setState('listening');
    } catch (e) {
      finish();
      cb.current.onError(`Couldn’t start voice input: ${(e as Error).message}`);
    }
  };

  const start = () => {
    if (state !== 'idle') return;
    const Ctor = speechCtor();
    if (Ctor && !nativeBroken) dictate(Ctor);
    else if (canRecord()) void record();
    else cb.current.onError('This browser doesn’t support voice input.');
  };

  useEffect(() => () => cancelRef.current?.(), []);

  return {
    state,
    start,
    stop: () => stopRef.current?.(),
    cancel: () => cancelRef.current?.(),
  };
}
