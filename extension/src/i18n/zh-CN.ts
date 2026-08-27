import type { TranslationKey } from './en';

export const zhCN: Record<TranslationKey, string> = {
  slogan: '智能识图，交易无界。',
  language: '语言', close: '关闭', refresh: '刷新', settings: '设置', analysisSettings: '分析设置', analysisSettingsHelp: '查看或修改后续分析所使用的模型和连接。', providerSetup: '连接你自己的视觉模型', providerSetupHelp: '首次分析前，先选择 ChartViz 读取图表截图的方式。',
  setupChooseModel: '选择一个支持图像输入的模型。', setupEnterKey: '输入你自己的 API 密钥。', setupDirectSend: 'ChartViz 会将截图直接发送给所选服务。',
  model: '模型', apiKey: 'API 密钥', showApiKey: '显示 API 密钥', hideApiKey: '隐藏 API 密钥', customModel: '自定义模型', customModelId: '自定义模型 ID', customModelHelp: '使用自定义 OpenRouter 模型 ID。', otherModels: '其他',
  useOpenRouter: '使用 OpenRouter', openRouterHelp: '一个 API 密钥即可使用不同提供商的模型。', openRouterRequired: '此模型需要 OpenRouter。',
  multimodalWarning: '自定义模型必须支持图像输入。纯文本模型无法分析图表截图。', sessionKeyPrivacy: '密钥仅保存在扩展会话中，截图会直接发送给所选服务。',
  connectionCost: '测试连接会向提供商发送请求并可能产生费用。', testConnection: '测试连接', testingConnection: '测试中…', connectionOk: '连接成功。', saveContinue: '保存并继续', saveSettings: '保存设置',
  invalid_config: '请检查 API 密钥和模型。', invalid_api_key: 'API 密钥无效。', model_not_found: '找不到所选模型。', model_not_multimodal: '所选模型不支持图像输入。', insufficient_balance: '提供商账户余额不足。', rate_limited: '已达到提供商速率限制。', invalid_image: '无法读取图表图片。', network_timeout: '提供商请求超时。', invalid_response: '模型返回内容不符合报告格式，请重试或更换模型。', cancelled: '分析已取消。', unknownError: '发生错误。',
  detectedChart: '已检测图表', detectedChartHelp: '确认当前图表信息后，ChartViz 将截取并开始分析。', waitingForChart: '正在等待图表…', captureAnalyze: '截图并分析', capturingChart: '正在截取图表…', refreshChartDetection: '重新检测图表', exchange: '交易所', notDetected: '未识别', chartUnavailable: '当前图表不可用', chartDetectionError: '无法检测当前图表。', chartCaptureError: '无法截取当前图表。', unsupportedPage: '当前页面暂不支持', unsupportedChartHelp: '可在这里上传图表截图，或打开下方任一已支持站点的图表页面。', supportedSites: '支持的站点', uploadScreenshot: '上传 K 线截图', uploadingScreenshot: '正在处理截图…', uploadError: '无法读取这张截图。',
  preview: '截图预览', previewAlt: '图表已可分析', changeImage: '重新截图', analyze: '分析截图', cancel: '取消分析', backPreview: '返回预览', retry: '重试', viewDiagnostics: '查看诊断信息', hideDiagnostics: '收起诊断信息', copyDiagnostics: '复制诊断信息', diagnosticsCopied: '诊断信息已复制', diagnosticHelp: '问题再次出现时，请提供这份安全诊断。它不包含 API 密钥、截图、提示词或完整模型输出。', requestId: '请求 ID', failureStage: '失败阶段', duration: '耗时', issues: '校验问题',
  reading_chart: '读取图表', organizing_evidence: '审阅证据', preparing_result: '准备结果',
  original: '原始截图', zoom: '放大', download: '下载图片', copyReport: '复制报告', copied: '已复制',
  chart: '图表', instrument: '交易品种', timeframe: '周期', limitations: '局限', marketView: '市场观点', currentView: '当前观点', marketExplanation: '行情解读', tradePlan: '交易方案', priceAction: '价格变化', priceVolume: '量价解读', technicalIndicators: '技术指标解读', primaryRisk: '主要风险', trend: '当前走势', structure: '市场结构', bias: '方向', phase: '阶段', strength: '强度', evidence: '证据', observation: '观察', implication: '含义', visibleAt: '图上位置', confidence: '置信度', volume: '成交量', indicators: '技术指标', supportResistance: '支撑位与阻力位', levelTier: '级别', levelStatus: '状态', reason: '理由', scenarios: '情景计划', long: '做多', short: '做空', wait: '等待', condition: '条件', entry: '入场', stop: '止损', targets: '目标', patterns: '图表形态', status: '状态', timeRange: '可见范围', signals: '交易信号解读', signalType: '信号类型', signalTime: '信号时间', setupAtSignal: '当时的信号依据', confirmation: '确认条件', invalidation: '失效条件', direction: '方向', riskReward: '预计盈亏比', riskNotice: '风险提示', none: '无',
};
