import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { analysisReportSchema, type AnalysisEnvelope, type ChartContext, type DrawingInstruction } from '../../src/domain/analysis';
import { groupReportDrawings, tradeSignalDrawings } from '../../src/domain/drawing-groups';
import { entryArrowGeometry } from '../../src/domain/drawing-geometry';
import { decisionSummary, effectiveRLabel, gateReason, marketRegimeLabel, priceBandLabel, sanitizeAnalysisReportForDisplay, setupLabel, targetSourceLabel, zoneFigure } from '../../src/domain/analysis-presentation';
import { visibleAnalysisProgress, type AnalysisProgressEvent } from '../../src/domain/analysis-progress';
import {
  accessToken,
  extensionAnalysisImage,
  extensionAnalysisTask,
  extensionSettings,
  extensionUser,
  logoutExtension,
  refreshExtensionAccessToken,
  updateExtensionLanguage,
  type ExtensionUser,
} from '../../src/api/extension-auth';
import { DEFAULT_MULTI_TIMEFRAMES, MULTI_FRAME_STORAGE_KEY, validMultiTimeframes } from '../../src/settings/multi-frame';
import ExtensionAuthPanel from './ExtensionAuthPanel';
import { AnalysisListPanel } from './AnalysisListPanel';
import { ModelSettingsPanel } from './ModelSettingsPanel';
import { TimeframeSettingsPanel } from './TimeframeSettingsPanel';
import { CommunityConnectionPanel } from './CommunityConnectionPanel';
import type {
  AnalysisTaskResponse,
  AnalyzeCapturedChartMessage,
  AnalyzeResponse,
  CaptureActiveChartMessage,
  CapturePermissionResponse,
  CaptureResponse,
  ChartContextResponse,
  CloseFloatingPanelMessage,
  InspectActiveChartMessage,
  RequestCapturePermissionMessage,
  GetAnalysisTaskMessage,
  CancelAnalysisTaskMessage,
  SupportedCaptureTimeframe,
  BackendCapabilitiesResponse,
  CommunityConnectionResponse,
  DisconnectCommunityConnectionMessage,
} from '../../src/domain/messages';
import { supportsMultiTimeframeAnalysis } from '../../src/sites/capabilities';
import { EXTENSION_EDITION } from '../../src/config/edition';
import { deriveExtensionFeatures, type ExtensionFeatures } from '../../src/domain/extension-features';
import type { CommunityConnectionView } from '../../src/api/community-connection';

type Language = 'en' | 'zh-CN';
type AnalysisMode = 'single' | 'multi';
export type PanelBridge = {
  close: () => void;
  drag: (dx: number, dy: number) => void;
  preview: (dataUrl: string) => void;
};
type ViewState =
  | 'inspecting'
  | 'ready'
  | 'capturing'
  | 'preview'
  | 'analyzing'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

const LANGUAGE_STORAGE_KEY = 'chartviz:language';
const LANGUAGE_OPTIONS: Array<{ value: Language; code: string; flag: string; label: string }> = [
  { value: 'en', code: 'EN', flag: '🇺🇸', label: 'English' },
  { value: 'zh-CN', code: 'CN', flag: '🇨🇳', label: '简体中文' },
];
const COPY = {
  en: {
    slogan: 'Instant pattern intelligence – wherever you trade.',
    language: 'Language', currentAccount: 'Signed in as', account: 'Account', plan: 'Plan', expires: 'Expires', settings: 'Settings', analysisList: 'Analysis list', modelSettings: 'Analysis model', timeframeSettings: 'Multi-timeframe', timeframeSettingsHelp: 'Change the capture timeframes from the account menu.', reload: 'Re-detect current chart', logout: 'Sign out of extension', close: 'Close', tokenStock: 'Instrument', detected: 'Detected',
    instrument: 'Instrument', exchange: 'Exchange', timeframe: 'Timeframe', notDetected: 'Not detected',
    screenshotSource: 'Screenshot mode', singlePeriod: 'Single timeframe', multiPeriod: 'Multi-timeframe',
    singlePeriodNote: 'Analyze the currently visible timeframe', multiPeriodNote: '3 charts', multiPeriodFlicker: 'The chart will switch between timeframes while capturing, so the page may briefly flicker.', comingSoon: 'Coming soon', advanceOnly: 'Advance plan only',
    timeframeViews: 'Timeframe views',
    tradeSignals: 'Trade signals', signalTime: 'Signal time', setupAtSignal: 'Setup at signal', entryPlan: 'Entry', stopLoss: 'Stop loss', takeProfit: 'Take profit', riskReward: 'Estimated risk/reward', cutoff: 'Information cutoff',
    levelStatus: 'Level status',
    marketRegime: 'Market regime', currentLocation: 'Current location', tradePlan: 'Trade plan', waitingConditions: 'Waiting conditions', playbook: 'Setup', setupState: 'Setup state', premise: 'Premise', entryZone: 'Entry zone', triggerConfirmation: 'Trigger and confirmation', structuralStop: 'Structural stop', targets: 'Targets', effectiveR: 'Effective R to T1', pendingConditions: 'Waiting for', hardVetoes: 'Why no trade', zoneScore: 'Zone score', timeframeRole: 'Timeframe', feeSlippage: 'Includes fee and slippage assumptions',
    annotationLevels: 'Support, resistance and breakouts', annotationSignals: 'Entries, stops and targets', annotationStructure: 'Market structure', annotationPatterns: 'Annotated chart patterns',
    permissionDenied: 'Screenshot permission was not granted.', permissionUnavailable: 'Screenshot permission is unavailable. Reload the extension and try again.',
    invalidChartImage: 'The screenshot is not a readable candlestick chart. Make sure candles, prices, volume, and the time axis are visible.',
    annotatedPreview: 'Annotated preview', downloadImage: 'Download annotated PNG',
    preview: 'Screenshot preview', originalScreenshot: 'Original screenshot',
    previewHelp: 'Analysis starts automatically after the screenshot is captured.', multiPreviewHelp: 'Analysis starts automatically after all timeframe screenshots are captured.',
    previewAlt: 'Cropped chart ready for analysis', identifying: 'Identifying chart…',
    capturing: 'Waiting for chart and capturing…', chartReadinessStatus: 'Waiting for the chart and timeframe controls to finish loading. This may take a few seconds.', capture: 'Capture and analyze', captureMulti: 'Capture timeframes', retry: 'Retry chart detection',
    analyzing: 'Analyzing…', analyze: 'Analyze screenshot', analyzeMulti: 'Start analysis', cancelAnalysis: 'Cancel analysis', cancellingAnalysis: 'Cancelling…', cancelConfirm: 'Cancel this analysis? If model processing has started, it will still count toward your quota.', cancelled: 'Analysis cancelled. You can start a new analysis with this screenshot.',
    trend: 'Trend', structure: 'Structure', bias: 'Bias', confidence: 'Confidence', marketExplanation: 'Market explanation', recommendation: 'Recommendation', recommendationReason: 'Why this recommendation',
    currentView: 'Current view', status: 'Status', primaryRisk: 'Primary risk', insights: 'Insights',
    keyLevels: 'Support and resistance', patterns: 'Chart patterns', conclusions: 'Why this view', segments: 'Price segments', indicatorsTitle: 'Technical Indicators', volumePrice: 'Price & Volume', details: 'Details', judgment: 'Plain conclusion', reason: 'Why', basis: 'Visible chart evidence', counterEvidence: 'What to watch', priceAction: 'Price action', volumeMeaning: 'Volume implication', indicatorMeaning: 'Indicator implication',
    evidence: 'Evidence balance', bullish: 'Bullish', bearish: 'Bearish', conflicts: 'Conflicts',
    scenarios: 'Entry and risk plan', long: 'Long', short: 'Short', wait: 'Wait',
    conditions: 'Conditions', resolution: 'Resolution', trigger: 'Entry condition',
    confirmation: 'Entry confirmation', invalidation: 'Stop loss / view invalidation', target: 'Target area', risk: 'Risk',
    forming: 'Forming', confirmed: 'Confirmed', invalidated: 'Invalidated',
    waiting_trigger: 'Waiting for trigger', waiting_confirmation: 'Waiting for confirmation',
    conditions_met: 'Conditions met', none: 'None reported.',
    technicalAnalysis: 'Technical analysis', news: 'News', newsLoading: 'Searching the latest news…',
    newsEmpty: 'No relevant news was found.', newsFailed: 'Unable to search news. Try again.', searchQuery: 'Search',
    signIn: 'Get Started for Free', login: 'Get Started for Free', signedIn: 'Signed in',
    accountMismatch: 'The displayed account did not match the analysis authorization. Sign in again before analyzing.',
    extensionUpdateRequired: 'Update ChartViz to the latest version before analyzing.',
  },
  'zh-CN': {
    slogan: '智能识图，交易无界。',
    language: '语言', currentAccount: '当前账号', account: '账号', plan: '套餐', expires: '截止时间', settings: '设置', analysisList: '分析记录', modelSettings: '分析模型', timeframeSettings: '多周期设置', timeframeSettingsHelp: '可在账号菜单中修改截图周期。', reload: '重新识别当前图表', logout: '退出插件登录', close: '关闭', tokenStock: '交易品种', detected: '已识别',
    instrument: '交易品种', exchange: '交易所', timeframe: '周期', notDetected: '未识别',
    screenshotSource: '截图方式', singlePeriod: '单周期分析', multiPeriod: '多周期分析',
    singlePeriodNote: '分析当前页面显示的周期', multiPeriodNote: '3 张图', multiPeriodFlicker: '截图时会依次切换图表周期，页面可能会短暂闪烁。', comingSoon: '即将推出', advanceOnly: '仅 Advance 计划可用',
    timeframeViews: '各周期截图',
    tradeSignals: '交易信号', signalTime: '信号时间', setupAtSignal: '当时的信号依据', entryPlan: '入场参考', stopLoss: '止损参考', takeProfit: '止盈参考', riskReward: '预计盈亏比', cutoff: '信息截止点',
    levelStatus: '价位状态',
    marketRegime: '行情环境', currentLocation: '当前位置', tradePlan: '交易计划', waitingConditions: '等待条件', playbook: '交易形态', setupState: '形态状态', premise: '交易前提', entryZone: '入场区域', triggerConfirmation: '触发与确认', structuralStop: '结构止损', targets: '目标位置', effectiveR: '到第一目标位的有效盈亏比', pendingConditions: '仍需等待', hardVetoes: '不交易原因', zoneScore: '区域评分', timeframeRole: '所属周期', feeSlippage: '已计入手续费与滑点假设',
    annotationLevels: '支撑、阻力与突破', annotationSignals: '入场信号、止损与止盈', annotationStructure: '市场结构', annotationPatterns: '图表形态标注',
    permissionDenied: '未授予截图权限。', permissionUnavailable: '截图权限功能不可用，请重新加载插件后重试。',
    invalidChartImage: '截图不是可识别的 K 线图，请确保蜡烛、价格、成交量和时间轴清晰可见。',
    annotatedPreview: '标注预览', downloadImage: '下载标注图片',
    preview: '截图预览', originalScreenshot: '原始截图',
    previewHelp: '截图成功后将自动开始分析。', multiPreviewHelp: '全部周期截图成功后将自动开始分析。',
    previewAlt: '等待分析的图表截图', identifying: '正在识别图表…', capturing: '等待图表加载并截图…', chartReadinessStatus: '正在等待图表和周期控件加载完成，可能需要几秒钟。',
    capture: '截图并分析', captureMulti: '截取多周期图表', retry: '重新识别图表',
    analyzing: '正在分析…', analyze: '分析截图', analyzeMulti: '开始分析', cancelAnalysis: '取消分析', cancellingAnalysis: '正在取消…', cancelConfirm: '确定取消这次分析吗？模型已开始处理时，本次仍会计入额度。', cancelled: '分析已取消。你可以使用当前截图重新发起分析。', trend: '当前走势', structure: '市场结构', marketExplanation: '行情解读', recommendation: '建议', recommendationReason: '建议理由',
    bias: '方向倾向', confidence: '置信度', currentView: '当前观点', status: '状态',
    primaryRisk: '主要风险', insights: '市场解读', keyLevels: '支撑位与阻力位', patterns: '图表形态', conclusions: '为什么这样判断', segments: '行情分段', indicatorsTitle: '技术指标解读', volumePrice: '量价解读', details: '详细信息', judgment: '简单结论', reason: '为什么', basis: '图上看到的证据', counterEvidence: '还要留意', priceAction: '价格变化', volumeMeaning: '成交量含义', indicatorMeaning: '指标含义', evidence: '多空依据', bullish: '支持上涨',
    bearish: '支持下跌', conflicts: '矛盾信号', scenarios: '入场与风控计划', long: '做多',
    short: '做空', wait: '等待', conditions: '条件', resolution: '解除等待条件',
    trigger: '入场条件', confirmation: '入场确认', invalidation: '止损 / 观点失效', target: '目标位置', risk: '风险',
    forming: '形成中', confirmed: '已确认', invalidated: '已失效',
    strong: '强', moderate: '中等', weak: '弱', confirming: '量价确认', bullish_divergence: '看多背离', bearish_divergence: '看空背离', mixed: '信号混合',
    impulse_up: '推动上涨', pullback_down: '回调', consolidation: '整理', breakout_up: '向上突破', impulse_down: '推动下跌', rebound_up: '反弹', breakdown: '向下跌破',
    waiting_trigger: '等待触发', waiting_confirmation: '等待确认', conditions_met: '条件满足', none: '暂无。',
    technicalAnalysis: '技术分析', news: '消息面', newsLoading: '正在搜索最新消息…',
    newsEmpty: '没有找到相关消息。', newsFailed: '消息搜索失败，请重试。', searchQuery: '搜索词',
    signIn: '免费开始', login: '免费开始', signedIn: '已登录',
    accountMismatch: '界面显示的账号与分析授权不一致，请重新登录后再分析。',
    extensionUpdateRequired: '请更新到最新版 ChartViz 插件后再分析。',
  },
} as const;

export default function App({ panelBridge }: { panelBridge?: PanelBridge } = {}) {
  const [language, setLanguage] = useState<Language>('en');
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('single');
  const [multiTimeframes, setMultiTimeframes] = useState<SupportedCaptureTimeframe[]>(DEFAULT_MULTI_TIMEFRAMES);
  const [state, setState] = useState<ViewState>('inspecting');
  const [error, setError] = useState('');
  const [pricingUrl, setPricingUrl] = useState('');
  const [context, setContext] = useState<ChartContext | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisEnvelope | null>(null);
  const [preview, setPreview] = useState('');
  const [captures, setCaptures] = useState<Array<{ timeframe: string; context: ChartContext; previewDataUrl: string }>>([]);
  const [progressEvents, setProgressEvents] = useState<AnalysisProgressEvent[]>([]);
  const [activeRequestId, setActiveRequestId] = useState('');
  const [authUser, setAuthUser] = useState<ExtensionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [analysisListOpen, setAnalysisListOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [timeframeSettingsOpen, setTimeframeSettingsOpen] = useState(false);
  const [backendChecked, setBackendChecked] = useState(false);
  const [features, setFeatures] = useState<ExtensionFeatures | null>(null);
  const [communityConnection, setCommunityConnection] = useState<CommunityConnectionView | null>(null);
  const languagePickerRef = useRef<HTMLDivElement>(null);
  const accountPickerRef = useRef<HTMLDivElement>(null);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const inspectRequestRef = useRef(0);
  const workflowRevisionRef = useRef(0);
  const t = COPY[language];

  const inspectChart = useCallback(async () => {
    const request = ++inspectRequestRef.current;
    setState('inspecting'); setError(''); setPricingUrl(''); setContext(null); setAnalysis(null); setPreview(''); setCaptures([]); setActiveRequestId('');
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'chartviz/active-chart/inspect',
      } satisfies InspectActiveChartMessage)) as ChartContextResponse | null;
      if (request !== inspectRequestRef.current) return;
      if (!response) throw new Error('No response from ChartViz. Refresh the TradingView tab and try again.');
      if (!response.ok) throw new Error(response.error);
      if (!supportsMultiTimeframeAnalysis(response.context.site)) setAnalysisMode('single');
      setContext(response.context); setState('ready');
    } catch (caught) {
      if (request !== inspectRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Unable to inspect chart.'); setState('failed');
    }
  }, []);

  useEffect(() => {
    void browser.storage.local.get([LANGUAGE_STORAGE_KEY, MULTI_FRAME_STORAGE_KEY]).then((stored) => {
      const value = stored[LANGUAGE_STORAGE_KEY];
      if (value === 'en' || value === 'zh-CN') setLanguage(value);
      if (EXTENSION_EDITION === 'cloud') {
        const frames = validMultiTimeframes(stored[MULTI_FRAME_STORAGE_KEY]);
        if (frames) setMultiTimeframes(frames);
      }
    });
    if (EXTENSION_EDITION === 'community') {
      void browser.runtime.sendMessage({
        type: 'chartviz/community-connection/get',
      }).then((response: CommunityConnectionResponse | undefined) => {
        if (!response) throw new Error('community_unreachable');
        if (!response.ok) throw new Error(response.message);
        setCommunityConnection(response.connection);
        if (response.connection.connected && response.connection.capabilities) {
          setFeatures(deriveExtensionFeatures('community', response.connection.capabilities));
          void inspectChart();
        }
      }).catch((caught) => {
        setCommunityConnection({ connected: false, hasStoredToken: false });
        setError(caught instanceof Error ? caught.message : 'Community backend unavailable.');
      }).finally(() => {
        setAuthChecked(true);
        setBackendChecked(true);
      });
      return;
    }
    void browser.runtime.sendMessage({ type: 'chartviz/backend/capabilities' })
      .then((response: BackendCapabilitiesResponse | undefined) => {
        if (!response?.ok) throw new Error(response?.message ?? 'Cloud backend unavailable.');
        setFeatures(deriveExtensionFeatures('cloud', response.capabilities));
        return extensionUser();
      })
      .then((user) => {
        setAuthUser(user);
        if (user && !user.onboardingComplete) setAuthModalOpen(true);
        if (user?.preferredLanguage) {
          setLanguage(user.preferredLanguage);
          void browser.storage.local.set({ [LANGUAGE_STORAGE_KEY]: user.preferredLanguage });
        }
        if (user) void extensionSettings().then((settings) => {
          const frames = validMultiTimeframes(settings?.multi_frame);
          if (!frames) return;
          setMultiTimeframes(frames);
          void browser.storage.local.set({ [MULTI_FRAME_STORAGE_KEY]: frames });
        });
        void inspectChart();
      }).catch((caught) => {
        setAuthUser(null);
        setError(caught instanceof Error ? caught.message : 'Cloud backend unavailable.');
        setState('failed');
      }).finally(() => {
        setAuthChecked(true);
        setBackendChecked(true);
      });
  }, [inspectChart]);

  useEffect(() => {
    if (EXTENSION_EDITION !== 'cloud') return;
    const syncMultiFrameSetting = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      const frames = validMultiTimeframes(changes[MULTI_FRAME_STORAGE_KEY]?.newValue);
      if (frames) setMultiTimeframes(frames);
    };
    browser.storage.onChanged.addListener(syncMultiFrameSetting);
    return () => browser.storage.onChanged.removeListener(syncMultiFrameSetting);
  }, []);

  useEffect(() => {
    function refreshChartContext(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source === 'chartviz-page' && data.type === 'context-changed') {
        void inspectChart();
      }
    }
    window.addEventListener('message', refreshChartContext);
    const refreshDirectChartContext = () => { void inspectChart(); };
    window.addEventListener('chartviz:context-changed', refreshDirectChartContext);
    return () => {
      window.removeEventListener('message', refreshChartContext);
      window.removeEventListener('chartviz:context-changed', refreshDirectChartContext);
    };
  }, [inspectChart]);

  useEffect(() => {
    function closeHeaderMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!languagePickerRef.current?.contains(target)) setLanguageMenuOpen(false);
      if (!accountPickerRef.current?.contains(target)) setAccountMenuOpen(false);
    }
    // In Upbit the panel is mounted in a closed ShadowRoot. Listening on the
    // page document retargets every internal click to the shadow host, which
    // closes the menu on mousedown before its option receives a click. Listen
    // inside the actual UI root so both direct-shadow and iframe modes behave
    // the same way.
    const eventRoot = languagePickerRef.current?.getRootNode() ?? document;
    eventRoot.addEventListener('mousedown', closeHeaderMenus as EventListener);
    return () => eventRoot.removeEventListener('mousedown', closeHeaderMenus as EventListener);
  }, []);

  function changeLanguage(value: Language) {
    setLanguage(value);
    setLanguageMenuOpen(false);
    void browser.storage.local.set({ [LANGUAGE_STORAGE_KEY]: value });
    if (features?.cloudAccount && authUser) {
      void updateExtensionLanguage(value).then((user) => user && setAuthUser(user));
    }
  }

  function changeAnalysisMode(mode: AnalysisMode) {
    if (mode === analysisMode) return;
    workflowRevisionRef.current += 1;
    setAnalysisMode(mode);
    setPreview('');
    setCaptures([]);
    setAnalysis(null);
    setProgressEvents([]);
    setError('');
    setPricingUrl('');
    setState(context ? 'ready' : 'inspecting');
  }

  async function capturePreview() {
    if (features?.cloudAccount && !authUser?.onboardingComplete) {
      setAuthModalOpen(true);
      return;
    }
    const revision = ++workflowRevisionRef.current;
    setError(''); setAnalysis(null); setPreview(''); setCaptures([]); setProgressEvents([]);
    try {
      const permission = (await browser.runtime.sendMessage({
        type: 'chartviz/capture-permission/request',
      } satisfies RequestCapturePermissionMessage)) as CapturePermissionResponse | null;
      if (!permission?.ok) {
        throw new Error(t.permissionUnavailable);
      }
      if (!permission.granted) {
        throw new Error(t.permissionDenied);
      }
      const effectiveMode: AnalysisMode = !features?.multiTimeframe
        || (context && !supportsMultiTimeframeAnalysis(context.site))
        ? 'single'
        : analysisMode;
      let captureTimeframes = multiTimeframes;
      if (effectiveMode === 'multi' && features?.cloudAccount) {
        const settings = await extensionSettings();
        const remoteFrames = validMultiTimeframes(settings?.multi_frame);
        if (remoteFrames) {
          captureTimeframes = remoteFrames;
          setMultiTimeframes(remoteFrames);
          await browser.storage.local.set({ [MULTI_FRAME_STORAGE_KEY]: remoteFrames });
        }
      }
      if (revision !== workflowRevisionRef.current) return;
      setState('capturing');
      const response = (await browser.runtime.sendMessage({
        type: 'chartviz/active-chart/capture',
        timeframes: effectiveMode === 'multi' ? captureTimeframes : undefined,
      } satisfies CaptureActiveChartMessage)) as CaptureResponse | null;
      if (revision !== workflowRevisionRef.current) return;
      if (!response) throw new Error('No response from ChartViz. Refresh the TradingView tab and try again.');
      if (!response.ok) throw new Error(response.error);
      const capturedCharts = response.captures ?? [];
      setContext(response.context); setPreview(response.previewDataUrl); setCaptures(capturedCharts); setState('preview');
      await startAnalysis(response.context, response.previewDataUrl, capturedCharts, revision);
    } catch (caught) {
      if (revision !== workflowRevisionRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Screenshot capture failed.'); setState('failed');
    }
  }

  async function startAnalysis(
    sourceContext: ChartContext | null = context,
    sourcePreview: string = preview,
    sourceCaptures: Array<{ timeframe: string; context: ChartContext; previewDataUrl: string }> = captures,
    existingRevision?: number,
  ) {
    if (!sourceContext || !sourcePreview) return;
    const revision = existingRevision ?? ++workflowRevisionRef.current;
    if (features?.cloudAccount && !authUser?.onboardingComplete) {
      setAuthModalOpen(true);
      return;
    }
    const expectedAuthUserId = authUser?.id;
    const extensionVersion = browser.runtime.getManifest().version;
    const isMultiTimeframe = Boolean(features?.multiTimeframe)
      && supportsMultiTimeframeAnalysis(sourceContext.site)
      && analysisMode === 'multi';
    if (isMultiTimeframe && features?.billing && (authUser?.plan !== 'advance' || authUser.subscriptionStatus !== 'active')) {
      setError(language === 'zh-CN' ? `多周期分析仅适用于 Advance 套餐。升级后可同时分析 ${multiTimeframes.join('、')} 周期。` : `Multi-timeframe analysis requires an active Advance plan. Upgrade to analyze the ${multiTimeframes.join(' and ')} charts together.`);
      setPricingUrl('https://www.chartviz.xyz/#pricing');
      return;
    }
    setState('analyzing'); setError(''); setPricingUrl(''); setAnalysis(null);
    setProgressEvents([{ code: 'preparing', createdAt: new Date().toISOString() }]);
    try {
      let activeAuthToken = features?.cloudAccount ? (await accessToken() ?? undefined) : undefined;
      if (features?.cloudAccount && !activeAuthToken) {
        setAuthUser(null);
        setAuthModalOpen(true);
        throw new Error(language === 'zh-CN' ? '请先登录 ChartViz。' : 'Sign in to ChartViz first.');
      }
      const localizedContext: ChartContext = {
        ...sourceContext,
        outputLanguage: language,
        captureSource: 'automatic',
      };
      const analyze = (authToken?: string) => browser.runtime.sendMessage({
        type: 'chartviz/captured-chart/analyze',
        ...(features?.cloudAccount ? { authToken, authUserId: expectedAuthUserId, extensionVersion } : {}),
        context: localizedContext, previewDataUrl: sourcePreview,
        captures: sourceCaptures.map((capture) => ({ ...capture, context: { ...capture.context, outputLanguage: language, captureSource: 'automatic' } })),
      } satisfies AnalyzeCapturedChartMessage) as Promise<AnalyzeResponse | null>;
      let response = await analyze(activeAuthToken);
      if (features?.cloudAccount && response && !response.ok && response.code === 'authentication_required') {
        const replacement = await refreshExtensionAccessToken();
        if (replacement) {
          activeAuthToken = replacement;
          response = await analyze(activeAuthToken);
        }
      }
      if (revision !== workflowRevisionRef.current) return;
      if (!response) throw new Error('No response from ChartViz. Reload the extension and try again.');
      if (!response.ok) {
        if (response.code && ['community_connection_required', 'community_token_rejected', 'community_unreachable'].includes(response.code)) {
          setCommunityConnection({ connected: false, hasStoredToken: response.code !== 'community_connection_required' });
          setFeatures(null);
        }
        setPricingUrl(response.pricingUrl ?? '');
        if (response.code === 'authorization_account_mismatch' || response.code === 'extension_update_required') {
          await logoutExtension();
          setAuthUser(null);
          setAuthModalOpen(true);
          throw new Error(response.code === 'authorization_account_mismatch' ? t.accountMismatch : t.extensionUpdateRequired);
        }
        if (response.code === 'authentication_required') {
          setAuthUser(null);
          throw new Error(language === 'zh-CN' ? 'ChartViz 授权已过期，请重新登录。' : 'Your ChartViz authorization has expired. Sign in again.');
        }
        throw new Error(response.error);
      }
      const requestId = response.task.requestId;
      setActiveRequestId(requestId);
      let finished = false;
      let consecutivePollingFailures = 0;
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if (revision !== workflowRevisionRef.current) return;
        if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 1500));
        let taskResponse: AnalysisTaskResponse | null;
        try {
          taskResponse = (await browser.runtime.sendMessage({
            type: 'chartviz/analysis-task/get', requestId,
            ...(features?.cloudAccount
              ? { authToken: activeAuthToken, authUserId: expectedAuthUserId, extensionVersion }
              : {}),
          } satisfies GetAnalysisTaskMessage)) as AnalysisTaskResponse | null;
        } catch (pollingError) {
          consecutivePollingFailures += 1;
          if (consecutivePollingFailures < 8) continue;
          throw pollingError;
        }
        if (!taskResponse) throw new Error('No response from ChartViz. Reload the extension and try again.');
        if (!taskResponse.ok) {
          if (taskResponse.code && ['community_connection_required', 'community_token_rejected', 'community_unreachable'].includes(taskResponse.code)) {
            setCommunityConnection({ connected: false, hasStoredToken: taskResponse.code !== 'community_connection_required' });
            setFeatures(null);
            throw new Error(taskResponse.error);
          }
          if (features?.cloudAccount && taskResponse.code === 'authentication_required') {
            const replacement = await refreshExtensionAccessToken();
            if (replacement) {
              activeAuthToken = replacement;
              consecutivePollingFailures += 1;
              continue;
            }
            setAuthUser(null);
            throw new Error(language === 'zh-CN' ? 'ChartViz 授权已过期，请重新登录。' : 'Your ChartViz authorization has expired. Sign in again.');
          }
          consecutivePollingFailures += 1;
          if (/failed to fetch|network|load failed/i.test(taskResponse.error) && consecutivePollingFailures < 8) continue;
          throw new Error(taskResponse.error);
        }
        consecutivePollingFailures = 0;
        setProgressEvents(taskResponse.task.progressEvents ?? []);
        if (taskResponse.task.status === 'cancel_requested') {
          setState('cancelling');
          continue;
        }
        if (taskResponse.task.status === 'cancelled') {
          setState('cancelled');
          finished = true;
          break;
        }
        if (taskResponse.task.status === 'failed') {
          throw new Error(taskResponse.task.error === 'invalid_chart_image' ? t.invalidChartImage : taskResponse.task.error || 'Analysis failed.');
        }
        if (taskResponse.task.status === 'completed') {
          if (revision !== workflowRevisionRef.current) return;
          if (!taskResponse.task.report) throw new Error('The completed analysis has no report.');
          const parsedReport = analysisReportSchema.safeParse(taskResponse.task.report);
          if (!parsedReport.success) {
            throw new Error(language === 'zh-CN'
              ? '分析服务返回了不兼容的结果，请稍后重试或更新 ChartViz。'
              : 'The analysis service returned an incompatible result. Try again shortly or update ChartViz.');
          }
          setAnalysis({ requestId, context: taskResponse.task.context, report: sanitizeAnalysisReportForDisplay(parsedReport.data) });
          setState('completed');
          finished = true;
          break;
        }
      }
      if (!finished) throw new Error('Analysis is taking longer than expected. Please try again.');
    } catch (caught) {
      if (revision !== workflowRevisionRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Analysis failed.'); setState('failed');
    }
  }

  async function cancelAnalysis() {
    if (!activeRequestId || (features?.cloudAccount && !authUser) || !window.confirm(t.cancelConfirm)) return;
    setState('cancelling');
    setError('');
    try {
      const activeAuthToken = features?.cloudAccount ? (await accessToken() ?? undefined) : undefined;
      if (features?.cloudAccount && !activeAuthToken) throw new Error(language === 'zh-CN' ? 'ChartViz 授权已过期，请重新登录。' : 'Your ChartViz authorization has expired. Sign in again.');
      const response = (await browser.runtime.sendMessage({
        type: 'chartviz/analysis-task/cancel',
        requestId: activeRequestId,
        ...(features?.cloudAccount ? {
          authToken: activeAuthToken,
          authUserId: authUser!.id,
          extensionVersion: browser.runtime.getManifest().version,
        } : {}),
      } satisfies CancelAnalysisTaskMessage)) as AnalysisTaskResponse | null;
      if (!response) throw new Error('No response from ChartViz. Reload the extension and try again.');
      if (!response.ok) throw new Error(response.error);
      setProgressEvents(response.task.progressEvents ?? []);
      if (response.task.status === 'cancelled') setState('cancelled');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel analysis.');
      setState('analyzing');
    }
  }

  async function closePanel() {
    if (panelBridge) panelBridge.close();
    else window.parent.postMessage({ source: 'chartviz', type: 'panel-close' }, '*');
    await browser.runtime.sendMessage({
      type: 'chartviz/active-panel/close',
    } satisfies CloseFloatingPanelMessage).catch(() => undefined);
  }

  async function signOut() {
    await logoutExtension();
    setAccountMenuOpen(false);
    setAuthUser(null);
  }

  async function disconnectCommunity() {
    const response = await browser.runtime.sendMessage({
      type: 'chartviz/community-connection/disconnect',
    } satisfies DisconnectCommunityConnectionMessage) as CommunityConnectionResponse | undefined;
    if (!response?.ok) {
      setError(response?.message ?? 'Unable to disconnect the Community backend.');
      return;
    }
    workflowRevisionRef.current += 1;
    setAccountMenuOpen(false);
    setCommunityConnection(response.connection);
    setFeatures(null);
    setContext(null);
    setPreview('');
    setAnalysis(null);
    setState('ready');
  }

  async function authenticated(user: ExtensionUser) {
    setAuthUser(user);
    setAuthChecked(true);
    setAuthModalOpen(false);
    setError('');
    if (user.preferredLanguage) {
      setLanguage(user.preferredLanguage);
      await browser.storage.local.set({ [LANGUAGE_STORAGE_KEY]: user.preferredLanguage });
    }
    const settings = await extensionSettings();
    const frames = validMultiTimeframes(settings?.multi_frame);
    if (frames) {
      setMultiTimeframes(frames);
      await browser.storage.local.set({ [MULTI_FRAME_STORAGE_KEY]: frames });
    }
  }

  function signIn() { setError(''); setPricingUrl(''); setAuthModalOpen(true); }

  function startPanelDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    dragPositionRef.current = { x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanel(event: ReactPointerEvent<HTMLElement>) {
    const previous = dragPositionRef.current;
    if (!previous) return;
    const dx = event.screenX - previous.x;
    const dy = event.screenY - previous.y;
    dragPositionRef.current = { x: event.screenX, y: event.screenY };
    if (panelBridge) panelBridge.drag(dx, dy);
    else window.parent.postMessage({ source: 'chartviz', type: 'panel-drag', dx, dy }, '*');
  }

  function stopPanelDrag() {
    dragPositionRef.current = null;
  }

  async function downloadAnnotatedImage(drawings: DrawingInstruction[], groupId: string) {
    if (!preview || !report) return;
    const image = new Image();
    image.src = preview;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context2d = canvas.getContext('2d');
    if (!context2d) return;
    context2d.drawImage(image, 0, 0);
    drawings.forEach((drawing) => drawOnCanvas(context2d, drawing, canvas.width, canvas.height));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const instrument = analysis?.context.symbol?.replace(/[^a-z0-9_-]+/gi, '-') || 'chart';
    link.href = url; link.download = `chartviz-${instrument}-${groupId}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function expandAnnotatedImage(drawings: DrawingInstruction[]) {
    if (!preview || !report) return;
    const image = new Image();
    image.src = preview;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context2d = canvas.getContext('2d');
    if (!context2d) return;
    context2d.drawImage(image, 0, 0);
    drawings.forEach((drawing) => drawOnCanvas(context2d, drawing, canvas.width, canvas.height));
    const dataUrl = canvas.toDataURL('image/png');
    if (panelBridge) panelBridge.preview(dataUrl);
    else window.parent.postMessage({ source: 'chartviz', type: 'image-preview', dataUrl }, '*');
  }

  function expandPreviewImage(dataUrl: string) {
    if (panelBridge) panelBridge.preview(dataUrl);
    else window.parent.postMessage({ source: 'chartviz', type: 'image-preview', dataUrl }, '*');
  }

  async function openHistoricalAnalysis(requestId: string) {
    const [task, image] = await Promise.all([
      extensionAnalysisTask(requestId),
      extensionAnalysisImage(requestId),
    ]);
    if (task.status !== 'completed' || !task.report) throw new Error('analysis_not_completed');
    const parsedReport = analysisReportSchema.safeParse(task.report);
    if (!parsedReport.success) throw new Error('incompatible_analysis');
    const historicalContext = task.context as unknown as ChartContext;
    workflowRevisionRef.current += 1;
    setContext(historicalContext);
    setAnalysis({ requestId, context: historicalContext, report: sanitizeAnalysisReportForDisplay(parsedReport.data) });
    setPreview(image ?? '');
    setCaptures([]);
    setProgressEvents(task.progressEvents ?? []);
    setError('');
    setPricingUrl('');
    setState('completed');
  }

  const connectionHeader = <header className="drag-handle" onPointerDown={startPanelDrag} onPointerMove={movePanel} onPointerUp={stopPanelDrag} onPointerCancel={stopPanelDrag}>
    <div className="brand community-brand"><Logo /><div><h1>ChartViz Community</h1><p className="slogan">{t.slogan}</p></div></div>
    <div className="header-actions" onPointerDown={(event) => event.stopPropagation()}>
      <div className="language-picker" ref={languagePickerRef}>
        <button className="toolbar-button language-button" aria-label={t.language} aria-haspopup="menu" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen((open) => !open)}>
          <span>{LANGUAGE_OPTIONS.find((option) => option.value === language)?.flag}</span><span>{LANGUAGE_OPTIONS.find((option) => option.value === language)?.code}</span><span className="language-chevron">⌄</span>
        </button>
        {languageMenuOpen && <div className="language-menu" role="menu">{LANGUAGE_OPTIONS.map((option) => <button key={option.value} className={option.value === language ? 'selected' : ''} role="menuitemradio" aria-checked={option.value === language} onClick={() => changeLanguage(option.value)}><span>{option.flag}</span><span>{option.code}</span><span className="language-check">{option.value === language ? '✓' : ''}</span></button>)}</div>}
      </div>
      <button className="toolbar-button close-button" title={t.close} aria-label={t.close} onClick={closePanel}><CloseIcon /></button>
    </div>
  </header>;

  if (!backendChecked) {
    return <main>{EXTENSION_EDITION === 'community' ? connectionHeader : null}<section className="backend-loading" role="status">{language === 'zh-CN' ? '正在连接后端…' : 'Connecting to backend…'}</section></main>;
  }

  if (EXTENSION_EDITION === 'community' && !communityConnection?.connected) {
    return <main>{connectionHeader}<CommunityConnectionPanel
      language={language}
      initialConnection={communityConnection ?? undefined}
      onConnected={(connection) => {
        setCommunityConnection(connection);
        if (connection.capabilities) {
          setFeatures(deriveExtensionFeatures('community', connection.capabilities));
          setError('');
          void inspectChart();
        }
      }}
    /></main>;
  }

  if (!features) {
    return <main><section className="error">{error || (language === 'zh-CN' ? '无法连接分析服务。' : 'Unable to connect to the analysis service.')}</section></main>;
  }

  const report = analysis?.report;
  const planName = authUser?.plan === 'advance' ? 'Advance' : authUser?.plan === 'pro' ? 'Pro' : 'Free';
  const planExpiration = authUser?.currentPeriodEnd
    ? new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(authUser.currentPeriodEnd))
    : null;
  return (
    <main>
      {features.cloudAccount && authModalOpen && <ExtensionAuthPanel language={language} initialUser={authUser} onUserChanged={setAuthUser} onAuthenticated={authenticated} onClose={() => setAuthModalOpen(false)} />}
      {features.analysisList && analysisListOpen && <AnalysisListPanel language={language} onClose={() => setAnalysisListOpen(false)} onOpen={openHistoricalAnalysis} />}
      {features.modelSelection && modelSettingsOpen && <ModelSettingsPanel language={language} onClose={() => setModelSettingsOpen(false)} />}
      {features.multiTimeframe && timeframeSettingsOpen && <TimeframeSettingsPanel language={language} initialFrames={multiTimeframes} onClose={() => setTimeframeSettingsOpen(false)} onSaved={async (frames) => {
        setMultiTimeframes(frames);
        await browser.storage.local.set({ [MULTI_FRAME_STORAGE_KEY]: frames });
      }} />}
      <header className="drag-handle" onPointerDown={startPanelDrag} onPointerMove={movePanel} onPointerUp={stopPanelDrag} onPointerCancel={stopPanelDrag}>
        {features.cloudAccount ? <a className="brand" href="https://www.chartviz.xyz/" target="_blank" rel="noopener noreferrer" aria-label="Open ChartViz website" onPointerDown={(event) => event.stopPropagation()}>
          <Logo />
          <div><h1>ChartViz</h1><p className="slogan">{t.slogan}</p></div>
        </a> : <div className="brand community-brand"><Logo /><div><h1>ChartViz Community</h1><p className="slogan">{t.slogan}</p></div></div>}
        <div className="header-actions" onPointerDown={(event) => event.stopPropagation()}>
          <div className="language-picker" ref={languagePickerRef}>
            <button className="toolbar-button language-button" title={LANGUAGE_OPTIONS.find((option) => option.value === language)?.label} aria-label={t.language} aria-haspopup="menu" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen((open) => !open)}>
              <span>{LANGUAGE_OPTIONS.find((option) => option.value === language)?.flag}</span><span>{LANGUAGE_OPTIONS.find((option) => option.value === language)?.code}</span><span className="language-chevron">⌄</span>
            </button>
            {languageMenuOpen && <div className="language-menu" role="menu">
              {LANGUAGE_OPTIONS.map((option) => <button key={option.value} className={option.value === language ? 'selected' : ''} role="menuitemradio" aria-checked={option.value === language} onClick={() => changeLanguage(option.value)}>
                <span>{option.flag}</span><span>{option.code}</span><span className="language-check">{option.value === language ? '✓' : ''}</span>
              </button>)}
            </div>}
          </div>
          <button className={`toolbar-button reload-button${state === 'inspecting' ? ' is-loading' : ''}`} disabled={state === 'inspecting'} title={t.reload} aria-label={t.reload} onClick={() => void inspectChart()}><ReloadIcon /></button>
          {features.cloudAccount && authUser && <div className="account-picker" ref={accountPickerRef}>
            <button className="toolbar-button account-button" title={authUser.email} aria-label={t.account} aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{(authUser.nickname?.trim()[0] || authUser.email[0] || 'U').toUpperCase()}</button>
            {accountMenuOpen && <div className="account-menu" role="menu">
              <div className="account-menu-identity">
                <span>{t.currentAccount}</span>
                <strong title={authUser.email}>{authUser.email}</strong>
                <div className="account-plan">
                  <span>{t.plan}</span><b className={`account-plan-badge plan-${authUser.plan}`}>{planName}</b>
                  {authUser.plan !== 'free' && planExpiration && <><span>{t.expires}</span><time dateTime={authUser.currentPeriodEnd ?? undefined}>{planExpiration}</time></>}
                </div>
              </div>
              <div className="account-menu-section account-menu-navigation">
                <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setAnalysisListOpen(true); }}><HistoryIcon /><span>{t.analysisList}</span><i>›</i></button>
              </div>
              <div className="account-menu-section">
                <span className="account-menu-label">{t.settings}</span>
                <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setModelSettingsOpen(true); }}><ModelIcon /><span>{t.modelSettings}</span><i>›</i></button>
                <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setTimeframeSettingsOpen(true); }}><TimeframeIcon /><span><b>{t.timeframeSettings}</b><small>{multiTimeframes.join(' · ')}</small></span><i>›</i></button>
              </div>
              <button className="account-menu-signout" type="button" role="menuitem" onClick={() => void signOut()}><LogoutIcon /><span>{t.logout}</span></button>
            </div>}
          </div>}
          {!features.cloudAccount && communityConnection?.connected && <div className="account-picker" ref={accountPickerRef}>
            <button className="toolbar-button community-backend-button" aria-label="Community backend" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>Local</button>
            {accountMenuOpen && <div className="account-menu community-backend-menu" role="menu">
              <div className="account-menu-identity"><span>Backend</span><strong>{communityConnection.baseUrl}</strong><div className="account-plan"><span>Model</span><b>{communityConnection.modelId}</b></div></div>
              <button className="account-menu-signout" type="button" role="menuitem" onClick={() => void disconnectCommunity()}><LogoutIcon /><span>{language === 'zh-CN' ? '断开后端' : 'Disconnect backend'}</span></button>
            </div>}
          </div>}
          <button className="toolbar-button close-button" title={t.close} aria-label={t.close} onClick={closePanel}><CloseIcon /></button>
        </div>
      </header>

      {context && <ChartIdentity context={context} language={language} />}
      {report && preview && <section className="original-screenshot"><h2>{t.originalScreenshot}</h2>{captures.length > 1 ? <div className="timeframe-previews">{captures.map((capture) => <div className="preview-stage zoomable" role="button" tabIndex={0} key={capture.timeframe} onClick={() => expandPreviewImage(capture.previewDataUrl)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') expandPreviewImage(capture.previewDataUrl); }}><b>{capture.timeframe}</b><img className="preview" src={capture.previewDataUrl} alt={`${t.originalScreenshot} ${capture.timeframe}`} /></div>)}</div> : <div className="preview-stage zoomable" role="button" tabIndex={0} onClick={() => expandPreviewImage(preview)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') expandPreviewImage(preview); }}><img className="preview" src={preview} alt={t.originalScreenshot} /></div>}</section>}
      {state !== 'completed' && <div className="capture-workflow">
        {context && <section className="capture-source">
          <h2>{t.screenshotSource}</h2>
          <div className={`mode-switch${features.multiTimeframe && supportsMultiTimeframeAnalysis(context.site) ? '' : ' single-only'}`} role="group" aria-label={t.screenshotSource}>
            <button className={analysisMode === 'single' ? 'active' : ''} onClick={() => changeAnalysisMode('single')}><b>{t.singlePeriod}</b><span>{t.singlePeriodNote}</span></button>
            {features.multiTimeframe && supportsMultiTimeframeAnalysis(context.site) && <button className={analysisMode === 'multi' ? 'active' : ''} onClick={() => changeAnalysisMode('multi')}><b>{t.multiPeriod}</b><span className="mode-timeframes">{t.multiPeriodNote}: {multiTimeframes.join(' · ')}<i className="timeframe-help" aria-label={t.timeframeSettingsHelp} data-tooltip={t.timeframeSettingsHelp}>?</i></span></button>}
          </div>
          {features.multiTimeframe && analysisMode === 'multi' && supportsMultiTimeframeAnalysis(context.site) && <p className="capture-warning" role="status">⚠ {t.multiPeriodFlicker}</p>}
        </section>}
        {state === 'capturing' && <p className="chart-readiness-status" role="status"><span aria-hidden="true" />{t.chartReadinessStatus}</p>}
        {error && <section className="error">{error}{pricingUrl && <a href={pricingUrl} target="_blank" rel="noopener noreferrer">{language === 'zh-CN' ? '查看套餐' : 'View plans'}</a>}</section>}
        {preview && <section><h2>{t.preview}</h2><p className="muted">{analysisMode === 'multi' ? t.multiPreviewHelp : t.previewHelp}</p>{captures.length > 1 ? <div className="timeframe-previews">{captures.map((capture) => <div className={`preview-stage zoomable${state === 'analyzing' || state === 'cancelling' ? ' is-analyzing' : ''}`} role="button" tabIndex={0} key={capture.timeframe} onClick={() => expandPreviewImage(capture.previewDataUrl)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') expandPreviewImage(capture.previewDataUrl); }}><b>{capture.timeframe}</b><img className="preview" src={capture.previewDataUrl} alt={`${t.previewAlt} ${capture.timeframe}`} />{(state === 'analyzing' || state === 'cancelling') && <div className="analysis-mask" aria-hidden="true"><div className="scan-beam" /></div>}</div>)}</div> : <div className={`preview-stage zoomable${state === 'analyzing' || state === 'cancelling' ? ' is-analyzing' : ''}`} role="button" tabIndex={0} aria-busy={state === 'analyzing' || state === 'cancelling'} onClick={() => expandPreviewImage(preview)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') expandPreviewImage(preview); }}><img className="preview" src={preview} alt={t.previewAlt} />{(state === 'analyzing' || state === 'cancelling') && <div className="analysis-mask" aria-hidden="true"><div className="scan-beam" /></div>}</div>}{(state === 'analyzing' || state === 'cancelling') && <AnalysisActivity events={progressEvents} language={language} />}{state === 'cancelled' && <p className="analysis-cancelled-message" role="status">{t.cancelled}</p>}</section>}

        {!preview ? <button className="primary" disabled={state === 'inspecting' || state === 'capturing'} onClick={context ? capturePreview : inspectChart}>
          {state === 'inspecting' ? t.identifying : state === 'capturing' ? t.capturing : context ? (analysisMode === 'multi' ? t.captureMulti : t.capture) : t.retry}
        </button> : state === 'analyzing' || state === 'cancelling' ? <div className="analysis-running-actions"><button className="primary" disabled>{state === 'cancelling' ? t.cancellingAnalysis : t.analyzing}</button><button className="secondary cancel-analysis" disabled={state === 'cancelling' || !activeRequestId} onClick={() => void cancelAnalysis()}>{state === 'cancelling' ? t.cancellingAnalysis : t.cancelAnalysis}</button></div> : <button className="primary" onClick={() => void startAnalysis()}>{!features.cloudAccount || authUser?.onboardingComplete ? (analysisMode === 'multi' ? t.analyzeMulti : t.analyze) : t.signIn}</button>}

        {features.cloudAccount && context && authChecked && !authUser?.onboardingComplete && <div className="capture-auth-overlay" aria-label={t.login}>
          <button className="primary capture-auth-login" onClick={signIn}>{t.login}</button>
        </div>}
      </div>}

      {report && <>
        <DecisionCard report={report} language={language} />
        {report.timeframeAnalyses.length > 1 && <section><h2>{t.timeframeViews}</h2><div className="timeframe-results">{report.timeframeAnalyses.map((item) => <article key={item.timeframe}><header><b>{item.timeframe}</b><span>{t[item.decision]} · {Math.round(item.confidence * 100)}%</span></header><h3>{localizeMetric(item.trend, language)} · {localizeMetric(item.structure, language)}</h3><p>{item.summary}</p><ul>{item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></article>)}</div></section>}
        <section className="market-explanation"><h2>{t.marketExplanation}</h2><p><b>{t.trend}:</b> {localizeMetric(report.marketReading.trend, language)}</p><p><b>{t.structure}:</b> {localizeMetric(report.marketReading.structure, language)}</p>{report.marketState.currentLocation && <p><b>{t.currentLocation}:</b> {report.marketState.currentLocation}</p>}{report.marketReading.evidence.map((item,index)=><p key={index}>{item.claim} — {item.visualEvidence}</p>)}{report.insights.filter(item => !(report.volumeAnalysis && item.kind === 'volume')).map(item=><p key={item.label}><b>{item.label}:</b> {item.evidence}</p>)}{report.volumeAnalysis && report.volumeAnalysis.observations.length > 0 && <div className="volume-explanation"><h3>{t.volumePrice}</h3>{report.volumeAnalysis.observations.map((item,index)=><p key={`volume-${index}`}><b>{item.claim}:</b> {item.visualEvidence}</p>)}</div>}{report.positioningEvidence.map((item,index)=><p key={`positioning-${index}`}><b>{language === 'zh-CN' ? (item.kind === 'liquidation_cluster' ? '清算分布' : '成本分布') : (item.kind === 'liquidation_cluster' ? 'Liquidation distribution' : 'Cost distribution')}:</b> {item.priceLabel ? `${item.priceLabel} · ` : ''}{item.observation} — {item.marketImplication}</p>)}{report.indicatorReadings.length > 0 && <div className="indicator-explanation"><h3>{t.indicatorsTitle}</h3>{report.indicatorReadings.map(indicator=><p key={indicator.id}><b>{indicator.name}:</b> {indicator.state} — {indicator.signals.join(' · ')}</p>)}</div>}</section>
        {groupReportDrawings(report).filter(group => group.id === 'structure').map((group) => <section key={group.id}><h2>{t.annotationStructure}</h2><div className="preview-stage zoomable" role="button" tabIndex={0} onClick={() => void expandAnnotatedImage(group.drawings)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void expandAnnotatedImage(group.drawings); }}><img className="preview" src={preview} alt={t.annotationStructure} /><DrawingPreview drawings={group.drawings} /></div><button className="secondary download-image" onClick={() => void downloadAnnotatedImage(group.drawings, group.id)}>{t.downloadImage}</button></section>)}
        {report.zones.some(zone => zone.type === 'support' || zone.type === 'resistance') && <section><h2>{t.keyLevels}</h2><div className="level-list visual-levels">{report.zones.filter(zone => zone.type === 'support' || zone.type === 'resistance').map((zone) => { const figure = zoneFigure(report, zone.id); return <article className={zone.type} key={zone.id}><span>{localizeMetric(zone.type, language)}<em>{localizeMetric(zone.tier, language)}</em>{figure && <i>{figure}</i>}</span><strong>{zone.band.label}</strong><small>{t.levelStatus}: {localizeMetric(zone.status, language)}{zone.timeframe ? ` · ${t.timeframeRole}: ${zone.timeframe}` : ''} · {t.zoneScore}: {zone.score} / 8</small>{zone.scoreFactors.length > 0 && <p>{zone.scoreFactors.join(' · ')}</p>}</article>; })}</div></section>}
        {groupReportDrawings(report).filter(group => group.id === 'levels').map((group) => <section key={group.id}><h2>{t.annotationLevels}</h2><div className="preview-stage zoomable" role="button" tabIndex={0} onClick={() => void expandAnnotatedImage(group.drawings)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void expandAnnotatedImage(group.drawings); }}><img className="preview" src={preview} alt={t.annotationLevels} /><DrawingPreview drawings={group.drawings} /></div><button className="secondary download-image" onClick={() => void downloadAnnotatedImage(group.drawings, group.id)}>{t.downloadImage}</button></section>)}
        <StructuredSetupCard report={report} language={language} />
        {report.tradeSignals.length > 0 && <section><h2>{t.tradeSignals}</h2><div className="trade-signals">{report.tradeSignals.map((signal) => { const drawings = tradeSignalDrawings(report, signal.drawingRefs); return <article className={signal.direction} key={signal.id}><header><b>{signal.id} · {t[signal.direction]}</b><span>{signal.timeframe} · {Math.round(signal.confidence * 100)}%</span></header><h3>{signal.signalType}</h3><p><b>{t.signalTime}:</b> {signal.signalTime}</p><p><b>{t.setupAtSignal}:</b> {signal.thesisAtSignal}</p><ul>{signal.evidenceAtSignal.map((item) => <li key={item}>{item}</li>)}</ul><p><b>{t.entryPlan}:</b> {signal.entry}</p><p><b>{t.stopLoss}:</b> {signal.stopLoss}</p><p><b>{t.takeProfit}:</b> {signal.takeProfits.join(' · ')}</p>{signal.riskReward && <p><b>{t.riskReward}:</b> {signal.riskReward}</p>}<small>{t.cutoff}: {signal.cutoffPoint}{signal.figureRefs.length ? ` · ${signal.figureRefs.join(' ')}` : ''}</small>{drawings.length > 0 && <div className="signal-annotation"><h3>{t.annotationSignals} · {signal.id}</h3><div className="preview-stage zoomable" role="button" tabIndex={0} onClick={() => void expandAnnotatedImage(drawings)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void expandAnnotatedImage(drawings); }}><img className="preview" src={preview} alt={`${t.annotationSignals} ${signal.id}`} /><DrawingPreview drawings={drawings} /></div><button className="secondary download-image" onClick={() => void downloadAnnotatedImage(drawings, `signals-${signal.id}`)}>{t.downloadImage}</button></div>}</article>; })}</div></section>}
        {report.patterns.length > 0 && <section className="report-section pattern-section">
          <h2>{t.patterns}</h2>
          {report.patterns.map((pattern) => <article className="pattern" key={`${pattern.name}-${pattern.timeRange}`}><h3>{pattern.name}<span>{localizeMetric(pattern.status, language)} · {Math.round(pattern.confidence * 100)}%{pattern.figureRefs.length ? ` · ${pattern.figureRefs.join(' ')}` : ''}</span></h3><p>{pattern.timeRange}</p><p>{pattern.evidence}</p><p><b>{t.confirmation}:</b> {pattern.confirmation}</p><p><b>{t.invalidation}:</b> {pattern.invalidation}</p></article>)}
          {groupReportDrawings(report).filter(group => group.id === 'patterns').map((group) => <div className="pattern-annotation" key={group.id}><h3>{t.annotationPatterns}</h3><div className="preview-stage zoomable" role="button" tabIndex={0} onClick={() => void expandAnnotatedImage(group.drawings)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void expandAnnotatedImage(group.drawings); }}><img className="preview" src={preview} alt={t.annotationPatterns} /><DrawingPreview drawings={group.drawings} /></div><button className="secondary download-image" onClick={() => void downloadAnnotatedImage(group.drawings, group.id)}>{t.downloadImage}</button></div>)}
        </section>}
        <footer>{report.riskNotice}</footer>
      </>}
    </main>
  );
}

function AnalysisActivity({ events, language }: { events: AnalysisProgressEvent[]; language: Language }) {
  const visible = visibleAnalysisProgress(events, language);
  const items = visible.length ? visible : visibleAnalysisProgress([
    { code: 'preparing', createdAt: new Date().toISOString() },
  ], language);
  return <div className="analysis-activity" role="status" aria-live="polite" aria-atomic="false">
    {items.map((item, index) => {
      const current = index === items.length - 1;
      return <p className={current ? 'current' : 'complete'} key={`${item.code}-${item.createdAt}`}>
        <span aria-hidden="true">{current ? <i className="activity-dots"><b /><b /><b /></i> : '✓'}</span>
        {item.message}
      </p>;
    })}
  </div>;
}

function Logo() {
  return <svg className="logo" viewBox="0 0 40 40" role="img" aria-label="ChartViz logo"><rect width="40" height="40" rx="10" fill="currentColor" opacity=".16" /><path d="M10 27l7-8 5 4 8-11M10 31h20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="30" cy="12" r="2.5" fill="currentColor" /></svg>;
}

function LogoutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function HistoryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ModelIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="14" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="7" cy="17" r="2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

function TimeframeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="6" r="2" fill="#20242c" stroke="currentColor" strokeWidth="2" /><circle cx="15" cy="12" r="2" fill="#20242c" stroke="currentColor" strokeWidth="2" /><circle cx="11" cy="18" r="2" fill="#20242c" stroke="currentColor" strokeWidth="2" /></svg>;
}

function ReloadIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 6M19 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

const DRAWING_COLORS: Record<DrawingInstruction['tool'], string> = {
  support_line: '#22c55e', resistance_line: '#ef4444', support_zone: '#22c55e',
  resistance_zone: '#ef4444', trend_line: '#60a5fa', breakout_marker: '#22c55e',
  rejection_marker: '#f59e0b', time_marker: '#a78bfa', entry_line: '#38bdf8',
  stop_line: '#f97316', target_line: '#c084fc', note: '#facc15',
};

function DrawingPreview({ drawings }: { drawings: DrawingInstruction[] }) {
  return <svg className="drawing-preview" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{drawings.map((drawing) => <PreviewDrawing key={drawing.id} drawing={drawing} />)}</svg>;
}

function PreviewDrawing({ drawing }: { drawing: DrawingInstruction }) {
  const color = DRAWING_COLORS[drawing.tool];
  const first = drawing.points[0]!;
  const second = drawing.points[1];
  const left = (drawing.renderBounds?.leftRatio ?? 0) * 1000;
  const right = (drawing.renderBounds?.rightRatio ?? 1) * 1000;
  const topBound = (drawing.renderBounds?.topRatio ?? 0) * 1000;
  const bottomBound = (drawing.renderBounds?.bottomRatio ?? 1) * 1000;
  const x1 = (first.xRatio ?? drawing.renderBounds?.leftRatio ?? .5) * 1000; const y1 = first.yRatio * 1000;
  const horizontal = ['support_line', 'resistance_line', 'stop_line', 'target_line'].includes(drawing.tool);
  const labelX = horizontal || drawing.tool.endsWith('_zone') ? left + 10 : x1 + 10;
  const label = <text x={Math.max(12, labelX)} y={Math.max(35, y1 - 12)} fill={color} stroke="#111318" strokeWidth="8" paintOrder="stroke" fontSize="30" fontWeight="700">{drawing.label}</text>;
  if (drawing.tool.endsWith('_zone') && second) {
    const y2 = second.yRatio * 1000; const top = Math.min(y1, y2);
    return <g><rect x={left} y={top} width={right - left} height={Math.max(6, Math.abs(y2 - y1))} fill={color} fillOpacity=".14" stroke={color} strokeWidth="4" strokeDasharray="18 12" />{label}</g>;
  }
  if (drawing.tool === 'trend_line' && second) return <g><line x1={x1} y1={y1} x2={(second.xRatio ?? .5) * 1000} y2={second.yRatio * 1000} stroke={color} strokeWidth="5" />{label}</g>;
  if (drawing.tool === 'time_marker') return <g><line x1={x1} y1={topBound} x2={x1} y2={bottomBound} stroke={color} strokeWidth="4" strokeDasharray="18 12" />{label}</g>;
  if (drawing.tool === 'entry_line') {
    const direction = drawing.signalDirection ?? (/short|做空/i.test(drawing.label) ? 'short' : 'long');
    const arrow = entryArrowGeometry(y1 / 1000, topBound / 1000, bottomBound / 1000, direction);
    const tip = arrow.tipY * 1000;
    const halfWidth = arrow.halfWidthRatio * 1000;
    const entryLabel = <text x={Math.max(12, x1 + 12)} y={arrow.labelY * 1000} fill={color} stroke="#111318" strokeWidth="6" paintOrder="stroke" fontSize="22" fontWeight="700">{drawing.label}</text>;
    return <g><line x1={x1} y1={arrow.shaftY * 1000} x2={x1} y2={arrow.stemEndY * 1000} stroke={color} strokeWidth="5" strokeLinecap="round" /><path d={`M ${x1 - halfWidth} ${arrow.wingY * 1000} L ${x1} ${tip} L ${x1 + halfWidth} ${arrow.wingY * 1000}`} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{entryLabel}</g>;
  }
  if (drawing.tool.endsWith('_marker') || drawing.tool === 'note') return <g><circle cx={x1} cy={y1} r="14" fill={color} stroke="#111318" strokeWidth="6" />{label}</g>;
  return <g><line x1={left} y1={y1} x2={right} y2={y1} stroke={color} strokeWidth="5" strokeDasharray={drawing.tool === 'stop_line' ? '18 12' : undefined} />{label}</g>;
}

function drawOnCanvas(context: CanvasRenderingContext2D, drawing: DrawingInstruction, width: number, height: number) {
  const color = DRAWING_COLORS[drawing.tool];
  const points = drawing.points.map((point) => ({ x: (point.xRatio ?? .5) * width, y: point.yRatio * height }));
  const first = points[0]!; const second = points[1]; const lineWidth = Math.max(2, width / 500);
  const left = (drawing.renderBounds?.leftRatio ?? 0) * width;
  const right = (drawing.renderBounds?.rightRatio ?? 1) * width;
  const topBound = (drawing.renderBounds?.topRatio ?? 0) * height;
  const bottomBound = (drawing.renderBounds?.bottomRatio ?? 1) * height;
  context.save(); context.strokeStyle = color; context.fillStyle = color; context.lineWidth = lineWidth;
  if (drawing.tool.endsWith('_zone') && second) {
    const top = Math.min(first.y, second.y); context.globalAlpha = .18;
    context.fillRect(left, top, right - left, Math.max(3, Math.abs(second.y - first.y))); context.globalAlpha = 1;
    context.setLineDash([lineWidth * 4, lineWidth * 3]); context.strokeRect(left, top, right - left, Math.max(3, Math.abs(second.y - first.y)));
  } else if (drawing.tool === 'trend_line' && second) {
    context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y); context.stroke();
  } else if (drawing.tool === 'time_marker') {
    context.setLineDash([lineWidth * 4, lineWidth * 3]); context.beginPath(); context.moveTo(first.x, topBound); context.lineTo(first.x, bottomBound); context.stroke();
  } else if (drawing.tool === 'entry_line') {
    const direction = drawing.signalDirection ?? (/short|做空/i.test(drawing.label) ? 'short' : 'long');
    const arrow = entryArrowGeometry(first.y / height, topBound / height, bottomBound / height, direction);
    const tip = arrow.tipY * height;
    const halfWidth = arrow.halfWidthRatio * width;
    context.lineWidth = Math.max(2, Math.min(4, Math.min(width, height) / 180));
    context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath();
    context.moveTo(first.x, arrow.shaftY * height); context.lineTo(first.x, arrow.stemEndY * height);
    context.moveTo(first.x - halfWidth, arrow.wingY * height); context.lineTo(first.x, tip); context.lineTo(first.x + halfWidth, arrow.wingY * height); context.stroke();
  } else if (drawing.tool.endsWith('_marker') || drawing.tool === 'note') {
    context.beginPath(); context.arc(first.x, first.y, lineWidth * 4, 0, Math.PI * 2); context.fill();
  } else {
    if (drawing.tool === 'stop_line') context.setLineDash([lineWidth * 4, lineWidth * 3]);
    context.beginPath(); context.moveTo(left, first.y); context.lineTo(right, first.y); context.stroke();
  }
  const fontSize = drawing.tool === 'entry_line' ? Math.max(12, Math.min(18, width / 70)) : Math.max(14, width / 45); context.font = `700 ${fontSize}px sans-serif`;
  context.lineWidth = Math.max(3, fontSize / 4); context.strokeStyle = '#111318';
  const horizontal = ['support_line', 'resistance_line', 'stop_line', 'target_line'].includes(drawing.tool) || drawing.tool.endsWith('_zone');
  const labelX = Math.min(width - context.measureText(drawing.label).width - 6, Math.max(6, (horizontal ? left : first.x) + 8));
  const entryDirection = drawing.signalDirection ?? (/short|做空/i.test(drawing.label) ? 'short' : 'long');
  const labelY = drawing.tool === 'entry_line'
    ? entryArrowGeometry(first.y / height, topBound / height, bottomBound / height, entryDirection).labelY * height
    : Math.max(fontSize + 4, first.y - 8);
  context.strokeText(drawing.label, labelX, labelY);
  context.fillStyle = color; context.fillText(drawing.label, labelX, labelY); context.restore();
}

function ChartIdentity({ context, language }: { context: ChartContext; language: Language }) {
  const t = COPY[language];
  const rows = [[t.instrument, context.symbol ?? t.notDetected], [t.exchange, context.exchange ?? t.notDetected], [t.timeframe, context.timeframe ?? t.notDetected]];
  return <section><div className="section-heading"><h2>{t.tokenStock}</h2><span className="detected">{t.detected}</span></div><dl className="metadata">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return <article title={title}><span>{label}</span><strong>{value}</strong></article>;
}

function DecisionCard({ report, language }: { report: AnalysisEnvelope['report']; language: Language }) {
  const t = COPY[language];
  const summary = decisionSummary(report.decision.summary);
  return <section className={`decision decision-${report.decision.direction}`}>
    <div className="decision-heading"><div><span>{t.currentView}</span><h2>{localizeMetric(report.marketReading.trend, language)}</h2></div><strong>{Math.round(report.overallConfidence * 100)}%</strong></div>
    <div className="market-state-strip"><span><small>{t.marketRegime}</small><b>{marketRegimeLabel(report.marketState.regime, report.marketState.directionalBias, language)}</b></span><span><small>{t.structure}</small><b>{localizeMetric(report.marketState.structure, language)}</b></span></div>
    {summary && <p className="decision-summary">{summary}</p>}
    <p className="decision-risk"><b>{t.primaryRisk}:</b> {report.decision.primaryRisk}</p>
  </section>;
}

function StructuredSetupCard({ report, language }: { report: AnalysisEnvelope['report']; language: Language }) {
  const t = COPY[language];
  const setup = report.setupEvaluation;
  if (setup.playbook === 'none' || setup.actionability === 'NO_TRADE') return null;
  const gateItems = setup.pendingConditions;
  const r = effectiveRLabel(setup);
  return <section className={`structured-setup setup-${setup.actionability.toLowerCase().replace('_', '-')}`}>
    <header><div><span>{setup.actionability === 'WAIT' ? t.waitingConditions : t.tradePlan}</span><h2>{setup.direction ? t[setup.direction] : t.wait} · {setupLabel(setup.playbook, language)}</h2></div><b>{setupLabel(setup.actionability, language)}</b></header>
    <div className="setup-summary-grid">
      <div><small>{t.setupState}</small><strong>{setupLabel(setup.state, language)}</strong></div>
      {setup.location && <div><small>{t.currentLocation}</small><strong>{setup.location}</strong></div>}
      {priceBandLabel(setup.entry) && <div><small>{t.entryZone}</small><strong>{priceBandLabel(setup.entry)}</strong></div>}
      {r && <div><small>{t.effectiveR}</small><strong>{r}</strong><em>{t.feeSlippage}</em></div>}
    </div>
    {setup.premise && <p><b>{t.premise}:</b> {setup.premise}</p>}
    {(setup.trigger || setup.confirmation) && <p><b>{t.triggerConfirmation}:</b> {[setup.trigger, setup.confirmation].filter(Boolean).join(' → ')}</p>}
    {setup.structuralStop && <p><b>{t.structuralStop}:</b> {setup.structuralStop.band.label} · {setup.structuralStop.reason}{setup.structuralStop.buffer ? ` · ${setup.structuralStop.buffer}` : ''}</p>}
    {setup.targets.length > 0 && <div className="setup-targets"><b>{t.targets}</b>{setup.targets.map((target) => <span className={target.active ? 'active' : ''} key={target.tier}><i>{target.tier}</i><strong>{target.band.label}</strong><small>{targetSourceLabel(target.source, language)}</small></span>)}</div>}
    {gateItems.length > 0 && <div className="setup-gate"><b>{t.pendingConditions}</b><ul>{gateItems.map((item) => <li key={item}>{gateReason(item, language)}</li>)}</ul></div>}
  </section>;
}

function localizeMetric(value: string, language: Language): string {
  if (language === 'en') return ({ bullish: 'Rising', bearish: 'Falling', sideways: 'Ranging', unclear: 'Unclear', trend: 'Trend', range: 'Range', transition: 'Transition', insufficient: 'Insufficient evidence', 'hh-hl': 'Rising highs and lows', 'lh-ll': 'Falling highs and lows', support: 'Support', resistance: 'Resistance', breakout_trigger: 'Breakout trigger', breakdown_trigger: 'Breakdown trigger', nearest: 'Nearest', secondary: 'Secondary', major: 'Major', holding: 'Holding', testing: 'Being tested', broken: 'Broken', flip_candidate: 'Potential role reversal' } as Record<string, string>)[value] ?? value;
  const values: Record<string, string> = {
    bullish: '看多', bearish: '看空', sideways: '震荡', unclear: '不明确',
    neutral: '中性', trend: '趋势', range: '区间', transition: '结构转换', insufficient: '证据不足',
    support: '支撑', resistance: '阻力', breakout_trigger: '向上突破触发位', breakdown_trigger: '向下跌破触发位', trigger: '触发', invalidation: '失效', target: '目标',
    nearest: '最近', secondary: '次级', major: '主要', holding: '仍然有效', testing: '正在测试', broken: '已经突破/跌破', flip_candidate: '可能发生支阻转换',
    forming: '形成中', confirmed: '已确认', invalidated: '已失效',
    'hh-hl': '高点/低点抬高', 'lh-ll': '高点/低点降低',
  };
  return values[value] ?? value;
}

function EvidenceList({ items, none }: { items: string[]; none: string }) {
  if (items.length === 0) return <p className="muted">{none}</p>;
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
