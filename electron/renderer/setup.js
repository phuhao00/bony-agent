'use strict';

const PANELS = ['welcome', 'install', 'config', 'done'];
const PROVIDER_HINTS = {
  alibaba:     '通义千问 Key 获取：dashscope.console.aliyun.com/apiKey',
  zhipu:       '智谱 Key 获取：open.bigmodel.cn/usercenter/apikeys',
  openrouter:  'OpenRouter Key 获取：openrouter.ai/keys',
  google:      'Google Key 获取：aistudio.google.com/apikey',
  deepseek:    'DeepSeek Key 获取：platform.deepseek.com/api_keys',
};
const PROVIDER_URLS = {
  alibaba:     'https://dashscope.console.aliyun.com/apiKey',
  zhipu:       'https://open.bigmodel.cn/usercenter/apikeys',
  openrouter:  'https://openrouter.ai/keys',
  google:      'https://aistudio.google.com/apikey',
  deepseek:    'https://platform.deepseek.com/api_keys',
};

let currentStep = 0;
const MAX_INSTALL_LOG_LINES = 400;

function appendInstallLogLine(line) {
  const el = document.getElementById('install-log');
  if (!el || !line) return;
  el.textContent += `${line}\n`;
  const lines = el.textContent.split('\n');
  if (lines.length > MAX_INSTALL_LOG_LINES) {
    el.textContent = lines.slice(-MAX_INSTALL_LOG_LINES).join('\n');
  }
  el.scrollTop = el.scrollHeight;
}

function setStep(step) {
  currentStep = step;
  PANELS.forEach((name, i) => {
    document.getElementById(`panel-${name}`).classList.toggle('active', i === step);
    const dot = document.querySelector(`.step-dot[data-step="${i}"]`);
    if (!dot) return;
    dot.classList.toggle('active', i === step);
    dot.classList.toggle('done', i < step);
  });
}

function updateProviderHint() {
  const provider = document.getElementById('provider').value;
  const hint = document.getElementById('provider-hint');
  const url = PROVIDER_URLS[provider];
  hint.innerHTML = `${PROVIDER_HINTS[provider].split('：')[0]}：<a href="#" data-url="${url}">${url.replace('https://', '')}</a>`;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (window.api.getPlatform() === 'win32') {
    document.body.classList.add('platform-win');
  }
  document.getElementById('btn-start').addEventListener('click', startInstall);
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('btn-skip-config').addEventListener('click', () =>
    window.api.finishWizard({ openDashboard: false, skippedConfig: true }));
  document.getElementById('btn-open-dashboard').addEventListener('click', () =>
    window.api.finishWizard({ openDashboard: true }));
  document.getElementById('btn-open-status').addEventListener('click', () =>
    window.api.finishWizard({ openDashboard: false }));
  document.getElementById('btn-open-install-log')?.addEventListener('click', () =>
    window.api.openInstallLog());
  document.getElementById('provider').addEventListener('change', updateProviderHint);
  document.getElementById('provider-hint').addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); window.api.openExternal(a.dataset.url); }
  });

  updateProviderHint();

  window.api.onSetupProgress(({ pct, msg, detail, step, stepLabel, logLine, logPath }) => {
    const bar   = document.getElementById('progress-bar');
    const msgEl = document.getElementById('status-msg');
    const detEl = document.getElementById('detail-msg');
    const stepEl = document.getElementById('install-step');
    const pathEl = document.getElementById('install-log-path');

    if (stepEl && (stepLabel || step)) {
      stepEl.textContent = `当前步骤：${stepLabel || step}`;
    }
    if (pathEl && logPath) {
      pathEl.textContent = `日志文件：${logPath}`;
    }
    if (logLine) appendInstallLogLine(logLine);

    if (pct === -1) {
      msgEl.textContent = msg;
      msgEl.classList.add('error');
      bar.style.background = '#ef4444';
      if (detEl) detEl.textContent = detail || '';
      document.getElementById('btn-start').disabled = false;
      return;
    }

    bar.style.width = `${Math.max(0, Math.min(pct, 100))}%`;
    msgEl.textContent = msg;
    msgEl.classList.remove('error');
    if (detEl) detEl.textContent = detail || '';
  });

  window.api.onSetupPhase(({ phase }) => goToPhase(phase));

  const state = await window.api.getWizardState();
  if (state.installLogPath) {
    const pathEl = document.getElementById('install-log-path');
    if (pathEl) pathEl.textContent = `日志文件：${state.installLogPath}`;
  }
  if (state.initialPhase === 'config') {
    goToPhase('config');
  } else if (state.initialPhase === 'install') {
    goToPhase('install');
  }
  await window.api.notifySetupReady();
});

function goToPhase(phase) {
  const map = { welcome: 0, install: 1, config: 2, done: 3 };
  setStep(map[phase] ?? 0);
}

async function startInstall() {
  document.getElementById('btn-start').disabled = true;
  setStep(1);
  await window.api.startInstall();
}

async function saveConfig() {
  const provider = document.getElementById('provider').value;
  const apiKey   = document.getElementById('api-key').value.trim();
  const btn      = document.getElementById('btn-save-config');

  if (!apiKey) {
    document.getElementById('api-key').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await window.api.saveApiConfig({ provider, apiKey });
    await window.api.finishWizard({ openDashboard: true });
  } catch (err) {
    alert('保存失败：' + (err.message || err));
    btn.disabled = false;
    btn.textContent = '保存并启动';
  }
}
