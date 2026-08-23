import { AnalysisApiError, searchInstrumentNews } from '../src/api/analysis-client';
import { BackendController, backendControllerErrorResponse } from '../src/api/backend-controller';
import type { CloudRequestIdentity } from '../src/api/backend-runtime';
import type {
  AnalysisTaskResponse,
  AnalyzeCapturedChartMessage,
  AnalyzeResponse,
  BackgroundMessage,
  BackgroundResponse,
  CaptureResponse,
  CapturePermissionResponse,
  ChartContextResponse,
  GetChartContextMessage,
  GetAnalysisTaskMessage,
  CancelAnalysisTaskMessage,
  ExtensionApiFetchMessage,
  ExtensionApiFetchResponse,
  SetFloatingPanelVisibilityMessage,
  SetChartTimeframeMessage,
  WaitForChartReadyMessage,
  SupportedCaptureTimeframe,
  ToggleFloatingPanelMessage,
} from '../src/domain/messages';
import { canonicalAnalysisApiBaseUrl } from '../src/api/base-url';
import { blobToDataUrl, cropScreenshot } from '../src/platform/capture/crop';
import { isSupportedChartUrl } from '../src/sites/collect-context';
import { supportsMultiTimeframeAnalysis } from '../src/sites/capabilities';
import { EXTENSION_EDITION } from '../src/config/edition';
import { installAction } from '../src/platform/install-behavior';

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.windowId) {
    throw new Error('No active browser tab was found.');
  }
  return tab;
}

async function requestCapturePermission(): Promise<CapturePermissionResponse> {
  if (!browser.permissions?.request) {
    return { ok: false, error: 'The browser screenshot permission API is unavailable.' };
  }
  return {
    ok: true,
    granted: await browser.permissions.request({ origins: ['<all_urls>'] }),
  };
}

type SupportedSiteLink = { name: string; url: string };

const SUPPORTED_SITE_LINKS: SupportedSiteLink[] = [
  { name: 'TradingView', url: 'https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD&chartviz=open' },
  { name: 'Binance', url: 'https://www.binance.com/en/trade/BTC_USDT?type=spot&chartviz=open' },
  { name: 'OKX', url: 'https://www.okx.com/trade-spot/btc-usdt?chartviz=open' },
  { name: 'Bybit', url: 'https://www.bybit.com/en/trade/usdt/BTCUSDT?chartviz=open' },
  { name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz/trade/BTC?chartviz=open' },
  { name: 'Coinbase', url: 'https://www.coinbase.com/advanced-trade/spot/BTC-USD?chartviz=open' },
  { name: 'Bitget', url: 'https://www.bitget.com/spot/BTCUSDT?chartviz=open' },
  { name: 'Gate', url: 'https://www.gate.com/trade/BTC_USDT?chartviz=open' },
  { name: 'KuCoin', url: 'https://www.kucoin.com/trade/BTC-USDT?chartviz=open' },
  { name: 'MEXC', url: 'https://www.mexc.com/exchange/BTC_USDT?chartviz=open' },
  { name: 'HTX', url: 'https://www.htx.com/trade/btc_usdt?chartviz=open' },
  { name: 'Upbit', url: 'https://www.upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC&chartviz=open' },
  { name: '同花顺', url: 'https://stockpage.10jqka.com.cn/600519/?chartviz=open' },
  { name: 'VergeX', url: 'https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367' },
];

function showUnsupportedSiteNotice(supportedSites: SupportedSiteLink[]) {
  const existing = document.getElementById('chartviz-unsupported-site');
  if (existing) { existing.remove(); return; }
  const host = document.createElement('div');
  host.id = 'chartviz-unsupported-site';
  Object.assign(host.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647',
  });
  const root = host.attachShadow({ mode: 'closed' });
  const isChinese = navigator.language.toLowerCase().startsWith('zh');
  const currentPageUrl = window.location.href;
  const currentHostname = window.location.hostname || window.location.protocol.replace(':', '');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .notice { box-sizing:border-box;width:560px;max-width:calc(100vw - 32px);padding:17px;border:1px solid #353b48;border-radius:14px;color:#e7e9ee;background:#171b2b;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.5 Inter,system-ui,sans-serif }
      .head,.actions { display:flex;align-items:center;justify-content:space-between;gap:8px }.head { margin-bottom:12px }
      strong { font-size:16px } button,select { height:34px;border:1px solid #3d4350;border-radius:9px;color:#e7e9ee;background:#262b38;cursor:pointer }.language { width:86px;padding:0 8px;font-size:12px;font-weight:700 }.close { width:34px;font-size:20px }
      h2 { margin:0;font-size:17px;color:#fff } p { margin:0;color:#aeb5c2 }
      .unsupported-current { display:grid;grid-template-columns:36px minmax(0,1fr);gap:2px 10px;margin:0 0 12px;padding:11px 12px;border:1px solid rgb(217 164 65 / 38%);border-radius:10px;background:linear-gradient(135deg,rgb(105 78 25 / 30%),rgb(69 52 18 / 16%));box-shadow:inset 3px 0 #c49338 }
      .unsupported-icon { grid-row:1 / 4;display:grid;width:30px;height:30px;place-items:center;border-radius:50%;color:#fff;background:#a97826;font-size:18px;font-weight:900 }
      .current-domain { min-width:0;overflow:hidden;color:#e8ce99;font-size:13px;text-overflow:ellipsis;white-space:nowrap }
      .current-url { min-width:0;overflow:hidden;color:#bdae8d;font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap }
      .website-link { display:inline-flex;margin-top:10px;color:#b2baff;font-size:15px;font-weight:850;line-height:1.45;text-decoration:underline;text-decoration-color:rgb(178 186 255 / 66%);text-decoration-thickness:1.5px;text-underline-offset:4px }.website-link:hover { color:#e0e4ff;text-decoration-color:currentColor }
      .supported { margin-top:14px;padding-top:12px;border-top:1px solid #2d3441 }.supported-label { display:block;margin-bottom:7px;color:#7ed7a3;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.06em }
      .sites { display:flex;flex-wrap:wrap;gap:5px }
      .site { display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid rgb(74 222 128 / 30%);border-radius:999px;color:#a9dfbd;background:rgb(24 89 55 / 22%);font-size:10px;line-height:1.4;text-decoration:none;white-space:nowrap }.site::before { color:#63d490;font-size:9px;font-weight:900;content:'✓' }.site:hover { border-color:rgb(74 222 128 / 58%);color:#d5f5df;background:rgb(28 112 67 / 34%) }
      @media(max-width:520px){.notice{width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto}}
    </style>
    <div class="notice" role="alert">
      <div class="head"><strong>ChartViz</strong><div class="actions"><select class="language" aria-label="Language"><option value="en">🇺🇸 EN</option><option value="zh-CN">🇨🇳 CN</option></select><button class="close" type="button" aria-label="Close">×</button></div></div>
      <div class="unsupported-current"><span class="unsupported-icon" aria-hidden="true">!</span><h2></h2><strong class="current-domain"></strong><code class="current-url"></code></div>
      <p class="intro"></p>
      <a class="website-link" href="https://www.chartviz.xyz/" target="_blank" rel="noopener noreferrer"></a>
      <div class="supported"><span class="supported-label"></span><div class="sites">
        ${supportedSites.map((site) => `<a class="site" href="${site.url}" target="_blank" rel="noopener noreferrer" data-base-url="${site.url}">${site.name}</a>`).join('')}
      </div></div>
    </div>`;
  let language: 'zh-CN' | 'en' = isChinese ? 'zh-CN' : 'en';
  const languageSelect = wrapper.querySelector<HTMLSelectElement>('.language')!;
  languageSelect.value = language;
  wrapper.querySelector<HTMLElement>('.current-domain')!.textContent = currentHostname;
  const currentUrlElement = wrapper.querySelector<HTMLElement>('.current-url')!;
  currentUrlElement.textContent = currentPageUrl;
  currentUrlElement.title = currentPageUrl;
  const render = () => {
    const chinese = language === 'zh-CN';
    wrapper.querySelector<HTMLElement>('h2')!.textContent = chinese ? '当前站点不受支持' : 'This site is not supported';
    wrapper.querySelector<HTMLElement>('.intro')!.textContent = chinese ? 'ChartViz 无法在上述页面直接读取或截图 K 线。' : 'ChartViz cannot read or capture a chart directly on the page above.';
    wrapper.querySelector<HTMLElement>('.website-link')!.textContent = chinese ? '前往 ChartViz 网站上传截图分析 →' : 'Upload a screenshot on the ChartViz website →';
    wrapper.querySelector<HTMLElement>('.supported-label')!.textContent = chinese ? '✓ 已支持的站点' : '✓ Supported sites';
    wrapper.querySelectorAll<HTMLAnchorElement>('.site').forEach((link) => {
      const url = new URL(link.dataset.baseUrl!);
      url.searchParams.set('chartviz', 'open');
      url.searchParams.set('chartvizLanguage', language);
      link.href = url.toString();
    });
  };
  languageSelect.addEventListener('change', () => { language = languageSelect.value === 'zh-CN' ? 'zh-CN' : 'en'; render(); });
  wrapper.querySelector('.close')?.addEventListener('click', () => host.remove());
  render();
  root.append(wrapper);
  document.documentElement.append(host);
}

function showSupportedSitePageNotice(siteName: string, chartUrl: string) {
  const existing = document.getElementById('chartviz-supported-site-page-notice');
  if (existing) { existing.remove(); return; }
  const host = document.createElement('div');
  host.id = 'chartviz-supported-site-page-notice';
  Object.assign(host.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'closed' });
  const isChinese = navigator.language.toLowerCase().startsWith('zh');
  const exampleDisplayUrl = new URL(chartUrl);
  exampleDisplayUrl.searchParams.delete('chartviz');
  exampleDisplayUrl.searchParams.delete('chartvizLanguage');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .notice{box-sizing:border-box;width:480px;max-width:calc(100vw - 32px);padding:17px;border:1px solid #353b48;border-radius:14px;color:#e7e9ee;background:#171b2b;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.5 Inter,system-ui,sans-serif}
      .head,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.head{margin-bottom:12px}strong{font-size:16px}button,select{height:34px;border:1px solid #3d4350;border-radius:9px;color:#e7e9ee;background:#262b38;cursor:pointer}.language{width:86px;padding:0 8px;font-size:12px;font-weight:700}.close{width:34px;font-size:20px}
      .page-alert{display:flex;align-items:center;gap:9px;margin-bottom:8px;padding:10px 11px;border:1px solid rgb(217 164 65 / 34%);border-radius:9px;background:rgb(105 78 25 / 16%);box-shadow:inset 3px 0 #c49338}.page-alert i{display:grid;width:24px;height:24px;flex:0 0 24px;place-items:center;border-radius:50%;color:#fff;background:#a97826;font-size:14px;font-style:normal;font-weight:900}.page-alert h2{margin:0;color:#f2f3f6;font-size:16px}p{margin:0;color:#929baa;font-size:11px}.url-card{display:grid;gap:4px;margin-top:12px;padding:9px 10px;border:1px solid #394253;border-radius:9px;background:#1d2230;text-decoration:none}.url-card span{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.url-card code{overflow:hidden;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.example-url{border-color:rgb(113 128 248 / 52%);background:rgb(39 49 92 / 48%)}.example-url span{color:#aeb8ff}.example-url code{color:#eef0ff}.example-url:hover{border-color:#7180f8;background:#293363}
    </style>
    <div class="notice" role="dialog"><div class="head"><strong>ChartViz</strong><div class="actions"><select class="language"><option value="en">🇺🇸 EN</option><option value="zh-CN">🇨🇳 CN</option></select><button class="close" type="button">×</button></div></div><div class="page-alert" role="alert"><i aria-hidden="true">!</i><h2></h2></div><p></p><a class="url-card example-url" target="_blank" rel="noopener noreferrer"><span></span><code></code></a></div>`;
  let language: 'zh-CN' | 'en' = isChinese ? 'zh-CN' : 'en';
  const languageSelect = wrapper.querySelector<HTMLSelectElement>('.language')!;
  languageSelect.value = language;
  const render = () => {
    const chinese = language === 'zh-CN';
    wrapper.querySelector<HTMLElement>('h2')!.textContent = chinese ? '当前页面暂不支持' : 'This page is not supported';
    wrapper.querySelector<HTMLElement>('p')!.textContent = chinese ? `ChartViz 已支持 ${siteName}。当前页面可能不包含 K 线图，或该页面类型尚未接入。` : `ChartViz supports ${siteName}. This page may not contain a candlestick chart, or this page type is not supported yet.`;
    wrapper.querySelector<HTMLElement>('.example-url span')!.textContent = chinese ? `打开支持的 ${siteName} BTC 图表` : `Open a supported ${siteName} BTC chart`;
    const localizedUrl = new URL(chartUrl);
    localizedUrl.searchParams.set('chartviz', 'open');
    localizedUrl.searchParams.set('chartvizLanguage', language);
    const exampleUrlLink = wrapper.querySelector<HTMLAnchorElement>('.example-url')!;
    exampleUrlLink.href = localizedUrl.toString();
    const exampleUrlCode = wrapper.querySelector<HTMLElement>('.example-url code')!;
    exampleUrlCode.textContent = exampleDisplayUrl.toString();
    exampleUrlCode.title = exampleDisplayUrl.toString();
  };
  languageSelect.addEventListener('change', () => { language = languageSelect.value === 'zh-CN' ? 'zh-CN' : 'en'; render(); });
  wrapper.querySelector('.close')?.addEventListener('click', () => host.remove());
  render(); root.append(wrapper); document.documentElement.append(host);
}

function showChartVizWebsiteNotice() {
  const existing = document.getElementById('chartviz-website-notice');
  if (existing) { existing.remove(); return; }
  const host = document.createElement('div');
  host.id = 'chartviz-website-notice';
  Object.assign(host.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'closed' });
  const storedLanguage = window.localStorage.getItem('chartviz:language');
  let language: 'zh-CN' | 'en' = storedLanguage === 'zh-CN' || (!storedLanguage && navigator.language.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .notice{box-sizing:border-box;width:420px;max-width:calc(100vw - 32px);padding:17px;border:1px solid #353b48;border-radius:14px;color:#e7e9ee;background:#171b2b;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.5 Inter,system-ui,sans-serif}
      .head,.actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.head{margin-bottom:12px}.head strong{font-size:16px}button,select{height:34px;border:1px solid #3d4350;border-radius:9px;color:#e7e9ee;background:#262b38;cursor:pointer}.language{width:86px;padding:0 8px;font-size:12px;font-weight:700}.close{width:34px;font-size:20px}
      .website-state{display:flex;align-items:center;gap:10px}.website-state i{display:grid;width:30px;height:30px;flex:0 0 30px;place-items:center;border-radius:50%;color:#d9f7e5;background:rgb(39 139 82 / 34%);font-size:15px;font-style:normal;font-weight:900}.website-state h2{margin:0;color:#f4f5f8;font-size:17px}.intro{margin:9px 0 0;color:#aeb5c2}.upload-link{display:inline-flex;margin-top:11px;color:#b2baff;font-size:15px;font-weight:850;text-decoration:underline;text-decoration-color:rgb(178 186 255 / 66%);text-decoration-thickness:1.5px;text-underline-offset:4px}.upload-link:hover{color:#e0e4ff;text-decoration-color:currentColor}
    </style>
    <div class="notice" role="dialog"><div class="head"><strong>ChartViz</strong><div class="actions"><select class="language" aria-label="Language"><option value="en">🇺🇸 EN</option><option value="zh-CN">🇨🇳 CN</option></select><button class="close" type="button" aria-label="Close">×</button></div></div><div class="website-state"><i aria-hidden="true">✓</i><h2></h2></div><p class="intro"></p><a class="upload-link" href="https://www.chartviz.xyz/"></a></div>`;
  const languageSelect = wrapper.querySelector<HTMLSelectElement>('.language')!;
  languageSelect.value = language;
  const render = () => {
    const chinese = language === 'zh-CN';
    wrapper.querySelector<HTMLElement>('h2')!.textContent = chinese ? '你已在 ChartViz 网站' : "You're already on ChartViz";
    wrapper.querySelector<HTMLElement>('.intro')!.textContent = chinese ? '可以直接在当前网站上传 K 线截图进行分析。' : 'Upload a candlestick screenshot directly on this website to start an analysis.';
    wrapper.querySelector<HTMLElement>('.upload-link')!.textContent = chinese ? '前往截图上传区域 ↓' : 'Go to the screenshot upload area ↓';
  };
  languageSelect.addEventListener('change', () => { language = languageSelect.value === 'zh-CN' ? 'zh-CN' : 'en'; render(); });
  wrapper.querySelector('.close')?.addEventListener('click', () => host.remove());
  wrapper.querySelector<HTMLAnchorElement>('.upload-link')!.addEventListener('click', (event) => {
    const uploadPanel = document.querySelector<HTMLElement>('.upload-panel');
    if (!uploadPanel) return;
    event.preventDefault();
    uploadPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    host.remove();
  });
  render(); root.append(wrapper); document.documentElement.append(host);
}

function showTradingViewFullChartNotice(fullChartUrl: string, hasDetectedSymbol: boolean) {
  const existing = document.getElementById('chartviz-full-chart-notice');
  if (existing) { existing.remove(); return; }
  const host = document.createElement('div');
  host.id = 'chartviz-full-chart-notice';
  Object.assign(host.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'closed' });
  const isChinese = navigator.language.toLowerCase().startsWith('zh');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .notice { box-sizing:border-box;width:360px;max-width:calc(100vw - 32px);padding:16px;border:1px solid #353b48;border-radius:14px;color:#e7e9ee;background:#171b2b;box-shadow:0 18px 60px rgba(0,0,0,.45);font:13px/1.5 Inter,system-ui,sans-serif }
      .head,.actions { display:flex;align-items:center;justify-content:space-between;gap:8px }.head { margin-bottom:8px }
      strong { font-size:16px } button,select { height:34px;border:1px solid #3d4350;border-radius:9px;color:#e7e9ee;background:#262b38;cursor:pointer }.language { width:86px;padding:0 8px;font-size:12px;font-weight:700 }.close { width:34px;font-size:20px }
      p { margin:0;color:#aeb5c2 } a { display:inline-flex;margin-top:12px;padding:9px 13px;border-radius:8px;color:#fff;background:#5968f2;font-weight:700;text-decoration:none }
    </style>
    <div class="notice" role="dialog" aria-modal="false">
      <div class="head"><strong>ChartViz</strong><div class="actions"><select class="language" aria-label="Language"><option value="en">🇺🇸 EN</option><option value="zh-CN">🇨🇳 CN</option></select><button class="close" type="button" aria-label="Close">×</button></div></div>
      <p></p><a href="${fullChartUrl}"></a>
    </div>`;
  let language: 'zh-CN' | 'en' = isChinese ? 'zh-CN' : 'en';
  const languageSelect = wrapper.querySelector<HTMLSelectElement>('.language')!;
  languageSelect.value = language;
  const render = () => {
    const chinese = language === 'zh-CN';
    wrapper.querySelector<HTMLElement>('p')!.textContent = hasDetectedSymbol
      ? (chinese ? '当前是 TradingView 品种详情页。ChartViz 需要在完整图表页面读取并截图 K 线。' : 'This is a TradingView symbol page. ChartViz needs the full chart to read and capture the candlesticks.')
      : (chinese ? '请先在 TradingView 打开某个交易品种的完整图表页面，再使用 ChartViz。' : 'Open the full chart for a specific instrument on TradingView, then use ChartViz.');
    wrapper.querySelector<HTMLElement>('a')!.textContent = chinese ? '打开完整图表' : 'Open full chart';
    const localizedFullChartUrl = new URL(fullChartUrl);
    localizedFullChartUrl.searchParams.set('chartvizLanguage', language);
    wrapper.querySelector<HTMLAnchorElement>('a')!.href = localizedFullChartUrl.toString();
  };
  languageSelect.addEventListener('change', () => { language = languageSelect.value === 'zh-CN' ? 'zh-CN' : 'en'; render(); });
  wrapper.querySelector('.close')?.addEventListener('click', () => host.remove());
  render();
  root.append(wrapper);
  document.documentElement.append(host);
}

function tradingViewFullChartUrl(pageUrl: string): string | null {
  const url = new URL(pageUrl);
  if (!/(^|\.)tradingview\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/symbols\/([^/]+)\/?$/i);
  if (!match?.[1]) return null;
  const symbol = decodeURIComponent(match[1]).toUpperCase();
  const exchange = url.searchParams.get('exchange')?.toUpperCase();
  const qualifiedSymbol = exchange ? `${exchange}:${symbol}` : symbol;
  const fullChartUrl = new URL('https://www.tradingview.com/chart/3c8vMvO3/');
  fullChartUrl.searchParams.set('symbol', qualifiedSymbol);
  fullChartUrl.searchParams.set('chartviz', 'open');
  return fullChartUrl.toString();
}

function supportedSiteForUrl(pageUrl: string): SupportedSiteLink | null {
  let hostname: string;
  try { hostname = new URL(pageUrl).hostname.toLowerCase(); } catch { return null; }
  const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  if (matches('tradingview.com')) return SUPPORTED_SITE_LINKS[0]!;
  if (matches('binance.com')) return SUPPORTED_SITE_LINKS[1]!;
  if (matches('okx.com')) return SUPPORTED_SITE_LINKS[2]!;
  if (matches('bybit.com')) return SUPPORTED_SITE_LINKS[3]!;
  if (hostname === 'app.hyperliquid.xyz') return SUPPORTED_SITE_LINKS[4]!;
  if (matches('coinbase.com')) return SUPPORTED_SITE_LINKS[5]!;
  if (matches('bitget.com')) return SUPPORTED_SITE_LINKS[6]!;
  if (matches('gate.com') || matches('gate.io')) return SUPPORTED_SITE_LINKS[7]!;
  if (matches('kucoin.com')) return SUPPORTED_SITE_LINKS[8]!;
  if (matches('mexc.com')) return SUPPORTED_SITE_LINKS[9]!;
  if (matches('htx.com')) return SUPPORTED_SITE_LINKS[10]!;
  if (matches('upbit.com')) return SUPPORTED_SITE_LINKS[11]!;
  if (matches('10jqka.com.cn')) return SUPPORTED_SITE_LINKS[12]!;
  if (hostname === 'vergex.trade') return SUPPORTED_SITE_LINKS[13]!;
  return null;
}

async function showUnsupportedFeedback(tabId: number) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: showUnsupportedSiteNotice,
      args: [SUPPORTED_SITE_LINKS],
    });
  } catch {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
    await browser.action.setBadgeText({ tabId, text: '!' });
    setTimeout(() => browser.action.setBadgeText({ tabId, text: '' }).catch(() => undefined), 3000);
  }
}

async function showSupportedSitePageFeedback(tabId: number, site: SupportedSiteLink) {
  await browser.scripting.executeScript({
    target: { tabId }, func: showSupportedSitePageNotice, args: [site.name, site.url],
  });
}

async function showChartVizWebsiteFeedback(tabId: number) {
  await browser.scripting.executeScript({ target: { tabId }, func: showChartVizWebsiteNotice });
}

async function showFullChartFeedback(tabId: number, fullChartUrl: string, hasDetectedSymbol = true) {
  await browser.scripting.executeScript({
    target: { tabId }, func: showTradingViewFullChartNotice, args: [fullChartUrl, hasDetectedSymbol],
  });
}

async function toggleSupportedPanel(tabId: number): Promise<boolean> {
  const message = { type: 'chartviz/panel/toggle' } satisfies ToggleFloatingPanelMessage;
  let response = await browser.tabs.sendMessage(tabId, message).catch(() => null);
  if (response) return true;
  try {
    await browser.scripting.executeScript({
      target: { tabId }, files: ['/content-scripts/content.js'],
    });
    response = await browser.tabs.sendMessage(tabId, message).catch(() => null);
    return Boolean(response);
  } catch {
    return false;
  }
}

async function inspectActiveChart(): Promise<ChartContextResponse> {
  const tab = await activeTab();
  const response = (await browser.tabs.sendMessage(tab.id!, {
    type: 'chartviz/context/get',
  } satisfies GetChartContextMessage)) as ChartContextResponse | null | undefined;

  if (!response) {
    return {
      ok: false,
      error:
        'ChartViz is not connected to this page. Refresh the TradingView tab and try again.',
    };
  }
  return response;
}

async function readyActiveChart(tabId: number): Promise<ChartContextResponse> {
  const response = await browser.tabs.sendMessage(tabId, {
    type: 'chartviz/chart/ready',
  } satisfies WaitForChartReadyMessage) as ChartContextResponse | null | undefined;
  return response ?? { ok: false, error: 'ChartViz did not receive a chart readiness response.' };
}

async function captureActiveChart(
  timeframes?: SupportedCaptureTimeframe[],
  skipReadiness = false,
): Promise<CaptureResponse> {
  const tab = await activeTab();
  const ready = skipReadiness ? await inspectActiveChart() : await readyActiveChart(tab.id!);
  if (!ready.ok) return ready;
  if (timeframes?.length) {
    if (!supportsMultiTimeframeAnalysis(ready.context.site)) {
      return { ok: false, error: 'Multi-timeframe analysis is not supported on 10jqka.' };
    }
    const captures: Array<{ timeframe: string; context: any; previewDataUrl: string }> = [];
    const original = ready;
    const originalTimeframe = ['5m', '15m', '1h', '4h', '1d'].includes(original.context.timeframe?.toLowerCase() ?? '')
      ? original.context.timeframe!.toLowerCase() as SupportedCaptureTimeframe : undefined;
    try {
      for (const timeframe of timeframes) {
        const switched = await browser.tabs.sendMessage(tab.id!, { type: 'chartviz/chart/timeframe', timeframe } satisfies SetChartTimeframeMessage) as ChartContextResponse;
        if (!switched?.ok) return { ok: false, error: switched?.error ?? `Unable to switch to ${timeframe}.` };
        const settled = await readyActiveChart(tab.id!);
        if (!settled.ok) return settled;
        if (settled.context.timeframe?.toLowerCase() !== timeframe) {
          return { ok: false, error: `The chart did not finish loading the ${timeframe} timeframe.` };
        }
        const captured = await captureActiveChart(undefined, true);
        if (!captured.ok) return captured;
        captures.push({ timeframe, context: captured.context, previewDataUrl: captured.previewDataUrl });
      }
    } finally {
      if (originalTimeframe && originalTimeframe !== timeframes.at(-1)) {
        await browser.tabs.sendMessage(tab.id!, { type: 'chartviz/chart/timeframe', timeframe: originalTimeframe } satisfies SetChartTimeframeMessage).catch(() => undefined);
      }
    }
    return { ok: true, context: captures[0]!.context, previewDataUrl: captures[0]!.previewDataUrl, captures };
  }
  const contextResponse = ready;

  await browser.tabs.sendMessage(tab.id!, {
    type: 'chartviz/panel/visibility', visible: false,
  } satisfies SetFloatingPanelVisibilityMessage);
  await new Promise((resolve) => setTimeout(resolve, 80));
  let croppedImage: Blob;
  try {
    const screenshot = await browser.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
    croppedImage = await cropScreenshot(screenshot, contextResponse.context);
  } finally {
    await browser.tabs.sendMessage(tab.id!, {
      type: 'chartviz/panel/visibility', visible: true,
    } satisfies SetFloatingPanelVisibilityMessage).catch(() => undefined);
  }

  return {
    ok: true,
    context: contextResponse.context,
    previewDataUrl: await blobToDataUrl(croppedImage),
  };
}

async function analyzeCapturedChart(
  message: AnalyzeCapturedChartMessage,
  controller: BackendController,
): Promise<AnalyzeResponse> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(message.previewDataUrl)) {
    return { ok: false, error: 'The captured chart preview is invalid.' };
  }
  const sources = message.captures?.length ? message.captures : [{ timeframe: message.context.timeframe ?? '', context: message.context, previewDataUrl: message.previewDataUrl }];
  const images = await Promise.all(sources.map(async (capture) => ({ timeframe: capture.timeframe, image: await (await fetch(capture.previewDataUrl)).blob() })));
  const task = await controller.createAnalysis({
    images,
    context: message.context,
    cloudIdentity: cloudIdentity(message),
  });
  return { ok: true, task };
}

function cloudIdentity(message: {
  authToken?: string;
  authUserId?: string;
  extensionVersion?: string;
}): CloudRequestIdentity | undefined {
  if (!message.authToken || !message.authUserId || !message.extensionVersion) return undefined;
  return {
    accessToken: message.authToken,
    userId: message.authUserId,
    extensionVersion: message.extensionVersion,
  };
}

async function getAnalysisTask(
  message: GetAnalysisTaskMessage,
  controller: BackendController,
): Promise<AnalysisTaskResponse> {
  return {
    ok: true,
    task: await controller.getAnalysis(
      message.requestId,
      cloudIdentity(message),
    ),
  };
}

async function cancelAnalysisTask(
  message: CancelAnalysisTaskMessage,
  controller: BackendController,
): Promise<AnalysisTaskResponse> {
  return {
    ok: true,
    task: await controller.cancelAnalysis(
      message.requestId,
      cloudIdentity(message),
    ),
  };
}

async function proxyExtensionApiFetch(
  message: ExtensionApiFetchMessage,
): Promise<ExtensionApiFetchResponse> {
  if (!/^\/v1\/(?:auth|extension-auth|user-settings|analysis-models|analysis-tasks|chart-analyses)(?:\/|$|\?)/.test(message.path)) {
    return { ok: false, error: 'The requested extension API path is not allowed.' };
  }
  const method = message.method ?? 'GET';
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return { ok: false, error: 'The requested extension API method is not allowed.' };
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (/^(?:accept|content-type|authorization)$/i.test(name)) headers.set(name, value);
  }
  const response = await fetch(
    `${canonicalAnalysisApiBaseUrl(import.meta.env.WXT_PUBLIC_ANALYSIS_API_BASE_URL)}${message.path}`,
    {
      method,
      credentials: 'omit',
      headers,
      body: method === 'GET' ? undefined : message.body,
    },
  );
  const responseType = message.responseType ?? 'text';
  let body: string;
  if (responseType === 'base64') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    body = btoa(binary);
  } else {
    body = await response.text();
  }
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body,
    encoding: responseType,
  };
}

export default defineBackground(() => {
  const controller = new BackendController({
    edition: EXTENSION_EDITION,
    platform: {
      containsOrigin: (origin) => browser.permissions.contains({ origins: [origin] }),
      requestOrigin: (origin) => browser.permissions.request({ origins: [origin] }),
      fetch: (input, init) => fetch(input, init),
    },
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void (async () => {
      await browser.storage.local.set({ 'chartviz:language': 'en' });
      const action = installAction(EXTENSION_EDITION, 'en');
      if (action.kind === 'open-tab') await browser.tabs.create({ url: action.url });
    })();
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    if (/^https:\/\/(?:www\.)?chartviz\.xyz(?:[/:?#]|$)/i.test(tab.url ?? '')) {
      await showChartVizWebsiteFeedback(tab.id).catch(() => undefined);
      return;
    }
    const isSupported = isSupportedChartUrl(tab.url ?? '');
    if (!isSupported) {
      const fullChartUrl = tradingViewFullChartUrl(tab.url ?? '');
      if (fullChartUrl) {
        await showFullChartFeedback(tab.id, fullChartUrl).catch(() => showUnsupportedFeedback(tab.id!));
        return;
      }
      if (/^https:\/\/([^.]+\.)*tradingview\.com\//i.test(tab.url ?? '')) {
        await showFullChartFeedback(
          tab.id,
          'https://www.tradingview.com/chart/3c8vMvO3/',
          false,
        ).catch(() => showUnsupportedFeedback(tab.id!));
        return;
      }
      const supportedSite = supportedSiteForUrl(tab.url ?? '');
      if (supportedSite) {
        await showSupportedSitePageFeedback(tab.id, supportedSite).catch(() => showUnsupportedFeedback(tab.id!));
        return;
      }
      await showUnsupportedFeedback(tab.id);
      return;
    }
    const opened = await toggleSupportedPanel(tab.id);
    if (!opened) await browser.tabs.reload(tab.id);
  });

  browser.runtime.onMessage.addListener(
    async (message: BackgroundMessage): Promise<BackgroundResponse | undefined> => {
      try {
        if (message.type === 'chartviz/active-chart/inspect') {
          return await inspectActiveChart();
        }
        if (message.type === 'chartviz/capture-permission/request') {
          return await requestCapturePermission();
        }
        if (message.type === 'chartviz/active-chart/capture') {
          return await captureActiveChart(message.timeframes);
        }
        if (message.type === 'chartviz/captured-chart/analyze') {
          return await analyzeCapturedChart(message, controller);
        }
        if (message.type === 'chartviz/analysis-task/get') {
          return await getAnalysisTask(message, controller);
        }
        if (message.type === 'chartviz/analysis-task/cancel') {
          return await cancelAnalysisTask(message, controller);
        }
        if (message.type === 'chartviz/community-connection/get') {
          return { ok: true, connection: await controller.connectionStatus() };
        }
        if (message.type === 'chartviz/community-connection/test-and-save') {
          return {
            ok: true,
            connection: await controller.testAndSaveConnection({
              baseUrl: message.baseUrl,
              token: message.token,
              reuseStoredToken: message.reuseStoredToken,
            }),
          };
        }
        if (message.type === 'chartviz/community-connection/disconnect') {
          return { ok: true, connection: await controller.disconnectCommunity() };
        }
        if (message.type === 'chartviz/backend/capabilities') {
          return { ok: true, capabilities: await controller.capabilities() };
        }
        if (message.type === 'chartviz/instrument-news/search') {
          return {
            ok: true,
            news: await searchInstrumentNews(message.symbol, message.exchange, message.language),
          };
        }
        if (message.type === 'chartviz/extension-api/fetch') {
          return await proxyExtensionApiFetch(message);
        }
        if (message.type === 'chartviz/active-panel/close') {
          const tab = await activeTab();
          return await browser.tabs.sendMessage(tab.id!, {
            type: 'chartviz/panel/visibility', visible: false,
          } satisfies SetFloatingPanelVisibilityMessage);
        }
        return undefined;
      } catch (error) {
        if (
          message.type.startsWith('chartviz/community-connection/')
          || message.type === 'chartviz/backend/capabilities'
        ) {
          return backendControllerErrorResponse(error);
        }
        const errorCode = error instanceof AnalysisApiError
          ? error.code
          : typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : undefined;
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Chart operation failed.',
          ...(errorCode ? { code: errorCode } : {}),
          ...(error instanceof AnalysisApiError ? { pricingUrl: error.pricingUrl } : {}),
        };
      }
    },
  );
});
