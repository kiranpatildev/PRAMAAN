"use client";

import React from "react";

export interface Column<T> {
  key: string;
  head: string;
  width?: string;
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
}

/** Dense data table: 42px rows, 12px 14px cells, hover actions. */
export function Table<T extends { id: string | number }>({
  columns,
  rows,
  onRowClick,
  selectedId,
  actionFor,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  selectedId?: string | number | null;
  actionFor?: (row: T) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line bg-panel-2">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={`px-[14px] py-[10px] font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-fg-4 ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.head}
              </th>
            ))}
            {actionFor && <th className="w-[70px]" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`group border-b border-line text-fg-2 transition-colors duration-120 last:border-b-0 hover:bg-panel-2 ${
                onRowClick ? "cursor-pointer" : ""
              } ${selectedId != null && row.id === selectedId ? "bg-panel-2" : ""}`}
              style={
                selectedId != null && row.id === selectedId
                  ? { boxShadow: "inset 3px 0 0 #00d9ff" }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`h-[42px] px-[14px] py-3 text-[12.5px] ${
                    c.numeric ? "text-right font-mono text-[11.5px] text-fg-3" : ""
                  }`}
                >
                  {c.render(row)}
                </td>
              ))}
              {actionFor && (
                <td className="h-[42px] px-[14px] py-3 text-right">
                  <span className="opacity-0 transition-colors duration-120 group-hover:opacity-100">
                    {actionFor(row)}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty}
    </div>
  );
}

/** Six flat skeleton rows for loading lists. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row">
          <span className="skel-bar" style={{ width: "22%" }} />
          <span className="skel-bar" style={{ width: "12%" }} />
          <span className="skel-bar" style={{ width: "30%" }} />
          <span className="skel-bar ml-auto" style={{ width: "8%" }} />
        </div>
      ))}
    </div>
  );
}
