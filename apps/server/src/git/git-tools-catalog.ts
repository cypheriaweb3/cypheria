import { GIT_CLIENT_SCHEMAS } from "@cypheria/protocol"
import { z } from "zod"

/** MCP tool inputs are generated from the same Zod payloads used at the HTTP boundary. */
const catalog = {
  tools: GIT_CLIENT_SCHEMAS.map((schema) => ({
    type: schema.shape.type.value,
    inputSchema: z.toJSONSchema(schema.shape.payload, { target: "draft-7" }),
  })),
}

export const gitToolsCatalog = () => catalog
