// Export options and the browser download helper. No audio imports here, so the UI
// can show the export menu without loading the engine.

export type ExportFormat = 'mp3' | 'wav16' | 'wav24';

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; ext: string; hint: string }> = [
  { id: 'mp3', label: 'MP3', ext: 'mp3', hint: '320 kbps · about 2.4 MB per minute' },
  { id: 'wav16', label: 'WAV 16-bit', ext: 'wav', hint: 'CD quality · about 10 MB per minute' },
  { id: 'wav24', label: 'WAV 24-bit', ext: 'wav', hint: 'For mixing/mastering · about 16 MB per minute' },
];

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
