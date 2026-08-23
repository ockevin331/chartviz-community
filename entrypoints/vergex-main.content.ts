const REQUEST_EVENT = 'chartviz:vergex:set-timeframe';
const RESPONSE_EVENT = 'chartviz:vergex:set-timeframe:result';

type ReactFiber = {
  return?: ReactFiber | null;
  memoizedProps?: ChartProps | null;
  pendingProps?: ChartProps | null;
};

type ChartProps = {
  interval?: string;
  symbol?: string;
  showToolbars?: boolean;
  onIntervalChange?: (interval: string) => void;
};

const TIMEFRAME_ATTRIBUTE = 'data-chartviz-vergex-timeframe';
const VALID_INTERVAL = /^(?:1|3|5|15|30|60|120|240|D|1D|W|1W|M|1M)$/;

function fiberFor(element: Element): ReactFiber | undefined {
  const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
  return key ? (element as unknown as Record<string, ReactFiber>)[key] : undefined;
}

function chartProps(): ChartProps | undefined {
  const chartFrame = [...document.querySelectorAll<HTMLIFrameElement>('iframe')]
    .find((frame) => frame.src.startsWith('blob:'));
  const candidates: Element[] = [];
  for (let element: Element | null = chartFrame?.parentElement ?? null, depth = 0;
    element && depth < 10; element = element.parentElement, depth += 1) {
    candidates.push(element);
  }
  for (const element of candidates) {
    let fiber = fiberFor(element);
    for (let depth = 0; fiber && depth < 100; depth += 1, fiber = fiber.return ?? undefined) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (typeof props?.onIntervalChange === 'function'
          && typeof props.interval === 'string' && VALID_INTERVAL.test(props.interval)
          && typeof props.symbol === 'string') return props;
      }
    }
  }
  return undefined;
}

function publishTimeframe(): void {
  const interval = chartProps()?.interval;
  if (interval) document.documentElement.setAttribute(TIMEFRAME_ATTRIBUTE, interval);
}

export default defineContentScript({
  matches: ['https://vergex.trade/chart*'],
  world: 'MAIN',
  main() {
    publishTimeframe();
    window.setInterval(publishTimeframe, 500);
    window.addEventListener(REQUEST_EVENT, (rawEvent) => {
      const event = rawEvent as CustomEvent<{ requestId?: string; interval?: string }>;
      const requestId = event.detail?.requestId;
      const interval = event.detail?.interval;
      if (!requestId || typeof interval !== 'string' || !VALID_INTERVAL.test(interval)) return;
      const props = chartProps();
      if (props?.onIntervalChange) props.onIntervalChange(interval);
      window.setTimeout(publishTimeframe, 100);
      window.setTimeout(publishTimeframe, 500);
      window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
        detail: { requestId, ok: Boolean(props?.onIntervalChange) },
      }));
    });
  },
});
