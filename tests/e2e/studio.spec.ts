import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, kind = 'instrument') {
  await page.goto('/studio');
  await page.waitForFunction(() => !!(window as any).__vibe);
  await page.evaluate(async (kind) => {
    // Browser-native imports exercise the real store and editors without an LLM.
    const { createProject, createTrack, createMidiClip } = await import('/src/model/project.ts');
    const { useDaw } = await import('/src/state/store.ts');
    const p = createProject('Selection check');
    const t = createTrack(p, kind as any, { preset: 'sub_bass' });
    const c = createMidiClip(p, 0, 8, 'Intro phrase');
    c.notes = [0, 1, 2, 3, 4, 5, 6, 7].map((start) => ({ id: `note${start}`, start, pitch: kind === 'drums' ? 36 : 60, duration: 0.25, velocity: 0.7 }));
    t.clips.push(c); p.tracks.push(t);
    useDaw.getState().replaceProject(p);
    useDaw.getState().setZoom(50);
    useDaw.getState().select({ trackId: t.id, clipIds: [c.id] });
    useDaw.getState().openEditor(c.id);
  }, kind);
}

test('landing opens the studio without loading its audio engine', async ({ page }, info) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Less friction.More feeling.');
  expect(requests.some((url) => /tone|firebase|studio\.tsx|genai/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/landing-${info.project.name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'Make something' }).click();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Arrangement', exact: true })).toBeVisible();
});

test('range drag from inside a clip passes exact notes to Ctrl+K', async ({ page }, info) => {
  await fixture(page);
  const lane = page.locator('.track-row > .lane').first();
  const box = (await lane.boundingBox())!;
  // Range button provides the same gesture without a modifier on touch screens.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Range', exact: true }).click();
  else await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 50, box.y + 35);
  await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 35, { steps: 8 }); await page.mouse.up();
  if (info.project.name === 'desktop') await page.keyboard.up('Shift');
  const selection = await page.evaluate(() => (window as any).__vibe.useDaw.getState().selection);
  expect(selection.range).toMatchObject({ start: 1, end: 3 });
  if (info.project.name === 'desktop') await page.keyboard.press('Control+k');
  else await page.getByRole('button', { name: /Edit selection/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit with AI' });
  await expect(dialog).toContainText('2 selected notes');
  await expect(dialog.locator('.suggestion')).toHaveCount(6);
  const before = await dialog.locator('.suggestion').allTextContents();
  await dialog.getByRole('button', { name: 'More ideas' }).click();
  expect(await dialog.locator('.suggestion').allTextContents()).not.toEqual(before);
  await page.screenshot({ path: `test-results/selection-${info.project.name}.png` });
});

test('piano roll selection stores note IDs and preserves them when opening AI', async ({ page }) => {
  await fixture(page);
  await page.locator('.roll-body').focus();
  await page.keyboard.press('Control+a');
  const selection = await page.evaluate(() => (window as any).__vibe.useDaw.getState().selection);
  expect(selection.notes?.[0].noteIds).toHaveLength(8);
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit with AI' })).toContainText('8 selected notes');
});

test('drum grid selects a phrase and offers drum-specific ideas', async ({ page }) => {
  await fixture(page, 'drums');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const a = (await page.locator('[data-lane="0"][data-step="0"]').boundingBox())!;
  const b = (await page.locator('[data-lane="0"][data-step="8"]').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit with AI' })).toContainText('3 selected notes');
});

test('new offline instruments and parametric EQ render audible finite PCM; WAV worker exports valid audio', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { createProject, createTrack, createMidiClip } = await import('/src/model/project.ts');
    const { renderProject, exportAudio } = await import('/src/engine/api.ts');
    const { defaultEffectParams } = await import('/src/model/catalog.ts');
    const presets = ['analog_brass', 'fm_bass', 'marimba', 'kalimba', 'chiptune', 'glass_pad'];
    const measurements = [];
    for (const preset of presets) {
      const p = createProject(); const t = createTrack(p, 'instrument', { preset });
      const c = createMidiClip(p, 0, 2); c.notes = [{ id: 'n', pitch: 60, start: 0, duration: 1, velocity: 0.8 }];
      t.effects = [{ id: 'fx', type: 'parametric_eq', enabled: true, params: { ...defaultEffectParams('parametric_eq'), gain2: -4, gain3: 2 } }];
      t.clips.push(c); p.tracks.push(t);
      const pcm = await renderProject(p, { endBeat: 2, tail: 0.5, sampleRate: 22050 });
      const data = pcm.channels[0];
      measurements.push({ preset, finite: data.every(Number.isFinite), peak: Math.max(...data.map(Math.abs)) });
    }
    const project = (window as any).__vibe.useDaw.getState().project;
    let frames = 0; const interval = setInterval(() => frames++, 5);
    const started = performance.now();
    const wav = await exportAudio(project, 'wav24');
    clearInterval(interval);
    const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await wav.arrayBuffer());
    return { measurements, type: wav.type, seconds: decoded.duration, frames, ms: performance.now() - started };
  });
  for (const measurement of result.measurements) {
    expect(measurement.finite, measurement.preset).toBe(true);
    expect(measurement.peak, measurement.preset).toBeGreaterThan(0.001);
  }
  expect(result.type).toBe('audio/wav'); expect(result.seconds).toBeGreaterThan(3); expect(result.frames).toBeGreaterThan(0);
  console.log('Offline instrument/export measurements', result);
});

test('live playback survives note and tempo edits', async ({ page }) => {
  await page.goto('/tests/browser/liveEdit.html');
  await page.locator('#run').click();
  await expect(page.locator('#result')).toContainText('DONE', { timeout: 60000 });
  const result = await page.locator('#result').innerText();
  expect(result).not.toMatch(/FAIL|ERROR/); expect(result).toContain('PASS audio output');
});

test('online search imports licensed audio and preserves credits in a portable project', async ({ page }) => {
  // Mock only the public service; use real decodeAudioData, IndexedDB and project packing.
  const { encodeWav } = await import('../../src/engine/wav');
  const pcm = new Float32Array(4410).map((_, i) => 0.1 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const wav = Buffer.from(encodeWav({ sampleRate: 44100, channels: [pcm] }));
  await page.route('https://commons.wikimedia.org/w/api.php?*', (route) => route.fulfill({ json: { query: { pages: { 1: {
    title: 'File:Test rain.wav', imageinfo: [{ url: 'https://upload.wikimedia.org/test-rain.wav', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test_rain.wav', mime: 'audio/wav', mediatype: 'AUDIO', size: wav.length, metadata: [{ name: 'length', value: 0.1 }], extmetadata: { Artist: { value: 'Test recordist' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }],
  } } } } }));
  await page.route('https://upload.wikimedia.org/test-rain.wav', (route) => route.fulfill({ body: wav, contentType: 'audio/wav' }));
  await fixture(page);
  if (!await page.getByRole('tab', { name: 'Online', exact: true }).isVisible()) await page.getByRole('button', { name: /Show or hide the sound browser/ }).click();
  await page.getByRole('tab', { name: 'Online', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search online sounds' }).fill('rain');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.online-sound')).toContainText('Test recordist · CC BY 4.0');
  await page.getByRole('button', { name: 'Import to library' }).click();
  await expect(page.getByRole('status').last()).toContainText('Imported Test rain');
  const packed = await page.evaluate(async () => {
    const { createAudioClip, createTrack } = await import('/src/model/project.ts');
    const { exportProjectFile, parseProjectFile } = await import('/src/state/projectFile.ts');
    const { projectCredits } = await import('/src/samples/credits.ts');
    const v = (window as any).__vibe;
    const meta = Object.values(v.library.useLibrary.getState().samples).find((s: any) => s.source === 'online') as any;
    v.useDaw.getState().update('Use downloaded sound', (p: any) => { const t = createTrack(p, 'audio'); t.clips.push(createAudioClip(p, meta.id, 0, 1)); p.tracks.push(t); });
    const p = v.useDaw.getState().project;
    const parsed = parseProjectFile(await (await exportProjectFile(p)).text());
    return { attribution: parsed.samples[0].meta.attribution, source: parsed.samples[0].meta.source, credits: projectCredits(p) };
  });
  expect(packed.source).toBe('online');
  expect(packed.attribution).toMatchObject({ author: 'Test recordist', license: 'CC BY 4.0' });
  expect(packed.credits).toContain('Test recordist');
});

test('effects can be duplicated with unique IDs and edited independently', async ({ page }) => {
  await fixture(page);
  await page.locator('.dock-head').getByRole('button', { name: /Sound & FX/ }).click();
  await page.getByRole('combobox', { name: 'Add effect', exact: true }).selectOption('parametric_eq');
  await page.getByRole('button', { name: 'Duplicate Parametric EQ', exact: true }).click();
  await expect(page.locator('.fx-card')).toHaveCount(2);
  await page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true }).fill('-6');
  await expect(page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true })).toHaveValue('-6');
  await page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true }).press('Enter');
  const effects = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].effects);
  expect(effects[0].id).not.toBe(effects[1].id);
  expect(effects[0].params.gain1).toBe(0); expect(effects[1].params.gain1).toBe(-6);
  const amount = page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true });
  await amount.fill('-12'); await expect(amount).toHaveValue('-12'); await amount.press('Escape');
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].effects[1].params.gain1)).toBe(-6);
});
