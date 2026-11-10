'use client';

import { useRef, useState } from 'react';
import { Icon } from './symbol';

const SIMULATED = [
  { value: 'PASS', label: 'Goal met' },
  { value: 'PARTIAL_50', label: 'Half done' },
  { value: 'FAIL', label: 'Not done' },
  { value: 'UNSURE', label: 'Unsure (send to review)' },
];

const MAX_EDGE = 1800;

/** Shrinks a phone photo to a size that uploads quickly and is still easy to read. Falls back to the original. */
async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return blob ? new File([blob], 'proof.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/** Posts the photo to the proof route. `simulate` adds the hand-picked verdict used when no AI key is set. */
export function ProofUploadForm({ goalId, simulate }: { goalId: string; simulate: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function onPick() {
    const element = input.current;
    const file = element?.files?.[0];
    if (!element || !file) return;
    setPreparing(true);
    const small = await shrink(file);
    if (small !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(small);
      element.files = transfer.files;
    }
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(small);
    });
    setPreparing(false);
  }

  return (
    <form
      className="stack"
      method="post"
      encType="multipart/form-data"
      action={`/api/goals/${goalId}/proof`}
      onSubmit={() => setBusy(true)}
    >
      <label className="file-drop">
        <Icon name="add_a_photo" />
        <input
          ref={input}
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={onPick}
        />
      </label>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="The photo you chose" style={{ width: '100%', borderRadius: 12 }} />
      ) : null}
      {simulate ? (
        <fieldset className="choices">
          <legend className="label muted">No AI key is set on this server. Pick the verdict to simulate:</legend>
          {SIMULATED.map((option, index) => (
            <label className="choice" key={option.value}>
              <input type="radio" name="simulatedVerdict" value={option.value} defaultChecked={index === 0} />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="body-small muted">
          You get one upload. Make sure the work and your handwritten code are both clearly readable.
        </p>
      )}
      <button
        type="submit"
        className={`button filled block${busy || preparing ? ' busy' : ''}`}
        disabled={busy || preparing}
        aria-busy={busy || preparing}
      >
        {busy || preparing ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" />}
        {busy ? 'Checking your proof…' : preparing ? 'Preparing photo…' : 'Submit proof'}
      </button>
      {busy ? (
        <div className="stack" role="status" style={{ gap: 8 }}>
          <div className="progress" />
          <p className="body-small muted">
            {simulate
              ? 'Uploading your photo and settling the result.'
              : 'Uploading your photo. The AI then checks it against the rules, which takes a few seconds.'}
          </p>
        </div>
      ) : null}
    </form>
  );
}
