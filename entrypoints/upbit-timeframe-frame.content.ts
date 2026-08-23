import {
  detectUpbitFrameTimeframeSignal,
  installUpbitFrameTimeframeSwitchHandler,
  publishUpbitFrameTimeframe,
} from '../src/sites/upbit/frame-timeframe';

export default defineContentScript({
  matches: ['https://*.upbit.com/*', 'https://*.tradingview.com/*'],
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',
  main() {
    if (window === window.top) return;
    if (/(^|\.)tradingview\.com$/i.test(location.hostname)) {
      try {
        if (!/(^|\.)upbit\.com$/i.test(new URL(document.referrer).hostname)) return;
      } catch {
        return;
      }
    }

    installUpbitFrameTimeframeSwitchHandler();

    let lastPublished: string | undefined;
    let lastPublishedAt = 0;
    let scheduled = false;
    const inspect = () => {
      scheduled = false;
      const signal = detectUpbitFrameTimeframeSignal();
      if (!signal) return;
      const now = Date.now();
      if (signal.timeframe === lastPublished && now - lastPublishedAt < 3_000) return;
      lastPublished = signal.timeframe;
      lastPublishedAt = now;
      publishUpbitFrameTimeframe(signal);
    };
    const scheduleInspect = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(inspect, 80);
    };

    inspect();
    const observer = new MutationObserver(scheduleInspect);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-selected', 'data-active', 'data-state', 'class'],
    });
    window.setInterval(inspect, 1_000);
  },
});
