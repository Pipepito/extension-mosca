import type { FlySnapshot, RunnerStatus } from '../../core/types';

export const SERVICE_URL = 'https://moscas.lol';
export const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^fly_device_[a-f0-9]{64}$/.test(value);
export type Settings = { enabled: boolean; token: string };
export type FirefoxMessage =
  | { type: 'GET_STATE' }
  | { type: 'START'; token?: string }
  | { type: 'STOP' }
  | { type: 'FORGET' }
  | { type: 'OPEN_GARDEN' };
export type FirefoxState = {
  enabled: boolean;
  hasToken: boolean;
  status: RunnerStatus;
  fly?: FlySnapshot;
  activity?: { tick: number; neurons: number; session: number };
};
