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

  // src/popup/popup.ts
  var extensionStatusEl = document.getElementById("extensionStatus");
  var cameraStatusEl = document.getElementById("cameraStatus");
  var handStatusEl = document.getElementById("handStatus");
  var lastGestureEl = document.getElementById("lastGesture");
  var toggleButtonEl = document.getElementById("toggleButton");
  var cameraNoticeEl = document.getElementById("cameraNotice");
  var interactionModeEl = document.getElementById("interactionModeSetting");
  var cursorMirrorXEl = document.getElementById("cursorMirrorXSetting");
  var currentEnabled = false;
  var currentSettings = { ...DEFAULT_SETTINGS };
  var saveTimer = null;
  var rangeSpecs = [
    spec("angleToleranceDegSetting", "angleToleranceDegValue", "angleToleranceDeg", 0),
    spec("axisLockRatioSetting", "axisLockRatioValue", "axisLockRatio", 2),
    spec("minSwipeDistanceSetting", "minSwipeDistanceValue", "minSwipeDistance", 2),
    spec("horizontalCooldownMsSetting", "horizontalCooldownMsValue", "horizontalCooldownMs", 0),
    spec("verticalCooldownMsSetting", "verticalCooldownMsValue", "verticalCooldownMs", 0),
    spec("cursorSmoothingSetting", "cursorSmoothingValue", "cursorSmoothing", 2),
    spec("pinchStartRatioSetting", "pinchStartRatioValue", "pinchStartRatio", 2),
    spec("pinchEndRatioSetting", "pinchEndRatioValue", "pinchEndRatio", 2),
    spec("pinchCooldownMsSetting", "pinchCooldownMsValue", "pinchCooldownMs", 0),
    spec("pinchDragScrollFactorSetting", "pinchDragScrollFactorValue", "pinchDragScrollFactor", 2),
    spec("pinchTapMaxMovePxSetting", "pinchTapMaxMovePxValue", "pinchTapMaxMovePx", 0),
    spec("pinchTapMaxDurationMsSetting", "pinchTapMaxDurationMsValue", "pinchTapMaxDurationMs", 0)
  ];
  function spec(inputId, valueId, key, digits) {
    return {
      key,
      input: document.getElementById(inputId),
      value: document.getElementById(valueId),
      digits
    };
  }
  function cameraLabel(status) {
    if (status === "IN_USE") {
      return "\u5229\u7528\u4E2D";
    }
    if (status === "GRANTED") {
      return "\u8A31\u53EF\u6E08\u307F";
    }
    if (status === "ERROR") {
      return "\u30A8\u30E9\u30FC";
    }
    return "\u672A\u8A31\u53EF";
  }
  async function getActiveTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== "number") {
      return null;
    }
    return tab.id;
  }
  function renderSettings() {
    interactionModeEl.value = currentSettings.interactionMode;
    cursorMirrorXEl.checked = currentSettings.cursorMirrorX;
    for (const range of rangeSpecs) {
      const value = currentSettings[range.key];
      if (typeof value !== "number") {
        continue;
      }
      range.input.value = String(value);
      range.value.textContent = value.toFixed(range.digits);
    }
  }
  async function loadState() {
    const [activeTabId, storage] = await Promise.all([
      getActiveTabId(),
      chrome.storage.local.get([
        STORAGE_KEYS.extensionEnabled,
        STORAGE_KEYS.tabStates,
        STORAGE_KEYS.settings
      ])
    ]);
    currentEnabled = Boolean(storage[STORAGE_KEYS.extensionEnabled]);
    currentSettings = sanitizeSettings(storage[STORAGE_KEYS.settings]);
    const tabStates = storage[STORAGE_KEYS.tabStates] ?? {};
    const tabState = (activeTabId !== null ? tabStates[String(activeTabId)] : void 0) ?? DEFAULT_TAB_STATE;
    extensionStatusEl.textContent = currentEnabled ? "ON" : "OFF";
    cameraStatusEl.textContent = cameraLabel(tabState.cameraStatus);
    handStatusEl.textContent = tabState.handStatus === "DETECTED" ? "\u691C\u51FA\u4E2D" : "\u672A\u691C\u51FA";
    lastGestureEl.textContent = tabState.lastGesture;
    toggleButtonEl.classList.toggle("on", currentEnabled);
    toggleButtonEl.textContent = currentEnabled ? "OFF\u306B\u3059\u308B" : "ON\u306B\u3059\u308B";
    const showNotice = currentEnabled && tabState.cameraStatus !== "IN_USE" && tabState.cameraStatus !== "GRANTED";
    cameraNoticeEl.classList.toggle("show", showNotice);
    if (tabState.cameraStatus === "ERROR" && tabState.errorMessage) {
      cameraNoticeEl.textContent = tabState.errorMessage;
    } else {
      cameraNoticeEl.textContent = "\u30AB\u30E1\u30E9\u672A\u8A31\u53EF\u3067\u3059\u3002ON\u5F8C\u306B\u30DA\u30FC\u30B8\u5074\u306E\u30AB\u30E1\u30E9\u8A31\u53EF\u3092\u4E0E\u3048\u3066\u304F\u3060\u3055\u3044\u3002";
    }
    renderSettings();
  }
  function queueSaveSettings() {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      void persistSettings();
    }, 120);
  }
  async function persistSettings() {
    const normalized = sanitizeSettings(currentSettings);
    currentSettings = normalized;
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: normalized
    });
    renderSettings();
  }
  async function toggleExtension() {
    const next = !currentEnabled;
    await chrome.runtime.sendMessage({
      type: "SET_EXTENSION_STATE",
      enabled: next
    });
    await loadState();
  }
  function bindSettingEvents() {
    interactionModeEl.addEventListener("change", () => {
      currentSettings.interactionMode = interactionModeEl.value;
      queueSaveSettings();
    });
    cursorMirrorXEl.addEventListener("change", () => {
      currentSettings.cursorMirrorX = cursorMirrorXEl.checked;
      queueSaveSettings();
    });
    for (const range of rangeSpecs) {
      range.input.addEventListener("input", () => {
        const value = Number(range.input.value);
        currentSettings[range.key] = value;
        range.value.textContent = value.toFixed(range.digits);
        queueSaveSettings();
      });
    }
  }
  toggleButtonEl.addEventListener("click", () => {
    void toggleExtension();
  });
  chrome.storage.onChanged.addListener(() => {
    void loadState();
  });
  bindSettingEvents();
  void loadState();
})();
//# sourceMappingURL=popup.js.map
