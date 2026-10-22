import Link from "next/link";

type Variant = "primary" | "accent" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition whitespace-nowrap " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50";

// Pill buttons, as in the design: a purple → magenta gradient for the main action.
const variants: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-[0_10px_24px_-10px_rgb(178_76_242/0.7)] hover:brightness-110",
  accent:
    "bg-linear-to-r from-[#5b8cf7] to-[#7a5cf5] text-white shadow-[0_10px_24px_-10px_rgb(91_120_247/0.7)] hover:brightness-110",
  outline: "border border-border-strong bg-tint text-text backdrop-blur hover:bg-raised",
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
