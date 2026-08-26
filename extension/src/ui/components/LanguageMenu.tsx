import { useState } from 'react';
import { en } from '../../i18n/en';
import { zhCN } from '../../i18n/zh-CN';

export type Language = 'en' | 'zh-CN';
export const translations = { en, 'zh-CN': zhCN } as const;

const options = [
  { value: 'en' as const, flag: '🇺🇸', code: 'EN', label: 'English' },
  { value: 'zh-CN' as const, flag: '🇨🇳', code: 'CN', label: '简体中文' },
];

export function LanguageMenu({ language, onChange }: { language: Language; onChange(value: Language): void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(({ value }) => value === language)!;
  const t = translations[language];
  return <div className="language-picker">
    <button className="toolbar-button language-button" type="button" aria-label={t.language} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>{selected.flag}</span><span>{selected.code}</span><span className="language-chevron">⌄</span>
    </button>
    {open && <div className="language-menu" role="menu">{options.map((option) => <button type="button" role="menuitemradio" aria-checked={option.value === language} aria-label={`${option.flag} ${option.code} ${option.label}`} className={option.value === language ? 'selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.flag}</span><span>{option.code}</span><span className="language-check">{option.value === language ? '✓' : ''}</span></button>)}</div>}
  </div>;
}
