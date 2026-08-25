import { useState } from 'react';

export function App() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const chinese = language === 'zh';

  return (
    <main className="panel">
      <img className="logo" src="/icons/chartviz-128.png" alt="ChartViz logo" />
      <div className="heading">
        <h1>ChartViz Community</h1>
        <button
          type="button"
          className="language-toggle"
          aria-label="Toggle language"
          onClick={() => setLanguage(chinese ? 'en' : 'zh')}
        >
          {chinese ? 'EN' : '中文'}
        </button>
      </div>
      <p>{chinese ? '全新 v1 基础环境已就绪。' : 'Clean v1 setup is ready.'}</p>
    </main>
  );
}
