'use strict';

const SERVICE_ORDER = ['backend', 'ocr', 'parser', 'directory', 'frontend', 'desktopPet'];

const STATUS_LABEL = {
  running:     'Running',
  starting:    'Starting…',
  error:       'Error',
  stopped:     'Stopped',
  unavailable: 'Unavailable',
};

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Fetch current state and render once on load */
window.addEventListener('DOMContentLoaded', async () => {
  if (window.api.getPlatform() !== 'darwin') {
    const notice = document.getElementById('gk-notice');
    if (notice) notice.style.display = 'none';
  }
  const data = await window.api.getStatus();
  render(data);

  // Subscribe to live updates
  window.api.onStatusUpdate(render);

  // Button event listeners — avoids CSP violations from inline onclick attributes
  document.getElementById('btn-dashboard').addEventListener('click', () => window.api.openDashboard());
  document.getElementById('btn-restart').addEventListener('click', restart);
  document.getElementById('btn-config').addEventListener('click', () => window.api.openConfig());
  document.getElementById('btn-logs').addEventListener('click', () => window.api.openLogs());
  document.getElementById('btn-stop').addEventListener('click', stop);
});

function render(data) {
  const list = document.getElementById('services-list');
  list.innerHTML = '';

  for (const key of SERVICE_ORDER) {
    const svc = data[key];
    if (!svc) continue;
    if (svc.status === 'unavailable') continue; // optional service not bundled — hide from list
    const row = document.createElement('div');
    row.className = 'service-row';
    const errorHtml = (svc.status === 'error' && svc.lastError)
      ? `<div class="svc-error">${escHtml(svc.lastError)}</div>`
      : '';
    row.innerHTML = `
      <div class="svc-main-row">
        <div class="svc-dot ${svc.status}"></div>
        <span class="svc-name">${escHtml(svc.name)}</span>
        ${svc.port ? `<span class="svc-port">:${svc.port}</span>` : ''}
        <span class="svc-status ${svc.status}">${STATUS_LABEL[svc.status] || svc.status}</span>
      </div>
      ${errorHtml}
    `;
    list.appendChild(row);
  }

  // Overall status
  const statuses = SERVICE_ORDER.map(k => data[k]?.status || 'stopped');
  let overall = 'stopped';
  if (statuses.every(s => s === 'running' || s === 'unavailable')) overall = 'running';
  else if (statuses.some(s => s === 'starting')) overall = 'starting';
  else if (statuses.some(s => s === 'running')) overall = 'partial';
  else if (statuses.some(s => s === 'error'))   overall = 'error';

  const dot   = document.getElementById('overall-dot');
  const label = document.getElementById('overall-label');
  const dbBtn = document.getElementById('btn-dashboard');

  dot.className = `pulse-dot ${overall}`;
  label.textContent = {
    running:  'All services running',
    starting: 'Services starting…',
    partial:  'Some services running',
    error:    'One or more services failed',
    stopped:  'Services stopped',
  }[overall] || overall;

  dbBtn.disabled = data.frontend?.status !== 'running';
}

async function restart() {
  document.getElementById('btn-restart').disabled = true;
  await window.api.restartServices();
  setTimeout(() => { document.getElementById('btn-restart').disabled = false; }, 4000);
}

async function stop() {
  await window.api.stopServices();
}

function showGKHelp() {
  alert(
    'If macOS says the app is "damaged" or "from an unidentified developer":\n\n' +
    '1. Open Terminal\n' +
    '2. Run: xattr -rd com.apple.quarantine "/Applications/AI Media Agent.app"\n' +
    '3. Try opening the app again.'
  );
}
