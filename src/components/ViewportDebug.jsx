import { useEffect, useState } from 'react';

/**
 * On-device viewport inspector. Only rendered when the URL contains `?debug`
 * (e.g. https://voltsense-iot.web.app/dashboard?debug) so it never affects
 * normal use.
 *
 * `env(safe-area-inset-*)` cannot be emulated in desktop DevTools, so this is
 * the only reliable way to read the real values off a physical device.
 */
const ViewportDebug = () => {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    // Geometry values are numbers in every browser we target, but a detached/synthetic element and
    // a headless environment can both hand back `undefined`. `.toFixed()` on NaN renders "NaN"
    // rather than throwing, so this is about not printing a meaningless "NaN" line — but the same
    // coercion habit is what keeps RTDB numeric strings from unmounting a page elsewhere.
    const n = (value, digits = 1) => {
      const num = Number(value);
      return Number.isFinite(num) ? num.toFixed(digits) : '?';
    };

    const read = () => {
      const root = getComputedStyle(document.documentElement);
      const v = (name) => root.getPropertyValue(name).trim() || '(unset)';

      const shell = document.querySelector('.app-shell')?.getBoundingClientRect();
      const nav = document.querySelector('[data-debug="bottom-nav"]')?.getBoundingClientRect();
      const vv = window.visualViewport;

      setLines([
        `viewport   ${window.innerWidth} x ${window.innerHeight}`,
        `screen     ${window.screen.width} x ${window.screen.height}  dpr ${window.devicePixelRatio}`,
        vv ? `visualVP   ${Math.round(vv.width)} x ${Math.round(vv.height)}  scale ${vv.scale}` : 'visualVP   n/a',
        `--safe-top ${v('--safe-top')}`,
        `--safe-bot ${v('--safe-bottom')}`,
        `--safe-l/r ${v('--safe-left')} / ${v('--safe-right')}`,
        shell ? `shell      top ${n(shell.top)} h ${n(shell.height)} bottom ${n(shell.bottom)}` : 'shell      n/a',
        nav
          ? `nav        h ${n(nav.height)} bottom ${n(nav.bottom)} gap ${n(
              window.innerHeight - nav.bottom
            )}`
          : 'nav        n/a',
        `standalone ${window.matchMedia('(display-mode: standalone)').matches}`,
      ]);
    };

    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);

  return (
    <pre
      className="fixed left-2 right-2 top-2 z-[9999] rounded-xl bg-black/85 p-3 text-[10px] leading-[1.5] text-lime-300 font-mono whitespace-pre-wrap pointer-events-none"
      aria-hidden="true"
    >
      {lines.join('\n')}
    </pre>
  );
};

export default ViewportDebug;
