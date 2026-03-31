"use strict";
(() => {
  // src/shared/constants.ts
  var STORAGE_KEYS = {
    extensionEnabled: "extensionEnabled",
    tabStates: "tabStates",
    settings: "settings"
  };
  var DEFAULT_SETTINGS = {
    interactionMode: "CURSOR_PINCH",
    swipeEnabled: false,
    cursorEnabled: true,
    pinchClickEnabled: true,
    minSwipeDistance: 0.14,
    minStepDistance: 4e-3,
    axisLockDistance: 0.05,
    axisLockRatio: 1.25,
    maxOffAxisRatio: 0.4,
    angleToleranceDeg: 28,
    windowMs: 750,
    horizontalCooldownMs: 950,
    verticalCooldownMs: 1600,
    minConsistency: 0.6,
    cursorSmoothing: 0.35,
    pinchStartRatio: 0.38,
    pinchEndRatio: 0.58,
    pinchCooldownMs: 360,
    pinchDragScrollFactor: 2.2,
    pinchTapMaxMovePx: 18,
    pinchTapMaxDurationMs: 260,
    cursorMirrorX: true
  };
  var DEFAULT_TAB_STATE = {
    cameraStatus: "NOT_GRANTED",
    handStatus: "NOT_DETECTED",
    lastGesture: "NONE",
    updatedAt: 0
  };
  function sanitizeSettings(input) {
    const candidate = input ?? {};
    const normalized = {
      ...DEFAULT_SETTINGS,
      ...candidate
    };
    if (candidate.interactionMode === "SWIPE" || candidate.interactionMode === "CURSOR_PINCH") {
      normalized.interactionMode = candidate.interactionMode;
    } else {
      normalized.interactionMode = candidate.swipeEnabled ? "SWIPE" : "CURSOR_PINCH";
    }
    normalized.cursorMirrorX = Boolean(
      candidate.cursorMirrorX ?? DEFAULT_SETTINGS.cursorMirrorX
    );
    normalized.windowMs = clamp(normalized.windowMs, 300, 1500);
    normalized.minStepDistance = clamp(normalized.minStepDistance, 1e-3, 0.05);
    normalized.axisLockDistance = clamp(normalized.axisLockDistance, 0.02, 0.2);
    normalized.axisLockRatio = clamp(normalized.axisLockRatio, 1, 2.5);
    normalized.minConsistency = clamp(normalized.minConsistency, 0.35, 0.95);
    normalized.angleToleranceDeg = clamp(normalized.angleToleranceDeg, 10, 45);
    normalized.minSwipeDistance = clamp(normalized.minSwipeDistance, 0.08, 0.3);
    normalized.maxOffAxisRatio = clamp(normalized.maxOffAxisRatio, 0.15, 0.8);
    normalized.horizontalCooldownMs = clamp(normalized.horizontalCooldownMs, 300, 2500);
    normalized.verticalCooldownMs = clamp(normalized.verticalCooldownMs, 500, 3e3);
    normalized.cursorSmoothing = clamp(normalized.cursorSmoothing, 0.05, 0.95);
    normalized.pinchStartRatio = clamp(normalized.pinchStartRatio, 0.2, 0.7);
    normalized.pinchEndRatio = clamp(normalized.pinchEndRatio, 0.25, 0.9);
    normalized.pinchCooldownMs = clamp(normalized.pinchCooldownMs, 100, 2e3);
    normalized.pinchDragScrollFactor = clamp(normalized.pinchDragScrollFactor, 0.8, 4.5);
    normalized.pinchTapMaxMovePx = clamp(normalized.pinchTapMaxMovePx, 4, 80);
    normalized.pinchTapMaxDurationMs = clamp(normalized.pinchTapMaxDurationMs, 80, 600);
    if (normalized.pinchEndRatio <= normalized.pinchStartRatio) {
      normalized.pinchEndRatio = Math.min(0.95, normalized.pinchStartRatio + 0.08);
    }
    if (normalized.interactionMode === "SWIPE") {
      normalized.swipeEnabled = true;
      normalized.cursorEnabled = false;
      normalized.pinchClickEnabled = false;
    } else {
      normalized.swipeEnabled = false;
      normalized.cursorEnabled = true;
      normalized.pinchClickEnabled = true;
    }
    return normalized;
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // src/background.ts
  async function getExtensionEnabled() {
    const value = await chrome.storage.local.get(STORAGE_KEYS.extensionEnabled);
    return Boolean(value[STORAGE_KEYS.extensionEnabled]);
  }
  async function setExtensionEnabled(enabled) {
    await chrome.storage.local.set({ [STORAGE_KEYS.extensionEnabled]: enabled });
  }
  async function getTabStates() {
    const value = await chrome.storage.local.get(STORAGE_KEYS.tabStates);
    return value[STORAGE_KEYS.tabStates] ?? {};
  }
  async function setTabState(tabId, state) {
    const tabStates = await getTabStates();
    tabStates[String(tabId)] = state;
    await chrome.storage.local.set({ [STORAGE_KEYS.tabStates]: tabStates });
  }
  async function removeTabState(tabId) {
    const tabStates = await getTabStates();
    delete tabStates[String(tabId)];
    await chrome.storage.local.set({ [STORAGE_KEYS.tabStates]: tabStates });
  }
  async function broadcastToggle(enabled) {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(
      tabs.filter((tab) => typeof tab.id === "number").map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "EXTENSION_TOGGLE",
            enabled
          });
        } catch {
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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_EXTENSION_STATE") {
      void getExtensionEnabled().then((enabled) => sendResponse({ enabled }));
      return true;
    }
    if (message.type === "SET_EXTENSION_STATE") {
      void (async () => {
        await setExtensionEnabled(message.enabled);
        await broadcastToggle(message.enabled);
        sendResponse({ ok: true });
      })();
      return true;
    }
    if (message.type === "STATE_UPDATE") {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") {
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
    if (areaName !== "local") {
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
})();
//# sourceMappingURL=background.js.map
