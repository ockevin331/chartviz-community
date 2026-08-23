import { useEffect, useState } from 'react';
import {
  extensionAnalysisModels,
  updateExtensionSetting,
  type ExtensionModelCatalog,
} from '../../src/api/extension-auth';

type Props = {
  language: 'en' | 'zh-CN';
  onClose: () => void;
};

const COPY = {
  en: {
    title: 'Analysis model', intro: 'Shared with the ChartViz website. Different models use different quota per analysis.',
    recommended: 'Recommended', cost: 'per analysis', quota: 'quota', balance: 'Quota balance',
    unlimited: 'Unlimited', remaining: (left: number, limit: number) => `${left} of ${limit} remaining`,
    loading: 'Loading models…', failed: 'Unable to load model settings.', save: 'Save model', saving: 'Saving…',
  },
  'zh-CN': {
    title: '分析模型', intro: '与 ChartViz 网站共用。不同模型每次分析消耗的配额不同。',
    recommended: '推荐', cost: '单次消耗', quota: '配额', balance: '配额余额',
    unlimited: '不限量', remaining: (left: number, limit: number) => `剩余 ${left} / ${limit}`,
    loading: '正在加载模型…', failed: '无法读取模型设置。', save: '保存模型', saving: '正在保存…',
  },
} as const;

export function ModelSettingsPanel({ language, onClose }: Props) {
  const t = COPY[language];
  const [catalog, setCatalog] = useState<ExtensionModelCatalog | null>(null);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void extensionAnalysisModels().then((value) => {
      if (!value) { setFailed(true); return; }
      setCatalog(value);
      setSelected(value.selectedModel);
    }).catch(() => setFailed(true));
  }, []);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setFailed(false);
    try {
      const settings = await updateExtensionSetting('analysis_model', selected);
      if (!settings) throw new Error();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="model-settings-modal" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
      <div className="model-settings-card">
        <button className="model-settings-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="model-settings-title">{t.title}</h2>
        <p>{t.intro}</p>
        {!catalog && !failed && <div className="model-settings-state">{t.loading}</div>}
        {failed && <div className="model-settings-error" role="alert">{t.failed}</div>}
        {catalog && <>
          <aside className="plugin-quota-summary">
            <span>{t.balance} · {catalog.quota.plan.toUpperCase()}</span>
            <strong>{catalog.quota.unlimited ? t.unlimited : t.remaining(catalog.quota.remaining ?? 0, catalog.quota.limit ?? 0)}</strong>
          </aside>
          <div className="plugin-model-options">
            {catalog.models.map((model) => (
              <label className={selected === model.id ? 'selected' : ''} key={model.id}>
                <input type="radio" name="plugin-analysis-model" checked={selected === model.id} onChange={() => setSelected(model.id)} />
                <span><b>{model.name}</b><small>{model.provider}{model.recommended ? ` · ${t.recommended}` : ''}</small></span>
                <em>{t.cost}: {model.quotaCost} {t.quota}</em>
                <p>{language === 'zh-CN' ? model.descriptionZh : model.descriptionEn}</p>
              </label>
            ))}
          </div>
          <button className="primary model-settings-save" disabled={saving || !selected} onClick={() => void save()}>{saving ? t.saving : t.save}</button>
        </>}
      </div>
    </div>
  );
}
