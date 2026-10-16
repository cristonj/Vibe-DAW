# Vibe DAW

The open source agentic DAW built to augment, not replace, human creativity.

Vibe is a full digital audio workstation — arrangement, piano roll, step sequencer, mixer, effects — with a producer agent built in. Type *"make a Lil Peep type beat"* and it plans the track, picks and **listens to** sounds, writes the parts, arranges and mixes them, then bounces the song and listens back to fix what it hears. Everything it does is ordinary DAW state: you can edit any of it by hand, and one undo takes back a whole agent run.

It's Cursor for music: the agent edits your session the way Cursor edits your code, with reviewable changes, checkpoints, and inline edits on a selection.

## What makes it agent-native

- **Ears, not just eyes.** Gemini is multimodal, so the agent auditions samples and critiques real offline bounces of your song (rendered by the same engine you hear), paired with measured loudness, spectrum balance, and stereo data.
- **A DAW API built for a model.** ~30 tools speak producer: step-string drum patterns with trap rolls (`x.x.3.4.`), chord symbols with strum/arpeggio/voice-leading, 1-based bars, `copy_bars`/`clear_bars` arrangement moves, sidechain ducking, sound design, resampling.
- **No generated audio.** Every sound is a real instrument, your own samples, or something synthesized from parameters. The agent composes and produces; it never prints audio from a text prompt.
- **Review like code.** Agent-made clips are drawn in lilac until you **Keep** them. Each run ends with a change summary and **Undo all**; every message has a checkpoint you can restore.
- **Ctrl+K inline edits.** Select clips, press Ctrl+K, say "add hi-hat rolls" or "make it sadder" — the agent edits just that.
- **Reference tracks.** Attach a song; the agent listens and extracts a production recipe (tempo feel, drum placement, 808 behavior, mix character) to work from.
- **Agent and Ask modes.** Ask mode is read-only: it listens and gives notes without touching the session.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: set VITE_GEMINI_API_KEY for local dev
npm run dev                  # http://localhost:5173
```

No key in the env? Open **Settings** in the app and paste a Gemini API key from [AI Studio](https://aistudio.google.com/apikey). It's stored only in your browser.

Everything works offline except AI features and the streamed multisampled instruments (piano, guitars, strings, flute…), which download on first use. Projects autosave to IndexedDB.

```bash
npm test          # unit tests (theory, editing ops, analysis, diffs)
npm run typecheck
npm run build
```

## Models

| Model | Use |
| --- | --- |
| `gemini-3.8-flash` (default) | Agent brain and ears. Fast, strong at tool use. |
| `gemini-4-argon` | Most capable; best musical judgment. Needs a billing-enabled (Blaze) project. |
| `gemini-3.5-flash-lite` | Cheapest and fastest; good for small edits. |

Pick the model and thinking level in Settings or from the composer.

## Production setup (Firebase + Netlify)

In production the browser never holds a Gemini key: chat and listening go through **Firebase AI Logic**, and **App Check** keeps other sites from spending your quota.

### 1. Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com) and add a **Web app**. Copy its config.
2. **Authentication** → enable the **Google** provider. Add your Netlify domain under *Authorized domains*.
3. **Firestore** → create a database. **Storage** → create the default bucket.
4. **AI Logic** → get started with the **Gemini Developer API**. (`gemini-4-argon` needs the Blaze plan.)
5. **App Check** → register the web app with **reCAPTCHA Enterprise**, copy the site key, and enforce App Check for AI Logic, Firestore, Storage, and Functions once it's working.
6. Deploy the security rules:

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc     # put your project id in it
firebase deploy --only firestore:rules,storage
```

### 2. Netlify

1. New site from this repo. `netlify.toml` already sets the build (`npm run build`, publish `dist`, SPA redirects, asset caching).
2. Site settings → Environment variables: add every `VITE_FIREBASE_*` value and `VITE_RECAPTCHA_SITE_KEY`.
3. **Do not set `VITE_GEMINI_API_KEY` on Netlify** — Vite inlines `VITE_*` values into the public bundle.

## Architecture

```
src/
  model/      Project document (types), music theory, catalog of instruments/effects,
              pure editing ops (slice/copy/clear ranges, step patterns, chord voicing)
  state/      Zustand stores: project + snapshot undo history, transport, settings, persistence
  engine/     Tone.js engine. EngineGraph turns a Project into a live graph and drives both
              realtime playback and offline bounces; instruments, effects, WAV encode
  samples/    Procedurally synthesized built-in kit, sample library (IndexedDB),
              DSP analysis (tempo, key, pitch, loudness, spectrum)
  agent/      Gemini client (direct key or Firebase AI Logic), agent loop, tools,
              system prompt, ears (render → Gemini), change diffs
  cloud/      Firebase: auth, Firestore project sync, Storage sample sync
  ui/         React UI: arrangement, piano roll, drum grid, audio clip editor, mixer,
              track inspector, agent panel, Ctrl+K inline edit
```

How a run works: the user's message plus a compact text snapshot of the session goes to Gemini with the tool declarations. The model calls tools (often several per turn); each tool validates input and edits the project through the same store the UI uses, inside one undo transaction. `listen` and `audition_samples` render audio offline and make a separate Gemini call that hears it, returning a critique plus measurements. When the model answers in plain text, the run ends and the change summary appears for review. Gemini 3+ thought signatures are passed back untouched.

## Keyboard

| Keys | Action |
| --- | --- |
| Space | Play / pause |
| Home | Stop and return to start |
| L | Toggle loop (Shift-drag the ruler to set it) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+K | Edit selected clips with AI |
| Ctrl+L | Focus the agent |
| Ctrl+D | Duplicate selected clips (or notes in the piano roll) |
| Delete | Delete selected clips / notes |
| Alt-drag | Copy a clip |
| Ctrl+scroll | Zoom the arrangement |

## Credits

- [Tone.js](https://tonejs.github.io) (MIT) powers the audio engine.
- Piano: [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC-BY 3.0), via tonejs.github.io.
- Guitars, bass, strings, flute, harp, organ, xylophone: [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholaus Brosowsky (CC-BY 3.0).
- All drums, 808s, effects, and textures are synthesized in the browser by Vibe — royalty-free.

MIT licensed. See [LICENSE](LICENSE).
