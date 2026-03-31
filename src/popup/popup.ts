import { DEFAULT_SETTINGS, DEFAULT_TAB_STATE, STORAGE_KEYS, sanitizeSettings } from '../shared/constants';
import type { RuntimeMessage } from '../shared/messages';
import type {
  CameraStatus,
  GestureSettings,
  InteractionMode,
  RuntimeTabState,
  TabStateMap
} from '../shared/types';

const extensionStatusEl = document.getElementById('extensionStatus') as HTMLSpanElement;
const cameraStatusEl = document.getElementById('cameraStatus') as HTMLSpanElement;
const handStatusEl = document.getElementById('handStatus') as HTMLSpanElement;
const lastGestureEl = document.getElementById('lastGesture') as HTMLSpanElement;
const toggleButtonEl = document.getElementById('toggleButton') as HTMLButtonElement;
const cameraNoticeEl = document.getElementById('cameraNotice') as HTMLParagraphElement;

const interactionModeEl = document.getElementById('interactionModeSetting') as HTMLSelectElement;
const cursorMirrorXEl = document.getElementById('cursorMirrorXSetting') as HTMLInputElement;

let currentEnabled = false;
let currentSettings: GestureSettings = { ...DEFAULT_SETTINGS };
let saveTimer: number | null = null;

const rangeSpecs: Array<{
  key: keyof GestureSettings;
  input: HTMLInputElement;
  value: HTMLSpanElement;
  digits: number;
}> = [
  spec('angleToleranceDegSetting', 'angleToleranceDegValue', 'angleToleranceDeg', 0),
  spec('axisLockRatioSetting', 'axisLockRatioValue', 'axisLockRatio', 2),
  spec('minSwipeDistanceSetting', 'minSwipeDistanceValue', 'minSwipeDistance', 2),
  spec('horizontalCooldownMsSetting', 'horizontalCooldownMsValue', 'horizontalCooldownMs', 0),
  spec('verticalCooldownMsSetting', 'verticalCooldownMsValue', 'verticalCooldownMs', 0),
  spec('cursorSmoothingSetting', 'cursorSmoothingValue', 'cursorSmoothing', 2),
  spec('pinchStartRatioSetting', 'pinchStartRatioValue', 'pinchStartRatio', 2),
  spec('pinchEndRatioSetting', 'pinchEndRatioValue', 'pinchEndRatio', 2),
  spec('pinchCooldownMsSetting', 'pinchCooldownMsValue', 'pinchCooldownMs', 0),
  spec('pinchDragScrollFactorSetting', 'pinchDragScrollFactorValue', 'pinchDragScrollFactor', 2),
  spec('pinchTapMaxMovePxSetting', 'pinchTapMaxMovePxValue', 'pinchTapMaxMovePx', 0),
  spec('pinchTapMaxDurationMsSetting', 'pinchTapMaxDurationMsValue', 'pinchTapMaxDurationMs', 0)
];

function spec(
  inputId: string,
  valueId: string,
  key: keyof GestureSettings,
  digits: number
): {
  key: keyof GestureSettings;
  input: HTMLInputElement;
  value: HTMLSpanElement;
  digits: number;
} {
  return {
    key,
    input: document.getElementById(inputId) as HTMLInputElement,
    value: document.getElementById(valueId) as HTMLSpanElement,
    digits
  };
}

function cameraLabel(status: CameraStatus): string {
  if (status === 'IN_USE') {
    return '利用中';
  }

  if (status === 'GRANTED') {
    return '許可済み';
  }

  if (status === 'ERROR') {
    return 'エラー';
  }

  return '未許可';
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    return null;
  }

  return tab.id;
}

function renderSettings(): void {
  interactionModeEl.value = currentSettings.interactionMode;
  cursorMirrorXEl.checked = currentSettings.cursorMirrorX;

  for (const range of rangeSpecs) {
    const value = currentSettings[range.key];
    if (typeof value !== 'number') {
      continue;
    }

    range.input.value = String(value);
    range.value.textContent = value.toFixed(range.digits);
  }
}

async function loadState(): Promise<void> {
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
  const tabStates = (storage[STORAGE_KEYS.tabStates] as TabStateMap | undefined) ?? {};
  const tabState: RuntimeTabState =
    (activeTabId !== null ? tabStates[String(activeTabId)] : undefined) ?? DEFAULT_TAB_STATE;

  extensionStatusEl.textContent = currentEnabled ? 'ON' : 'OFF';
  cameraStatusEl.textContent = cameraLabel(tabState.cameraStatus);
  handStatusEl.textContent = tabState.handStatus === 'DETECTED' ? '検出中' : '未検出';
  lastGestureEl.textContent = tabState.lastGesture;

  toggleButtonEl.classList.toggle('on', currentEnabled);
  toggleButtonEl.textContent = currentEnabled ? 'OFFにする' : 'ONにする';

  const showNotice =
    currentEnabled && tabState.cameraStatus !== 'IN_USE' && tabState.cameraStatus !== 'GRANTED';
  cameraNoticeEl.classList.toggle('show', showNotice);
  if (tabState.cameraStatus === 'ERROR' && tabState.errorMessage) {
    cameraNoticeEl.textContent = tabState.errorMessage;
  } else {
    cameraNoticeEl.textContent = 'カメラ未許可です。ON後にページ側のカメラ許可を与えてください。';
  }

  renderSettings();
}

function queueSaveSettings(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    void persistSettings();
  }, 120);
}

async function persistSettings(): Promise<void> {
  const normalized = sanitizeSettings(currentSettings);
  currentSettings = normalized;
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: normalized
  });
  renderSettings();
}

async function toggleExtension(): Promise<void> {
  const next = !currentEnabled;
  await chrome.runtime.sendMessage({
    type: 'SET_EXTENSION_STATE',
    enabled: next
  } satisfies RuntimeMessage);

  await loadState();
}

function bindSettingEvents(): void {
  interactionModeEl.addEventListener('change', () => {
    currentSettings.interactionMode = interactionModeEl.value as InteractionMode;
    queueSaveSettings();
  });

  cursorMirrorXEl.addEventListener('change', () => {
    currentSettings.cursorMirrorX = cursorMirrorXEl.checked;
    queueSaveSettings();
  });

  for (const range of rangeSpecs) {
    range.input.addEventListener('input', () => {
      const value = Number(range.input.value);
      (currentSettings as any)[range.key] = value;
      range.value.textContent = value.toFixed(range.digits);
      queueSaveSettings();
    });
  }
}

toggleButtonEl.addEventListener('click', () => {
  void toggleExtension();
});

chrome.storage.onChanged.addListener(() => {
  void loadState();
});

bindSettingEvents();
void loadState();
