import { useEffect, useState, type FormEvent } from 'react';
import {
  ExtensionAuthError,
  loginExtension,
  registerExtension,
  requestExtensionRegistrationCode,
  updateExtensionOnboarding,
  type ExtensionUser,
} from '../../src/api/extension-auth';

type Language = 'en' | 'zh-CN';
type TradingLevel = NonNullable<ExtensionUser['tradingLevel']>;
type FocusArea = ExtensionUser['focusAreas'][number];

const COPY = {
  en: {
    loginTitle: 'Log in to ChartViz', registerTitle: 'Create account', onboardingTitle: 'Set up your profile',
    loginIntro: 'Analyze charts without leaving this page.', registerIntro: 'Includes 1 free chart analysis.',
    independent: 'Your extension login is separate from the ChartViz website.',
    email: 'Email', password: 'Password', confirm: 'Confirm password', code: 'Email verification code',
    sendCode: 'Send code', resend: 'Resend', codeSent: 'Code sent. It expires in 10 minutes.',
    login: 'Log in and analyze', register: 'Create account', create: 'Register',
    backLogin: 'Log in', close: 'Close', show: 'Show password', hide: 'Hide password',
    passwordRules: '8–128 characters with uppercase, lowercase, a number, and a special character.',
    passwordMismatch: 'Passwords do not match.', invalidCredentials: 'Incorrect email or password.',
    invalidCode: 'The verification code is invalid or expired.', emailExists: 'This email already has an account. Log in instead.',
    codeFailed: 'Unable to send the verification code.', dailyLimit: 'This email has reached the limit of 5 codes in 24 hours.',
    authorizationExpired: 'Your extension login expired. Log in again.', connectionFailed: 'Unable to connect to ChartViz. Check your connection and try again.', genericFailed: 'This step failed. Try again.', step: 'Step', nickname: 'Nickname', nicknameHint: '4–16 English letters',
    experience: 'Trading experience', lessThan1: 'Less than 1 year', oneToThree: '1–3 years', overThree: 'More than 3 years',
    markets: 'Markets you follow', marketsHint: 'Select one or more', crypto: 'Crypto', stocks: 'Stocks', forex: 'Forex', futures: 'Futures',
    next: 'Next', back: 'Back', finish: 'Finish and continue',
  },
  'zh-CN': {
    loginTitle: '登录 ChartViz', registerTitle: '创建免费账号', onboardingTitle: '完善交易偏好',
    loginIntro: '无需离开当前页面，即可开始分析。', registerIntro: '新用户包含 1 次免费图表分析。',
    independent: '插件登录与 ChartViz 网站登录相互独立。',
    email: '邮箱', password: '密码', confirm: '确认密码', code: '邮箱验证码', sendCode: '发送验证码', resend: '重新发送',
    codeSent: '验证码已发送，10 分钟内有效。', login: '登录并开始分析', register: '创建账号',
    create: '注册', backLogin: '登录', close: '关闭', show: '显示密码', hide: '隐藏密码',
    passwordRules: '密码为 8–128 位，必须包含大小写字母、数字和特殊符号。', passwordMismatch: '两次输入的密码不一致。',
    invalidCredentials: '邮箱或密码不正确。', invalidCode: '验证码无效或已过期。', emailExists: '该邮箱已经注册，请直接登录。',
    codeFailed: '验证码发送失败，请稍后重试。', dailyLimit: '该邮箱 24 小时内已发送 5 次验证码。', authorizationExpired: '插件登录已过期，请重新登录。', connectionFailed: '无法连接 ChartViz，请检查网络后重试。', genericFailed: '操作失败，请重试。',
    step: '步骤', nickname: '昵称', nicknameHint: '4–16 个英文字母', experience: '交易经验', lessThan1: '少于 1 年',
    oneToThree: '1–3 年', overThree: '3 年以上', markets: '关注的市场', marketsHint: '至少选择一项',
    crypto: 'Crypto', stocks: '股票', forex: '外汇', futures: '期货', next: '下一步', back: '上一步', finish: '完成并继续',
  },
} as const;

function passwordIsValid(value: string) {
  return value.length >= 8 && value.length <= 128 && /[A-Z]/.test(value) && /[a-z]/.test(value)
    && /\d/.test(value) && /[^A-Za-z0-9\s]/.test(value);
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return visible
    ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 3 18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" /><path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5.4 0 9 5.1 9 5.1a15 15 0 0 1-2.1 2.7" /><path d="M6.6 6.6C4.4 8 3 10 3 10s3.6 5 9 5c1.2 0 2.3-.2 3.3-.6" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 10s3.6-5 9-5 9 5 9 5-3.6 5-9 5-9-5-9-5Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export default function ExtensionAuthPanel({
  language, initialUser = null, onUserChanged, onAuthenticated, onClose,
}: {
  language: Language;
  initialUser?: ExtensionUser | null;
  onUserChanged?: (user: ExtensionUser) => void;
  onAuthenticated: (user: ExtensionUser) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = COPY[language];
  const [mode, setMode] = useState<'login' | 'register' | 'onboarding'>(initialUser && !initialUser.onboardingComplete ? 'onboarding' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [onboardingUser, setOnboardingUser] = useState<ExtensionUser | null>(initialUser);
  const [onboardingStep, setOnboardingStep] = useState(!initialUser?.nickname ? 1 : !initialUser.tradingLevel ? 2 : 3);
  const [nickname, setNickname] = useState(initialUser?.nickname ?? '');
  const [tradingLevel, setTradingLevel] = useState<TradingLevel | null>(initialUser?.tradingLevel ?? null);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>(initialUser?.focusAreas ?? []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function errorMessage(caught: unknown) {
    const code = caught instanceof ExtensionAuthError ? caught.code : '';
    if (code === 'invalid_credentials') return t.invalidCredentials;
    if (code === 'invalid_verification_code') return t.invalidCode;
    if (code === 'email_exists') return t.emailExists;
    if (code === 'registration_code_daily_limit') return t.dailyLimit;
    if (code === 'authorization_expired') return t.authorizationExpired;
    if (code === 'connection_failed') return t.connectionFailed;
    return code === 'code_failed' ? t.codeFailed : t.genericFailed;
  }

  function beginOnboarding(user: ExtensionUser) {
    onUserChanged?.(user);
    setOnboardingUser(user);
    setNickname(user.nickname ?? '');
    setTradingLevel(user.tradingLevel);
    setFocusAreas(user.focusAreas);
    setOnboardingStep(!user.nickname ? 1 : !user.tradingLevel ? 2 : 3);
    setMode('onboarding');
  }

  async function completeAuthentication(user: ExtensionUser) {
    if (!user.onboardingComplete) beginOnboarding(user);
    else await onAuthenticated(user);
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await completeAuthentication(await loginExtension(email.trim(), password)); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t.codeFailed); return; }
    setCodeBusy(true); setError('');
    try {
      const result = await requestExtensionRegistrationCode(email.trim(), language);
      setCodeSent(true); setCooldown(result.retryAfter || 60);
    } catch (caught) {
      if (caught instanceof ExtensionAuthError && caught.code === 'registration_code_cooldown') {
        setCooldown(caught.retryAfter || 60);
      } else setError(errorMessage(caught));
    } finally { setCodeBusy(false); }
  }

  async function submitRegistration(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!passwordIsValid(password)) { setError(t.passwordRules); return; }
    if (password !== confirmation) { setError(t.passwordMismatch); return; }
    setBusy(true);
    try {
      await completeAuthentication(await registerExtension({
        email: email.trim(), password, confirmPassword: confirmation, verificationCode,
      }));
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  function submitOnboardingStep(event: FormEvent) {
    event.preventDefault(); setError('');
    if (onboardingStep === 1) {
      if (!/^[A-Za-z]{4,16}$/.test(nickname.trim())) { setError(t.nicknameHint); return; }
      setOnboardingStep(2); return;
    }
    if (onboardingStep === 2) {
      if (!tradingLevel) return;
      setOnboardingStep(3); return;
    }
    if (!focusAreas.length || !tradingLevel || !onboardingUser) { setError(t.marketsHint); return; }
    setBusy(true);
    void updateExtensionOnboarding({ nickname: nickname.trim(), tradingLevel, focusAreas })
      .then(onAuthenticated).catch((caught) => setError(errorMessage(caught))).finally(() => setBusy(false));
  }

  const switchMode = (next: 'login' | 'register') => { setMode(next); setError(''); };
  return <div className="plugin-auth-modal" role="dialog" aria-modal="true" aria-label={mode === 'login' ? t.loginTitle : mode === 'register' ? t.registerTitle : t.onboardingTitle}>
    <div className="plugin-auth-card">
      <button className="plugin-auth-close" type="button" aria-label={t.close} title={t.close} onClick={onClose}>×</button>
      <img src={browser.runtime.getURL('/icons/chartviz.svg')} alt="" /><span className="plugin-auth-brand">ChartViz</span>
      {mode !== 'onboarding' && <div className="plugin-auth-tabs" role="tablist">
        <button type="button" className={mode === 'login' ? 'active' : ''} role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>{t.backLogin}</button>
        <button type="button" className={mode === 'register' ? 'active' : ''} role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>{t.create}</button>
      </div>}
      <h2>{mode === 'login' ? t.loginTitle : mode === 'register' ? t.registerTitle : t.onboardingTitle}</h2>
      {mode !== 'onboarding' && <p>{mode === 'login' ? t.loginIntro : t.registerIntro}</p>}
      {mode === 'login' && <form className="plugin-auth-form" onSubmit={submitLogin}>
        <label><span>{t.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label><span>{t.password}</span><span className="plugin-password-field"><input type={passwordVisible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} maxLength={128} required /><button type="button" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? t.hide : t.show}><PasswordVisibilityIcon visible={passwordVisible} /></button></span></label>
        <button className="primary" disabled={busy}>{t.login}</button>
      </form>}
      {mode === 'register' && <form className="plugin-auth-form" onSubmit={submitRegistration}>
        <label><span>{t.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label><span>{t.password}</span><span className="plugin-password-field"><input type={passwordVisible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /><button type="button" onClick={() => setPasswordVisible((value) => !value)} aria-label={passwordVisible ? t.hide : t.show}><PasswordVisibilityIcon visible={passwordVisible} /></button></span><small>{t.passwordRules}</small></label>
        <label><span>{t.confirm}</span><span className="plugin-password-field"><input type={confirmationVisible ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /><button type="button" onClick={() => setConfirmationVisible((value) => !value)} aria-label={confirmationVisible ? t.hide : t.show}><PasswordVisibilityIcon visible={confirmationVisible} /></button></span></label>
        <label><span>{t.code}</span><span className="plugin-verification-field"><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /><button type="button" disabled={codeBusy || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown}s` : codeSent ? t.resend : t.sendCode}</button></span>{codeSent && <small className="plugin-code-sent" role="status">{t.codeSent}</small>}</label>
        <button className="primary" disabled={busy}>{t.register}</button>
      </form>}
      {mode === 'onboarding' && <form className="plugin-auth-form" onSubmit={submitOnboardingStep}>
        <div className="plugin-auth-progress" aria-label={`${t.step} ${onboardingStep} / 3`}>{[1, 2, 3].map((step) => <i className={step <= onboardingStep ? 'active' : ''} key={step}>{step}</i>)}</div>
        {onboardingStep === 1 && <label><span>{t.nickname}</span><input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={4} maxLength={16} pattern="[A-Za-z]{4,16}" required /><small>{t.nicknameHint}</small></label>}
        {onboardingStep === 2 && <fieldset><legend>{t.experience}</legend>{([['less_than_1', t.lessThan1], ['one_to_three', t.oneToThree], ['over_three', t.overThree]] as Array<[TradingLevel, string]>).map(([value, label]) => <label className="plugin-auth-choice" key={value}><input type="radio" checked={tradingLevel === value} onChange={() => setTradingLevel(value)} /><span>{label}</span></label>)}</fieldset>}
        {onboardingStep === 3 && <fieldset><legend>{t.markets}</legend><small>{t.marketsHint}</small><div className="plugin-focus-grid">{([['crypto', t.crypto], ['stocks', t.stocks], ['forex', t.forex], ['futures', t.futures]] as Array<[FocusArea, string]>).map(([value, label]) => <label className="plugin-auth-choice" key={value}><input type="checkbox" checked={focusAreas.includes(value)} onChange={() => setFocusAreas((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value])} /><span>{label}</span></label>)}</div></fieldset>}
        <div className="plugin-auth-actions">{onboardingStep > 1 && <button className="secondary" type="button" onClick={() => setOnboardingStep((step) => step - 1)}>{t.back}</button>}<button className="primary" disabled={busy}>{onboardingStep === 3 ? t.finish : t.next}</button></div>
      </form>}
      {error && <div className="plugin-auth-error" role="alert">{error}</div>}
      <small className="plugin-auth-independent">{t.independent}</small>
    </div>
  </div>;
}
