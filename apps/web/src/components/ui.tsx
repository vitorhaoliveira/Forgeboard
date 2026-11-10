import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "soft" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-text text-bg border-text hover:opacity-90",
  secondary: "bg-panel-2 text-text border-border hover:border-border-strong",
  soft: "bg-accent/10 text-[#fdba74] border-accent/45 hover:bg-accent/15",
  ghost: "bg-transparent text-muted border-transparent hover:text-text",
  danger: "bg-transparent text-danger border-danger/40 hover:bg-danger/10",
};

export function buttonClass(variant: Variant = "secondary", className?: string) {
  return cn(
    "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    className,
  );
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function Chip({ children, className, tone }: { children: ReactNode; className?: string; tone?: "success" | "danger" | "warning" | "info" | "accent" | "violet" }) {
  const tones = {
    success: "text-success border-success/35",
    danger: "text-danger border-danger/40",
    warning: "text-warning border-warning/40",
    info: "text-info border-info/35",
    accent: "text-accent border-accent/45",
    violet: "text-violet border-violet/40",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2.5 text-xs text-muted",
        tone && tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-panel-2 px-1.5 py-px font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-medium tracking-[0.05em] text-muted", className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border bg-panel", className)}>{children}</div>;
}
