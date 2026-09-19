import { describe, it, expect } from 'vitest';
import { canvasToBlob, copySnapshot, SNAPSHOT_COPY_MESSAGE, type CanvasLike, type ClipboardLike } from './clipboard';

const png = new Blob(['fake-png-bytes'], { type: 'image/png' });
const canvasOk: CanvasLike = { toBlob: (cb) => cb(png) };
const canvasEmpty: CanvasLike = { toBlob: (cb) => cb(null) };
const canvasThrows: CanvasLike = { toBlob: () => { throw new Error('canvas detached'); } };

class FakeClipboardItem {
  constructor(public items: Record<string, unknown>) {}
}
const okWrite = { written: [] as unknown[] };
const writeClipboard: ClipboardLike = {
  write: async (items) => { okWrite.written.push(...items); },
  writeText: async () => {},
};
const throwingWrite: ClipboardLike = { write: async () => { throw new Error('NotAllowedError'); }, writeText: async () => {} };
const throwingText: ClipboardLike = { writeText: async () => { throw new Error('NotAllowedError'); } };

describe('copySnapshot', () => {
  it('prefers the real image when the clipboard can take one', async () => {
    okWrite.written.length = 0;
    const outcome = await copySnapshot({
      canvas: canvasOk, dataUrl: 'data:image/png;base64,AAA',
      clipboard: writeClipboard, ClipboardItem: FakeClipboardItem as never,
    });
    expect(outcome).toBe('image');
    expect(okWrite.written).toHaveLength(1);
    expect((okWrite.written[0] as FakeClipboardItem).items['image/png']).toBe(png);
  });

  it('degrades to the data URL as text when image writing is refused', async () => {
    expect(await copySnapshot({ canvas: canvasOk, dataUrl: 'data:AAA', clipboard: throwingWrite, ClipboardItem: FakeClipboardItem as never }))
      .toBe('text');
  });

  it('degrades to text when ClipboardItem is unavailable (older WebKit)', async () => {
    expect(await copySnapshot({ canvas: canvasOk, dataUrl: 'data:AAA', clipboard: writeClipboard })).toBe('text');
  });

  it('degrades to text when the canvas yields no blob, and never hangs on a throwing canvas', async () => {
    expect(await copySnapshot({ canvas: canvasEmpty, dataUrl: 'data:AAA', clipboard: writeClipboard, ClipboardItem: FakeClipboardItem as never })).toBe('text');
    expect(await copySnapshot({ canvas: canvasThrows, dataUrl: 'data:AAA', clipboard: writeClipboard, ClipboardItem: FakeClipboardItem as never })).toBe('text');
  });

  it('reports denial when even writeText refuses, instead of swallowing it', async () => {
    expect(await copySnapshot({ canvas: canvasOk, dataUrl: 'data:AAA', clipboard: throwingText, ClipboardItem: FakeClipboardItem as never })).toBe('denied');
  });

  it('says "unsupported" when there is no clipboard at all', async () => {
    expect(await copySnapshot({ canvas: canvasOk, dataUrl: 'data:AAA' })).toBe('unsupported');
    expect(await copySnapshot({ canvas: canvasOk, dataUrl: 'data:AAA', clipboard: {} })).toBe('unsupported');
  });
});

describe('canvasToBlob', () => {
  it('resolves null rather than rejecting when the canvas is unusable', async () => {
    expect(await canvasToBlob(canvasThrows)).toBeNull();
    expect(await canvasToBlob(canvasEmpty)).toBeNull();
    expect(await canvasToBlob(canvasOk)).toBe(png);
  });
});

describe('SNAPSHOT_COPY_MESSAGE', () => {
  it('has a distinct, non-empty line for every outcome (the UI shows these verbatim)', () => {
    const values = Object.values(SNAPSHOT_COPY_MESSAGE);
    expect(values).toHaveLength(4);
    values.forEach((v) => expect(v.trim().length).toBeGreaterThan(10));
    expect(new Set(values).size).toBe(4);
    // The "no clipboard" case must not imply the snapshot was lost: the AI attachment still happens.
    expect(SNAPSHOT_COPY_MESSAGE.unsupported).toMatch(/AI assistant/);
    expect(SNAPSHOT_COPY_MESSAGE.denied).toMatch(/secure context|gesture/);
  });
});
