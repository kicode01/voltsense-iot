/**
 * Ambient declarations for browser APIs that are real at runtime but missing from the standard DOM
 * typings. Nothing here changes behaviour — it only tells the type checker these exist, so the code
 * that feature-detects them (`window.navigator.standalone === true`) type-checks honestly instead of
 * being silenced with a cast at the call site.
 */

declare global {
  interface Navigator {
    /**
     * iOS Safari only. `true` when the page is running from a Home Screen install, i.e. in
     * standalone (non-browser) display mode. Undefined everywhere else, which is why it must always
     * be compared with `=== true` rather than used as a truthy value on its own.
     */
    standalone?: boolean;
  }
}

export {};
