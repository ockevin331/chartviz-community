import { useCallback, useEffect, useState } from 'react';
import { extensionAnalysisTasks, type ExtensionAnalysisListItem } from '../../src/api/extension-auth';

type Language = 'en' | 'zh-CN';

const COPY = {
  en: {
    title: 'Analysis list', intro: 'Your latest chart analyses', close: 'Close',
    empty: 'No analysis records yet.', failed: 'Unable to load analysis records.',
    loadMore: 'Load more', loading: 'Loading…', open: 'View analysis',
    opening: 'Opening…', id: 'Analysis ID', submitted: 'Submitted',
    instrument: 'Instrument', site: 'Site', completed: 'Completed', failedStatus: 'Failed',
    pending: 'Pending', processing: 'Processing', awaiting_confirmation: 'Awaiting confirmation', cancel_requested: 'Cancelling', cancelled: 'Cancelled',
    detailFailed: 'Unable to open this analysis.', limit: 'Up to the latest 1,000 records',
  },
  'zh-CN': {
    title: '分析记录', intro: '当前账号最近的图表分析', close: '关闭',
    empty: '暂无分析记录。', failed: '无法加载分析记录。',
    loadMore: '加载更多', loading: '加载中…', open: '查看分析',
    opening: '正在打开…', id: '分析 ID', submitted: '提交时间',
    instrument: '交易品种', site: '站点', completed: '已完成', failedStatus: '失败',
    pending: '等待处理', processing: '分析中', awaiting_confirmation: '等待确认', cancel_requested: '取消中', cancelled: '已取消',
    detailFailed: '无法打开该分析。', limit: '最多显示最近 1000 条记录',
  },
} as const;

const SITE_NAMES: Record<string, string> = {
  'web-upload': 'ChartViz Web', tradingview: 'TradingView', binance: 'Binance',
  okx: 'OKX', bybit: 'Bybit', hyperliquid: 'Hyperliquid', coinbase: 'Coinbase',
  bitget: 'Bitget', gate: 'Gate', kucoin: 'KuCoin', mexc: 'MEXC', htx: 'HTX',
  upbit: 'Upbit', '10jqka': '同花顺', vergex: 'VergeX',
};

export function AnalysisListPanel({
  language,
  onClose,
  onOpen,
}: {
  language: Language;
  onClose: () => void;
  onOpen: (requestId: string) => Promise<void>;
}) {
  const t = COPY[language];
  const [items, setItems] = useState<ExtensionAnalysisListItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState('');

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError('');
    try {
      const page = await extensionAnalysisTasks(offset, 25);
      setItems((current) => offset === 0 ? page.items : [...current, ...page.items]);
      setNextOffset(page.hasMore ? page.nextOffset : null);
    } catch {
      setError(t.failed);
    } finally {
      setLoading(false);
    }
  }, [t.failed]);

  useEffect(() => { void load(0); }, [load]);

  async function open(item: ExtensionAnalysisListItem) {
    if (item.status !== 'completed' || openingId) return;
    setOpeningId(item.requestId);
    setError('');
    try {
      await onOpen(item.requestId);
      onClose();
    } catch {
      setError(t.detailFailed);
      setOpeningId('');
    }
  }

  const statusText = (status: ExtensionAnalysisListItem['status']) => ({
    completed: t.completed,
    failed: t.failedStatus,
    pending: t.pending,
    processing: t.processing,
    awaiting_confirmation: t.awaiting_confirmation,
    cancel_requested: t.cancel_requested,
    cancelled: t.cancelled,
  })[status];

  return <div className="analysis-list-modal" role="dialog" aria-modal="true" aria-label={t.title}>
    <section className="analysis-list-panel">
      <header><div><h2>{t.title}</h2><p>{t.intro}</p></div><button type="button" title={t.close} aria-label={t.close} onClick={onClose}>×</button></header>
      {error && <p className="analysis-list-error" role="alert">{error}</p>}
      <div className="analysis-list-records">
        {items.map((item) => {
          const symbol = typeof item.context.symbol === 'string' ? item.context.symbol : '—';
          const timeframe = typeof item.context.timeframe === 'string' ? item.context.timeframe : '';
          const site = typeof item.context.site === 'string' ? item.context.site : '';
          const exchange = typeof item.context.exchange === 'string' ? item.context.exchange : '';
          const siteName = SITE_NAMES[site] ?? site ?? exchange ?? 'ChartViz';
          const openable = item.status === 'completed';
          return <button className={`analysis-list-record status-${item.status}`} type="button" key={item.requestId} disabled={!openable || Boolean(openingId)} onClick={() => void open(item)}>
            <span className="analysis-list-id"><small>{t.id}</small><code>{item.requestId}</code></span>
            <span className="analysis-list-summary"><b>{symbol}</b>{timeframe && <i>{timeframe}</i>}<small>{siteName || exchange}</small></span>
            <span className="analysis-list-meta"><em>{statusText(item.status)}</em><time>{new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.createdAt))}</time>{openable && <strong>{openingId === item.requestId ? t.opening : `${t.open} ›`}</strong>}</span>
          </button>;
        })}
        {!loading && items.length === 0 && !error && <p className="analysis-list-empty">{t.empty}</p>}
      </div>
      {nextOffset !== null && (items.length > 0 || loading) && <button className="analysis-list-more" type="button" disabled={loading} onClick={() => void load(nextOffset)}>{loading ? t.loading : t.loadMore}</button>}
      <small className="analysis-list-limit">{t.limit}</small>
    </section>
  </div>;
}
