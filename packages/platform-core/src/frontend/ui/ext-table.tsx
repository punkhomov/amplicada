import * as React from "react"

import { cn } from "../lib/utils.js"

interface ExtTableContextValue {
  tableRef: React.RefObject<HTMLTableElement | null>;
  resizable: boolean;
}

const ExtTableContext = React.createContext<ExtTableContextValue | null>(null);

function useExtTableContext() {
  return React.useContext(ExtTableContext);
}

function computeStickyOffsets(table: HTMLTableElement) {
  const thead = table.querySelector("thead");
  if (!thead) return;

  const ths = Array.from(thead.querySelectorAll<HTMLElement>("th"));

  let leftOffset = 0;
  for (const th of ths) {
    if (th.dataset.sticky === "left") {
      th.style.left = `${leftOffset}px`;
      leftOffset += th.offsetWidth;
    }
  }

  let rightOffset = 0;
  for (const th of [...ths].reverse()) {
    if (th.dataset.sticky === "right") {
      th.style.right = `${rightOffset}px`;
      rightOffset += th.offsetWidth;
    }
  }

  for (const row of table.querySelectorAll<HTMLElement>("tbody tr")) {
    const tds = Array.from(row.querySelectorAll<HTMLElement>("td"));
    tds.forEach((td, i) => {
      const side = td.dataset.sticky;
      if (!side || !ths[i]) return;
      if (side === "left") td.style.left = ths[i].style.left;
      else td.style.right = ths[i].style.right;
    });
  }
}

interface ExtTableProps extends React.ComponentProps<"table"> {
  resizable?: boolean;
}

function ExtTable({ className, children, resizable, ...props }: ExtTableProps) {
  const tableRef = React.useRef<HTMLTableElement>(null);

  // Watch for DOM changes that affect sticky offsets (pin/unpin, show/hide columns)
  React.useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    computeStickyOffsets(table);

    const mo = new MutationObserver(() => {
      computeStickyOffsets(table);
    });
    mo.observe(table, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sticky'],
      childList: true,
    });

    return () => mo.disconnect();
  }, []);

  // Watch for resize changes (column resizing in resizable mode)
  React.useLayoutEffect(() => {
    if (!resizable) return;
    const table = tableRef.current;
    if (!table) return;

    const ro = new ResizeObserver(() => {
      computeStickyOffsets(table);
    });
    ro.observe(table);

    return () => ro.disconnect();
  }, [resizable]);

  return (
    <ExtTableContext.Provider value={{ tableRef, resizable: !!resizable }}>
      <div
        data-slot="ext-table-container"
        className="relative w-full h-full overflow-auto"
      >
        <table
          ref={tableRef}
          data-slot="ext-table"
          className={cn(
            "caption-bottom text-sm shadow-[0_1px_0_0_var(--border)] shadow-[0_0_0_1px_var(--border)]",
            !resizable && "w-full",
            resizable && "table-fixed",
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </div>
    </ExtTableContext.Provider>
  );
}

interface ExtTableHeaderProps extends React.ComponentProps<"thead"> {
  sticky?: boolean;
}

function ExtTableHeader({ className, sticky, ...props }: ExtTableHeaderProps) {
  return (
    <thead
      data-slot="ext-table-header"
      className={cn(
        "[&_tr]:border-b",
        sticky && "sticky top-0 z-[30] bg-background after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border",
        className
      )}
      {...props}
    />
  )
}

function ExtTableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="ext-table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function ExtTableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="ext-table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function ExtTableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="ext-table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted group",
        className
      )}
      {...props}
    />
  )
}

interface ExtTableHeadProps extends React.ComponentProps<"th"> {
  sticky?: "left" | "right";
}

function ExtTableHead({ className, sticky, children, ...props }: ExtTableHeadProps) {
  return (
    <th
      data-slot="ext-table-head"
      data-sticky={sticky}
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap overflow-hidden text-ellipsis text-foreground transition-colors",
        sticky === "left" && "sticky left-0 bg-background group-hover:bg-[color-mix(in_srgb,var(--muted)_50%,var(--background))] group-data-[state=selected]:bg-muted z-[10]",
        sticky === "right" && "sticky right-0 bg-background group-hover:bg-[color-mix(in_srgb,var(--muted)_50%,var(--background))] group-data-[state=selected]:bg-muted z-[20]",
        sticky === undefined && "relative",
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
}

interface ExtTableCellProps extends React.ComponentProps<"td"> {
  sticky?: "left" | "right";
}

function ExtTableCell({ className, sticky, ...props }: ExtTableCellProps) {
  return (
    <td
      data-slot="ext-table-cell"
      data-sticky={sticky}
      className={cn(
        "p-2 align-middle whitespace-nowrap overflow-hidden text-ellipsis transition-colors",
        sticky === "left" && "sticky left-0 bg-background group-hover:bg-[color-mix(in_srgb,var(--muted)_50%,var(--background))] group-data-[state=selected]:bg-muted z-[10]",
        sticky === "right" && "sticky right-0 bg-background group-hover:bg-[color-mix(in_srgb,var(--muted)_50%,var(--background))] group-data-[state=selected]:bg-muted z-[20]",
        className
      )}
      {...props}
    />
  )
}

export {
  ExtTable,
  ExtTableHeader,
  ExtTableBody,
  ExtTableFooter,
  ExtTableRow,
  ExtTableHead,
  ExtTableCell,
  useExtTableContext,
}
