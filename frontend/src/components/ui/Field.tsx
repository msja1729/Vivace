// Labelled form inputs.

export const inputClass =
  "w-full rounded-lg border border-border-strong bg-black/25 px-3 py-2 text-sm text-text " +
  "placeholder:text-subtle outline-none transition focus:border-accent disabled:opacity-60";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function TextField({ label, hint, id, className = "", ...rest }: FieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <label htmlFor={fieldId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <input id={fieldId} className={`${inputClass} ${className}`} {...rest} />
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

interface AreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export function TextAreaField({ label, hint, id, className = "", ...rest }: AreaProps) {
  const fieldId = id ?? rest.name;
  return (
    <label htmlFor={fieldId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <textarea id={fieldId} rows={3} className={`${inputClass} leading-relaxed ${className}`} {...rest} />
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
}

export function SelectField({ label, hint, id, className = "", children, ...rest }: SelectProps) {
  const fieldId = id ?? rest.name;
  return (
    <label htmlFor={fieldId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <select id={fieldId} className={`${inputClass} ${className}`} {...rest}>
        {children}
      </select>
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  description,
  ...rest
}: { label: React.ReactNode; description?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" {...rest} />
      <span>
        {label}
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
