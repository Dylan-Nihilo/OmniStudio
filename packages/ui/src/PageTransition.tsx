"use client";

import type { ReactNode } from 'react';

/** The route owns its state; this boundary only animates the incoming content. */
export function PageTransition({ transitionKey, children }: { transitionKey: string; children: ReactNode }) {
  return <div key={transitionKey} data-page-transition={transitionKey} className="omni-page-transition">{children}</div>;
}
