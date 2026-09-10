import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-opacity duration-150 ease-[var(--ease-atelier)] disabled:opacity-40 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-paper hover:opacity-90",
        ghost:
          "bg-transparent text-ink border border-hairline hover:border-hairline-strong",
        night: "bg-champagne text-night hover:opacity-90",
        nightGhost:
          "bg-transparent text-champagne border border-champagne/30 hover:border-champagne/60",
        danger: "bg-transparent text-accent border border-accent/40 hover:border-accent",
      },
      size: {
        sm: "h-9 px-3 text-xs",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
