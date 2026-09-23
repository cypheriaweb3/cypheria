import { describe, expect, it } from "vitest"

import { codexAppToolScope } from "./codex-app-tool-scope.js"

const metadata = {
  connector_id: "connector_0c9786b2f41f41558056126bdb46c9bd",
  link_id: "link-123",
  _codex_apps: {
    resource_uri: "/connector_0c9786b2f41f41558056126bdb46c9bd/link-123/get_project",
  },
}

describe("codexAppToolScope", () => {
  it("accepts only an account-bound target tool whose scope is internally consistent", () => {
    expect(codexAppToolScope("gitlab.get_project", metadata)).toEqual({
      connectorId: metadata.connector_id,
      accountLinkId: "link-123",
      resourceUri: metadata._codex_apps.resource_uri,
    })
    expect(codexAppToolScope("gitlab.get_project", { ...metadata, link_id: "other" })).toBeNull()
    expect(codexAppToolScope("gitlab.get_merge_request", metadata)).toBeNull()
    expect(
      codexAppToolScope("gitlab.get_project", { ...metadata, connector_id: "other" })
    ).toBeNull()
    expect(
      codexAppToolScope("gitlab.get_project", {
        ...metadata,
        _codex_apps: { ...metadata._codex_apps, synthetic_link: true },
      })
    ).toBeNull()
    expect(codexAppToolScope("gitlab.get_project", {})).toBeNull()
  })
})
