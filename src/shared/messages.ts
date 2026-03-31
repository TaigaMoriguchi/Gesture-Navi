import type { RuntimeTabState } from './types';

export type RuntimeMessage =
  | { type: 'GET_EXTENSION_STATE' }
  | { type: 'SET_EXTENSION_STATE'; enabled: boolean }
  | { type: 'EXTENSION_TOGGLE'; enabled: boolean }
  | { type: 'STATE_UPDATE'; state: RuntimeTabState };
