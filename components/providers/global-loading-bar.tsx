"use client";

import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";

/**
 * Slim, non-blocking progress bar pinned to the top of the viewport, shown
 * whenever any React Query request (query or mutation) is in flight. Login/logout
 * are wrapped in mutations too, so they surface this same bar. A short show-delay
 * avoids flicker on fast/cached requests. The bar uses `pointer-events-none`, so
 * the page underneath stays fully interactive. Must render inside a
 * QueryClientProvider.
 */
export function GlobalLoadingBar() {
  const active = useIsFetching() + useIsMutating() > 0;
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Delay showing (~150ms) so fast/cached requests don't flash the bar;
    // hide promptly once requests settle.
    const timeout = setTimeout(() => setShow(active), active ? 150 : 0);
    return () => clearTimeout(timeout);
  }, [active]);

  if (!show) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-busy="true"
      className="fixed inset-x-0 top-0 z-100 h-0.5 overflow-hidden bg-primary/15 pointer-events-none"
    >
      <div className="h-full w-1/3 rounded-full bg-primary animate-[loading-bar_1.1s_ease-in-out_infinite]" />
    </div>
  );
}
