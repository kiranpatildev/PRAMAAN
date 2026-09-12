"use client";

import React from "react";

type Variant = "default" | "primary" | "ghost" | "danger" | "success";

const BASE =
  "inline-flex items-center justify-center gap-[7px] font-ui font-medium " +
  "border transition-colors duration-120 select-none whitespace-nowrap " +
  "disabled:opacity-50 disabled:pointer-events-none";

const BY_VARIANT: Record<Variant, string> = {
  default: "border-line-2 bg-panel-2 text-fg hover:bg-panel-3 hover:border-line-3",
  primary: "border-cyan bg-cyan text-[#04121a] font-semibold hover:bg-cyan-2",
  ghost: "border-line bg-transparent text-fg hover:bg-panel-2",
  danger: "border-red-br bg-transparent text-red hover:bg-red-bg",
  success: "border-green-br bg-transparent text-green hover:bg-green-bg",
};

export function Button({
  variant = "default",
  small = false,
  iconOnly = false,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  small?: boolean;
  iconOnly?: boolean;
}) {
  const size = iconOnly
    ? "h-7 w-7 rounded text-[12.5px]"
    : small
      ? "h-[26px] px-[9px] rounded-[3px] text-[12px]"
      : "h-[30px] px-3 rounded text-[12.5px]";
  return <button className={`${BASE} ${BY_VARIANT[variant]} ${size} ${className}`} {...rest} />;
}
