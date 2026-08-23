import { useState } from 'react';
import { updateExtensionSetting } from '../../src/api/extension-auth';
import {
  DEFAULT_MULTI_TIMEFRAMES,
  MULTI_TIMEFRAME_ROLE_OPTIONS,
  validMultiTimeframes,
} from '../../src/settings/multi-frame';
import type { SupportedCaptureTimeframe } from '../../src/domain/messages';

type Props = {
  language: 'en' | 'zh-CN';
  initialFrames: SupportedCaptureTimeframe[];
  onClose: () => void;
  onSaved: (frames: SupportedCaptureTimeframe[]) => void | Promise<void>;
};

const COPY = {
  en: {
    title: 'Multi-timeframe settings',
    intro: 'Choose one context, setup, and trigger timeframe for multi-timeframe analysis.',
    context: 'Context', setup: 'Setup', trigger: 'Trigger', save: 'Save timeframes', saving: 'Saving…',
    failed: 'Unable to save timeframe settings. Try again.', close: 'Close',
  },
  'zh-CN': {
    title: '多周期设置',
    intro: '为多周期分析分别选择背景、设置和触发周期。',
    context: '背景周期', setup: '设置周期', trigger: '触发周期', save: '保存周期', saving: '正在保存…',
    failed: '周期设置保存失败，请重试。', close: '关闭',
  },
} as const;

export function TimeframeSettingsPanel({ language, initialFrames, onClose, onSaved }: Props) {
  const t = COPY[language];
  const initial = validMultiTimeframes(initialFrames) ?? DEFAULT_MULTI_TIMEFRAMES;
  const [frames, setFrames] = useState<[SupportedCaptureTimeframe, SupportedCaptureTimeframe, SupportedCaptureTimeframe]>([
    initial[0]!, initial[1]!, initial[2]!,
  ]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function changeFrame(index: 0 | 1 | 2, value: SupportedCaptureTimeframe) {
    setFrames((current) => current.map((item, itemIndex) => itemIndex === index ? value : item) as typeof current);
    setFailed(false);
  }

  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      const settings = await updateExtensionSetting('multi_frame', frames);
      const savedFrames = validMultiTimeframes(settings?.multi_frame);
      if (!savedFrames) throw new Error();
      await onSaved(savedFrames);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="model-settings-modal" role="dialog" aria-modal="true" aria-labelledby="timeframe-settings-title">
      <div className="model-settings-card timeframe-settings-card">
        <button className="model-settings-close" type="button" aria-label={t.close} onClick={onClose}>×</button>
        <h2 id="timeframe-settings-title">{t.title}</h2>
        <p>{t.intro}</p>
        <div className="plugin-timeframe-options">
          {([0, 1, 2] as const).map((index) => (
            <label key={index}>
              <span>{[t.context, t.setup, t.trigger][index]}</span>
              <select disabled={saving} value={frames[index]} onChange={(event) => changeFrame(index, event.target.value as SupportedCaptureTimeframe)}>
                {Object.values(MULTI_TIMEFRAME_ROLE_OPTIONS)[index]?.map((option) => <option key={option} value={option} disabled={frames.some((frame, frameIndex) => frameIndex !== index && frame === option)}>{option}</option>)}
              </select>
            </label>
          ))}
        </div>
        {failed && <div className="model-settings-error" role="alert">{t.failed}</div>}
        <button className="primary model-settings-save" disabled={saving} onClick={() => void save()}>{saving ? t.saving : t.save}</button>
      </div>
    </div>
  );
}
