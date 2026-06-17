'use strict';

const STEP_ORDER = ['sync', 'backend', 'frontend', 'ready'];

function setStep(activeStep) {
  const idx = STEP_ORDER.indexOf(activeStep);
  document.querySelectorAll('.steps li').forEach(el => {
    const step = el.dataset.step;
    const stepIdx = STEP_ORDER.indexOf(step);
    el.classList.toggle('active', step === activeStep);
    el.classList.toggle('done', stepIdx >= 0 && stepIdx < idx);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  window.api.onStartupProgress(({ msg, detail, step }) => {
    const statusEl = document.getElementById('status-msg');
    const detailEl = document.getElementById('detail-msg');
    if (statusEl && msg) statusEl.textContent = msg;
    if (detailEl) detailEl.textContent = detail || '';
    if (step) setStep(step);
  });
});
