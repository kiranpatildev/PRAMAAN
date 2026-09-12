"use client";

import React, { forwardRef } from "react";
import { Search } from "lucide-react";

export function Input({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 w-full rounded border border-line-2 bg-panel-2 px-[11px] text-[12.5px] text-fg placeholder:text-fg-4 focus:border-cyan focus:bg-panel-3 focus:outline-none ${className}`}
      style={{ boxShadow: "none" }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,217,255,.08)";
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "none";
        rest.onBlur?.(e);
      }}
      {...rest}
    />
  );
}

export const SearchInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className = "", ...rest }, ref) {
    return (
      <span className={`relative inline-flex w-full items-center ${className}`}>
        <Search size={13} strokeWidth={1.6} className="pointer-events-none absolute left-[11px] text-fg-4" aria-hidden />
        <input
          ref={ref}
          className="h-8 w-full rounded border border-line-2 bg-panel-2 pl-[33px] pr-[11px] text-[12.5px] text-fg placeholder:text-fg-4 focus:border-cyan focus:bg-panel-3 focus:outline-none"
          style={{ boxShadow: "none" }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,217,255,.08)";
            rest.onFocus?.(e as React.FocusEvent<HTMLInputElement>);
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
            rest.onBlur?.(e as React.FocusEvent<HTMLInputElement>);
          }}
          {...rest}
        />
      </span>
    );
  }
);

export function Select({ className = "", children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-8 rounded border border-line-2 bg-panel-2 px-2 text-[12.5px] text-fg focus:border-cyan focus:outline-none ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
