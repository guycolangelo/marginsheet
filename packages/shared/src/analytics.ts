// Event naming convention (M0 plan Task 0.6), as code rather than prose.
//
// Doctrine: explicit named events only. No autocapture, no session
// recording, no automatic pageviews; the PostHog snippet in apps/web
// disables all three explicitly. Every event this product emits is declared
// here first; an event name not in this registry does not ship.
//
// Naming rule: snake_case, object_action order, past tense for completed
// actions ("page_viewed", "account_connected"), no PII in names or
// property keys. Properties carry ids, never raw financial figures.

export const ANALYTICS_EVENTS = {
  // M0: the placeholder page's single named event. M8 extends this
  // registry; nothing else may call capture() with an unlisted name.
  page_viewed: "page_viewed",
} as const;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
