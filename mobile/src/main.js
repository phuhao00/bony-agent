import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

const STORAGE_KEY = 'ai_media_agent_server_url';

const boot = document.getElementById('boot');
const setup = document.getElementById('setup');
const serverInput = document.getElementById('serverUrl');
const connectBtn = document.getElementById('connectBtn');
const settingsBtn = document.getElementById('settingsBtn');
const errorEl = document.getElementById('error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  if (!url.port && url.protocol === 'http:') {
    url.port = '3000';
  }
  return url.toString().replace(/\/$/, '');
}

async function saveUrl(url) {
  await Preferences.set({ key: STORAGE_KEY, value: url });
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* ignore */
  }
}

async function clearSavedUrl() {
  await Preferences.remove({ key: STORAGE_KEY });
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function loadSavedUrl() {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) return value;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.type === 'opaque' || res.ok;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('连接超时，请确认桌面版已启动且与手机在同一网络');
    }
    throw new Error('无法连接，请检查地址与防火墙');
  } finally {
    clearTimeout(timer);
  }
}

function enterConsole(url) {
  window.location.replace(url);
}

function showSetup(prefill = '', { fromReconnect = false } = {}) {
  boot.classList.add('hidden');
  setup.classList.remove('hidden');
  if (prefill) serverInput.value = prefill;
  settingsBtn.classList.toggle('hidden', !fromReconnect);
}

async function initChrome() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f0f1a' });
  } catch {
    /* ignore */
  }
  try {
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }
}

async function connect() {
  clearError();
  const normalized = normalizeUrl(serverInput.value);
  if (!normalized) {
    showError('请输入控制台地址，例如 http://192.168.1.10:3000');
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = '正在连接…';
  try {
    await probeUrl(normalized);
    await saveUrl(normalized);
    enterConsole(normalized);
  } catch (err) {
    showError(err.message || '连接失败');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = '连接并进入';
  }
}

connectBtn.addEventListener('click', connect);
settingsBtn.addEventListener('click', async () => {
  await clearSavedUrl();
  serverInput.value = '';
  clearError();
  settingsBtn.classList.add('hidden');
});

(async () => {
  await initChrome();
  const saved = await loadSavedUrl();
  if (saved) {
    try {
      const normalized = normalizeUrl(saved);
      await probeUrl(normalized);
      enterConsole(normalized);
      return;
    } catch {
      showSetup(saved, { fromReconnect: true });
      return;
    }
  }
  showSetup();
})();
