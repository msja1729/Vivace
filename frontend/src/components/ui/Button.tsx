import Link from "next/link";

type Variant = "primary" | "accent" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition whitespace-nowrap " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-text text-bg hover:bg-white",
  accent:
    "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-[0_8px_24px_-10px_rgb(124_140_255/0.8)] hover:brightness-110",
  outline: "border border-border-strong bg-white/[0.04] text-text backdrop-blur hover:bg-white/10",
  ghost: "text-muted hover:bg-raised hover:text-text",
  danger: "border border-danger/30 text-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}

type ButtonProps = CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = CommonProps & { href: string };

/** Renders a <Link> when given `href`, otherwise a <button>. */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps | LinkProps) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (props.href !== undefined) {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
