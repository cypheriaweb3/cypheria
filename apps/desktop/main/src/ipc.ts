import type { IpcMainInvokeEvent } from "electron"
import { ipcMain } from "electron"
import type { IpcContract } from "../../ipc/src/index.js"

export type IpcRouteHandler<TRequestPayload, TResponsePayload> = (
  payload: TRequestPayload,
  event: IpcMainInvokeEvent
) => Promise<TResponsePayload> | TResponsePayload

export const registerIpcRoute = <TRequestPayload, TResponsePayload>(
  contract: IpcContract<TRequestPayload, TResponsePayload>,
  handler: IpcRouteHandler<TRequestPayload, TResponsePayload>
): void => {
  ipcMain.handle(contract.channel, async (event, rawPayload: unknown = {}) => {
    const payload = contract.request.parse(rawPayload ?? {})
    const response = await handler(payload, event)
    return contract.response.parse(response)
  })
}

export const removeIpcRoute = (contract: IpcContract<unknown, unknown>): void => {
  ipcMain.removeHandler(contract.channel)
}
