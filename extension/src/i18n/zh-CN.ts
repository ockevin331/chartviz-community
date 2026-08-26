import type { TranslationKey } from './en';

export const zhCN: Record<TranslationKey, string> = {
  slogan: '智能识图，交易无界。',
  language: '语言', close: '关闭', refresh: '刷新', providerSetup: '连接你自己的视觉模型', providerSetupHelp: '首次分析前，先选择 ChartViz 读取图表截图的方式。',
  setupChooseModel: '选择一个支持图像输入的模型。', setupEnterKey: '输入你自己的 API 密钥。', setupDirectSend: 'ChartViz 会将截图直接发送给所选服务。',
  model: '模型', apiKey: 'API 密钥', showApiKey: '显示 API 密钥', hideApiKey: '隐藏 API 密钥', customModel: '自定义模型', customModelId: '自定义模型 ID', customModelHelp: '使用自定义 OpenRouter 模型 ID。', otherModels: '其他',
  useOpenRouter: '使用 OpenRouter', openRouterHelp: '一个 API 密钥即可使用不同提供商的模型。', openRouterRequired: '此模型需要 OpenRouter。',
  multimodalWarning: '自定义模型必须支持图像输入。纯文本模型无法分析图表截图。', sessionKeyPrivacy: '密钥仅保存在扩展会话中，截图会直接发送给所选服务。',
  connectionCost: '测试连接会向提供商发送请求并可能产生费用。', testConnection: '测试连接', testingConnection: '测试中…', connectionOk: '连接成功。', saveContinue: '保存并继续',
  invalid_config: '请检查 API 密钥和模型。', invalid_api_key: 'API 密钥无效。', model_not_found: '找不到所选模型。', model_not_multimodal: '所选模型不支持图像输入。', insufficient_balance: '提供商账户余额不足。', rate_limited: '已达到提供商速率限制。', invalid_image: '无法读取图表图片。', network_timeout: '提供商请求超时。', invalid_response: '提供商返回了无效报告。', cancelled: '分析已取消。', unknownError: '发生错误。',
  detectedChart: '已检测图表', detectedChartHelp: '确认当前图表信息后，ChartViz 将截取并开始分析。', waitingForChart: '正在等待图表…', captureAnalyze: '截图并分析', capturingChart: '正在截取图表…', refreshChartDetection: '重新检测图表', exchange: '交易所', notDetected: '未识别', chartUnavailable: '当前图表不可用', chartDetectionError: '无法检测当前图表。', chartCaptureError: '无法截取当前图表。', unsupportedChartHelp: '请打开受支持的图表页面，然后重新检测。', supportedSites: '支持的站点',
  preview: '截图预览', previewAlt: '图表已可分析', changeImage: '重新截图', analyze: '分析截图', cancel: '取消分析', backPreview: '返回预览', retry: '重试',
  reading_chart: '读取图表', organizing_evidence: '整理证据', preparing_result: '准备结果',
  original: '原始截图', zoom: '放大', download: '下载图片', copyReport: '复制报告', copied: '已复制',
  chart: '图表', instrument: '交易品种', timeframe: '周期', limitations: '局限', marketView: '市场观点', bias: '方向', phase: '阶段', strength: '强度', evidence: '证据', observation: '观察', implication: '含义', visibleAt: '图上位置', confidence: '置信度', volume: '成交量', indicators: '技术指标', supportResistance: '支撑与阻力', reason: '理由', scenarios: '情景计划', long: '做多', short: '做空', wait: '等待', condition: '条件', entry: '入场', stop: '止损', targets: '目标', patterns: '图表形态', status: '状态', timeRange: '可见范围', signals: '交易信号', direction: '方向', riskReward: '盈亏比', riskNotice: '风险提示', none: '无',
};
