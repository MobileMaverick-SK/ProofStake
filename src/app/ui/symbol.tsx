/** A Material Symbols (Rounded) icon. Decorative by default; pass `label` when it carries meaning alone. */
export function Icon({ name, className = '', label }: { name: string; className?: string; label?: string }) {
  return (
    <span className={`icon ${className}`.trim()} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}>
      {name}
    </span>
  );
}
