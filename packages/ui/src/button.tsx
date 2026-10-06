import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";
export type ButtonStyle = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean };

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-medium leading-none no-underline transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 disabled:active:scale-100";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border-line bg-surface text-ink hover:border-[color-mix(in_oklab,var(--ink),var(--line)_60%)]",
  ghost: "border-transparent bg-transparent text-muted hover:bg-sunk hover:text-ink",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-12 px-[22px] text-[0.98rem]",
  sm: "h-[38px] px-3.5 text-[0.9rem]",
};

/**
 * Button classes, for when the element is a link (`<a className={buttonClass()}>`).
 * One primary action per view; secondary for the alternative; ghost for low-stakes
 * controls such as "reset".
 */
export function buttonClass({ variant = "primary", size = "md", block = false }: ButtonStyle = {}): string {
  return cn(base, variants[variant], sizes[size], block && "w-full");
}

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle) {
  return <button type={type} className={cn(buttonClass({ variant, size, block }), className)} {...props} />;
}
