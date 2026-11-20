export type StateHandler = (data: ArrayBuffer) => void;

/**
 * Two logical channels with deliberately different guarantees.
 *
 *  - state: unreliable and unordered. Snapshots and inputs. A dropped one is
 *    superseded by the next, so retransmitting it would only add latency.
 *  - event: reliable and ordered. Joins, hit confirms, session end. Losing
 *    one of these corrupts session state permanently.
 */
export type Transport = {
  sendState(data: ArrayBuffer): void;
  sendEvent(data: ArrayBuffer): void;
  onState(handler: StateHandler): void;
  onEvent(handler: StateHandler): void;
  readonly open: boolean;
  close(): void;
};

export type NetworkConditions = {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
};

export const PERFECT_NETWORK: NetworkConditions = { latencyMs: 0, jitterMs: 0, lossRate: 0 };
