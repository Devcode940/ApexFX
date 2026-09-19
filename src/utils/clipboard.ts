/**
 * Clipboard policy for chart snapshots, kept DOM-free and dependency-injected so the decision logic is
 * unit-testable (the repo has no jsdom environment configured, and this is exactly the kind of code where
 * "it throws in Safari" is invisible until a user hits it).
 *
 * What it replaces: `document.execCommand('copy')` on a `<textarea>` holding the PNG *data URL*.
 * Three problems with that:
 *  1. `execCommand` is deprecated and returns a boolean nobody checked, so a failed copy was reported as
 *     a success — a button that lies about having copied something is worse than no button.
 *  2. A data URL for a 1500x900 chart is hundreds of KB of base64: pasting it into a document yields an
 *     unusable wall of text, not the picture the user just took.
 *  3. Its failure mode (insecure context, no user gesture, permission denied) was swallowed whole by an
 *     empty catch block, so the button always looked like it worked.
 *
 *     Meta note, since it bit the author of this file: an asterisk-slash pair cannot appear inside a
 *     block comment, not even in prose - it closes the comment and corrupts everything after it.
 *
 * The policy below: prefer the real image (`ClipboardItem` + `clipboard.write`); fall back to the data URL
 * as text and *say so*; and if the clipboard is missing or refuses, return an outcome the UI can display
 * instead of throwing. The snapshot keeps reaching the AI assistant through context regardless, because
 * that path never touched the clipboard.
 */

export type CopyOutcome = 'image' | 'text' | 'denied' | 'unsupported';

export interface CanvasLike {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

// Method syntax, not property syntax, on purpose: under `strict` (specifically strictFunctionTypes) a
// property typed `(items: unknown[]) => ...` is checked contravariantly and therefore rejects the DOM's
// `Clipboard`, whose `write` takes `ClipboardItems`. Methods are bivariant, so the real object assigns
// without a cast - and a cast here would hide it if the platform type ever changed.
export interface ClipboardLike {
  write?(items: unknown[]): Promise<void>;
  writeText?(text: string): Promise<void>;
}

export interface SnapshotCopyDeps {
  canvas: CanvasLike;
  /** Already produced by the caller: it is also the payload for the AI attachment path. */
  dataUrl: string;
  clipboard?: ClipboardLike;
  /** Passed in because `ClipboardItem` is absent in Node and in some browsers/contexts. */
  ClipboardItem?: { new (items: Record<string, Blob | string | Promise<Blob | string>>): unknown };
}

export function canvasToBlob(canvas: CanvasLike, type = 'image/png'): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type);
    } catch {
      resolve(null);
    }
  });
}

export const SNAPSHOT_COPY_MESSAGE: Record<CopyOutcome, string> = {
  image: 'Chart image copied to clipboard',
  text: 'Clipboard rejected the image; copied the PNG data URL as text instead',
  denied: 'Copy blocked by the browser (needs a secure context and a user gesture)',
  unsupported: 'No clipboard available; the snapshot is still attached to the AI assistant',
};

export async function copySnapshot(deps: SnapshotCopyDeps): Promise<CopyOutcome> {
  const { canvas, dataUrl, clipboard, ClipboardItem } = deps;

  if (!clipboard) return 'unsupported';

  if (typeof clipboard.write === 'function' && ClipboardItem) {
    const blob = await canvasToBlob(canvas);
    if (blob) {
      try {
        await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return 'image';
      } catch {
        /* permission denied / no gesture / unsupported type: fall through to text */
      }
    }
  }

  if (typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(dataUrl);
      return 'text';
    } catch {
      return 'denied';
    }
  }

  return 'unsupported';
}
