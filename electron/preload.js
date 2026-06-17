'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getWizardState:  () => ipcRenderer.invoke('get-wizard-state'),
  notifySetupReady: () => ipcRenderer.invoke('setup-ui-ready'),
  startInstall:    () => ipcRenderer.invoke('start-install'),
  saveApiConfig:   cfg => ipcRenderer.invoke('save-api-config', cfg),
  finishWizard:    opts => ipcRenderer.invoke('finish-wizard', opts),
  openExternal:    url => ipcRenderer.invoke('open-external', url),
  getStatus:       () => ipcRenderer.invoke('get-status'),
  restartServices: () => ipcRenderer.invoke('restart-services'),
  stopServices:    () => ipcRenderer.invoke('stop-services'),
  startServices:   () => ipcRenderer.invoke('start-services'),
  openDashboard:   () => ipcRenderer.invoke('open-dashboard'),
  launchDesktopPet: () => ipcRenderer.invoke('launch-desktop-pet'),
  openConfig:      () => ipcRenderer.invoke('open-config'),
  openLogs:        () => ipcRenderer.invoke('open-logs'),
  openInstallLog:  () => ipcRenderer.invoke('open-install-log'),
  getInstallLogPath: () => ipcRenderer.invoke('get-install-log-path'),
  openSupport:     () => ipcRenderer.invoke('open-support'),
  getPlatform:     () => process.platform,

  pickWorkspaceFolder: () => ipcRenderer.invoke('workspace:pick-folder'),
  pickWorkspaceFile: () => ipcRenderer.invoke('workspace:pick-file'),
  getWorkspaceProjects: () => ipcRenderer.invoke('workspace:get-projects'),
  saveWorkspaceProjects: rows => ipcRenderer.invoke('workspace:save-projects', rows),

  getPlatformInfo: () => ipcRenderer.invoke('system:platform-info'),
  runSystemCommand: payload => ipcRenderer.invoke('system:run', payload),

  onStatusUpdate: cb => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('status-update', handler);
    return () => ipcRenderer.removeListener('status-update', handler);
  },

  onSetupProgress: cb => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('setup-progress', handler);
    return () => ipcRenderer.removeListener('setup-progress', handler);
  },

  onSetupPhase: cb => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('setup-phase', handler);
    return () => ipcRenderer.removeListener('setup-phase', handler);
  },

  onStartupProgress: cb => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('startup-progress', handler);
    return () => ipcRenderer.removeListener('startup-progress', handler);
  },
});
