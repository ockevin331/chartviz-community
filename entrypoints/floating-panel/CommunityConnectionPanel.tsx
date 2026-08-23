import { useState, type FormEvent } from 'react';

import type { CommunityConnectionView } from '../../src/api/community-connection';
import type {
  CommunityConnectionResponse,
  TestCommunityConnectionMessage,
} from '../../src/domain/messages';

type Language = 'en' | 'zh-CN';

const COPY = {
  en: {
    title: 'Connect your Community backend',
    description: 'Chart images are sent directly to the backend you configure.',
    baseUrl: 'Backend URL', token: 'Local token', storedToken: 'Stored token',
    model: 'Model', showToken: 'Show token', hideToken: 'Hide token',
    testAndSave: 'Test and save', testing: 'Testing connection…',
  },
  'zh-CN': {
    title: '连接 Community 后端',
    description: 'K 线截图将直接发送到你配置的后端。',
    baseUrl: '后端地址', token: '本地 Token', storedToken: '已保存 Token',
    model: '模型', showToken: '显示 Token', hideToken: '隐藏 Token',
    testAndSave: '测试并保存', testing: '正在测试连接…',
  },
} as const;

const ERROR_COPY: Record<Language, Record<string, string>> = {
  en: {
    community_url_invalid: 'Enter a valid backend URL.',
    community_https_required: 'Remote backends must use HTTPS.',
    community_permission_denied: 'Website access was not granted for this backend.',
    community_token_invalid: 'Enter the local token (at least 24 characters).',
    community_token_rejected: 'The backend rejected this token.',
    community_unreachable: 'The Community backend could not be reached.',
    unexpected_backend_edition: 'This URL is not a Community backend.',
    incompatible_api_version: 'This backend API version is not compatible.',
    incompatible_report_schema: 'This backend report version is not compatible.',
  },
  'zh-CN': {
    community_url_invalid: '请输入有效的后端地址。',
    community_https_required: '远程后端必须使用 HTTPS。',
    community_permission_denied: '未授予访问该后端的站点权限。',
    community_token_invalid: '请输入本地 Token（至少 24 个字符）。',
    community_token_rejected: '后端拒绝了这个 Token。',
    community_unreachable: '无法连接 Community 后端。',
    unexpected_backend_edition: '该地址不是 Community 后端。',
    incompatible_api_version: '该后端 API 版本不兼容。',
    incompatible_report_schema: '该后端报告版本不兼容。',
  },
};

export type CommunityConnectionPanelProps = {
  language: Language;
  initialConnection?: CommunityConnectionView;
  onConnected(connection: CommunityConnectionView): void;
};

export function CommunityConnectionPanel({
  language,
  initialConnection,
  onConnected,
}: CommunityConnectionPanelProps) {
  const [baseUrl, setBaseUrl] = useState(
    initialConnection?.baseUrl ?? 'http://127.0.0.1:8000',
  );
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[language];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTesting(true);
    setError('');
    try {
      const response = await browser.runtime.sendMessage({
        type: 'chartviz/community-connection/test-and-save',
        baseUrl,
        token: token || undefined,
        reuseStoredToken: !token && Boolean(initialConnection?.hasStoredToken),
      } satisfies TestCommunityConnectionMessage) as CommunityConnectionResponse | undefined;
      if (!response) {
        setError(language === 'zh-CN' ? '后端没有响应。' : 'The backend did not respond.');
      } else if (response.ok) {
        setToken('');
        onConnected(response.connection);
      } else {
        setError(ERROR_COPY[language][response.code] ?? response.message);
      }
    } catch {
      setError(ERROR_COPY[language].community_unreachable!);
    } finally {
      setTesting(false);
    }
  }

  return <section className="community-connection-card">
    <h2>{copy.title}</h2>
    <p>{copy.description}</p>
    {initialConnection?.connected && <div className="community-connection-status">
      <span>{initialConnection.baseUrl}</span>
      {initialConnection.modelId && <><small>{copy.model}</small><b>{initialConnection.modelId}</b></>}
      {initialConnection.hasStoredToken && <em>{copy.storedToken}</em>}
    </div>}
    <form onSubmit={submit}>
      <label>{copy.baseUrl}
        <input name="baseUrl" type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <label>{copy.token}
        <span className="community-token-field">
          <input
            name="token"
            type={showToken ? 'text' : 'password'}
            minLength={24}
            required={!initialConnection?.hasStoredToken}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
          <button type="button" onClick={() => setShowToken((value) => !value)}>
            {showToken ? copy.hideToken : copy.showToken}
          </button>
        </span>
      </label>
      {error && <p className="community-connection-error" role="alert">{error}</p>}
      <button className="primary" disabled={testing}>
        {testing ? copy.testing : copy.testAndSave}
      </button>
    </form>
  </section>;
}
