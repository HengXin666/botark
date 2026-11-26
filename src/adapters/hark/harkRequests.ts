import type { HarkBridge } from '@shared/bridge'
import type { HarkRpcRequest, HarkRpcResponse } from '@shared/ipc'

/** Thin wrapper around the Hark bridge so feature components can share one call shape. */
export function harkRpc(
  bridge: HarkBridge,
  request: HarkRpcRequest,
  _signal?: AbortSignal
): Promise<HarkRpcResponse> {
  return bridge.rpc(request)
}
