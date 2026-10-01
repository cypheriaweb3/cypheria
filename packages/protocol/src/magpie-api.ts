import { z } from "zod"

import release from "./generated/magpie/release.json" with { type: "json" }
import {
  zAgentFieldChange,
  zGetProvidersResponse,
  zGetStateResponse,
  zGroupChange,
} from "./generated/magpie/zod/zod.gen.ts"

/**
 * magpie's own HTTP API, for the Server's magpie adapter only. Clients use
 * the Cypheria views in `./magpie.ts`. The schemas come from the pinned
 * release's OpenAPI document (`generated/magpie`); where that document
 * describes a response only as an object, the boundary schema below names
 * the fields the adapter reads, from magpie's source at the same release.
 */

export type MagpiePlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-arm64"
  | "win32-x64"

export type MagpieRelease = {
  readonly cliSha256: Readonly<Record<MagpiePlatform, string>>
  readonly releasesRepository: string
  readonly sourceRepository: string
  readonly version: string
}

/** The magpie release this Cypheria build installs and speaks to. */
export const MAGPIE_RELEASE: MagpieRelease = release

/** GET /api/state, the agents part. */
export const MagpieStateSchema = zGetStateResponse.pick({ agents: true, notice: true })
export type MagpieState = z.infer<typeof MagpieStateSchema>

/** POST /api/set. */
export const MagpieAgentFieldChangeSchema = zAgentFieldChange

/** GET /api/providers, the providers part. */
export const MagpieProvidersSchema = zGetProvidersResponse.pick({ providers: true })
export type MagpieProviders = z.infer<typeof MagpieProvidersSchema>

/** GET /api/groups: each group as magpie keeps it, and whether it is usable. */
export const MagpieGroupsSchema = z.object({
  groups: z.array(
    zGroupChange.extend({
      id: z.string(),
      members: z.array(z.string()).nullish(),
      name: z.string(),
      ready: z.boolean(),
    })
  ),
})
export type MagpieGroups = z.infer<typeof MagpieGroupsSchema>

const magpieUsageTotals = {
  calls: z.int(),
  cost: z.number(),
  errors: z.int(),
  input: z.int(),
  output: z.int(),
}

/** GET /api/usage?period=…, as magpie's usage.Summary with names. */
export const MagpieUsageSchema = z.object({
  agents: z.array(z.object({ id: z.string(), name: z.string(), ...magpieUsageTotals })),
  models: z.array(
    z.object({
      id: z.string(),
      model: z.string().optional(),
      provider: z.string().optional(),
      sub: z.string().optional(),
      ...magpieUsageTotals,
    })
  ),
  period: z.string(),
  ...magpieUsageTotals,
})
export type MagpieUsage = z.infer<typeof MagpieUsageSchema>
