'use client';

import { useState } from 'react';

/** A textarea that shows how much of its length limit is used. */
export function CountedTextarea({
  id,
  name,
  label,
  maxLength,
  minLength,
  placeholder,
  hint,
  defaultValue = '',
  rows,
}: {
  id: string;
  name: string;
  label: string;
  maxLength: number;
  minLength?: number;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  rows?: number;
}) {
  const [length, setLength] = useState(defaultValue.length);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        required
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        defaultValue={defaultValue}
        rows={rows}
        onChange={(event) => setLength(event.target.value.length)}
      />
      <span className="hint row spread">
        <span>{hint}</span>
        <span className="numeric" aria-live="off">
          {length} / {maxLength}
        </span>
      </span>
    </div>
  );
}
