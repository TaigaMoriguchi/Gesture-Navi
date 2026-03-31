import { DEFAULT_SETTINGS, DEFAULT_TAB_STATE, STORAGE_KEYS, sanitizeSettings } from './shared/constants';
import type { RuntimeMessage } from './shared/messages';
import type { RuntimeTabState, TabStateMap } from './shared/types';

async function getExtensionEnabled(): Promise<boolean> {
  const value = await chrome.storage.local.get(STORAGE_KEYS.extensionEnabled);
  return Boolean(value[STORAGE_KEYS.extensionEnabled]);
}

async function setExtensionEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.extensionEnabled]: enabled });
}

async function getTabStates(): Promise<TabStateMap> {
  const value = await chrome.storage.local.get(STORAGE_KEYS.tabStates);
  return (value[STORAGE_KEYS.tabStates] as TabStateMap | undefined) ?? {};
}

async function setTabState(tabId: number, state: RuntimeTabState): Promise<void> {
  const tabStates = await getTabStates();
  tabStates[String(tabId)] = state;
  await chrome.storage.local.set({ [STORAGE_KEYS.tabStates]: tabStates });
}

async function removeTabState(tabId: number): Promise<void> {
  const tabStates = await getTabStates();
  delete tabStates[String(tabId)];
  await chrome.storage.local.set({ [STORAGE_KEYS.tabStates]: tabStates });
}

async function broadcastToggle(enabled: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === 'number')
      .map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id as number, {
            type: 'EXTENSION_TOGGLE',
            enabled
          } satisfies RuntimeMessage);
        } catch {
          // content script未注入ページは無視
        }
      })
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = sanitizeSettings(current[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    [STORAGE_KEYS.extensionEnabled]: false,
    [STORAGE_KEYS.tabStates]: {},
    [STORAGE_KEYS.settings]: settings
  });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === 'GET_EXTENSION_STATE') {
    void getExtensionEnabled().then((enabled) => sendResponse({ enabled }));
    return true;
  }

  if (message.type === 'SET_EXTENSION_STATE') {
    void (async () => {
      await setExtensionEnabled(message.enabled);
      await broadcastToggle(message.enabled);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'STATE_UPDATE') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false });
      return false;
    }

    void setTabState(tabId, {
      ...DEFAULT_TAB_STATE,
      ...message.state,
      updatedAt: Date.now()
    }).then(() => sendResponse({ ok: true }));

    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  const changed = changes[STORAGE_KEYS.extensionEnabled];
  if (!changed) {
    return;
  }

  void broadcastToggle(Boolean(changed.newValue));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabState(tabId);
});
