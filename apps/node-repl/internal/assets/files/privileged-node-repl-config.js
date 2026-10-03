function createPrivilegedNodeReplConfig({
  handlePrivilegedNodeReplOperation,
  isPlainObject,
}) {
  function normalizeTomlPath(value) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("nodeRepl TOML path must be a non-empty string");
    }
    return value;
  }

  function normalizeWritableTomlPath(value) {
    const pathValue = normalizeTomlPath(value);
    if (pathValue.toLowerCase() === "config.toml") {
      throw new Error(
        "nodeRepl.config.writeToml does not allow writing ~/.codex/config.toml; use nodeRepl.config.writeValue or nodeRepl.config.batchWrite",
      );
    }
    return pathValue;
  }

  function normalizeTomlValue(value) {
    if (!isPlainObject(value)) {
      throw new Error("nodeRepl TOML value must be a plain object");
    }
    return structuredClone(value);
  }

  function isJsonCompatibleValue(value) {
    if (value === null) {
      return true;
    }
    switch (typeof value) {
      case "string":
      case "boolean":
        return true;
      case "number":
        return Number.isFinite(value);
      case "object":
        if (Array.isArray(value)) {
          return value.every((entry) => isJsonCompatibleValue(entry));
        }
        if (!isPlainObject(value)) {
          return false;
        }
        return Object.values(value).every(
          (entry) => entry !== undefined && isJsonCompatibleValue(entry),
        );
      default:
        return false;
    }
  }

  function normalizeConfigJsonValue(value, operationName) {
    if (!isJsonCompatibleValue(value)) {
      throw new Error(`${operationName} value must be a JSON-serializable value`);
    }
    return structuredClone(value);
  }

  function normalizeConfigKeyPath(value, operationName) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${operationName} keyPath must be a non-empty string`);
    }
    return value;
  }

  function normalizeConfigMergeStrategy(value, operationName) {
    if (value === undefined) {
      return "upsert";
    }
    if (value !== "replace" && value !== "upsert") {
      throw new Error(
        `${operationName} mergeStrategy must be "replace" or "upsert"`,
      );
    }
    return value;
  }

  function normalizeExpectedVersion(value, operationName) {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof value !== "string") {
      throw new Error(`${operationName} expectedVersion must be a string or null`);
    }
    return value;
  }

  function normalizeConfigEditRequest(value, operationName) {
    if (!isPlainObject(value)) {
      throw new Error(`${operationName} request must be an object`);
    }
    return {
      key_path: normalizeConfigKeyPath(value.keyPath, operationName),
      merge_strategy: normalizeConfigMergeStrategy(
        value.mergeStrategy,
        operationName,
      ),
      value: normalizeConfigJsonValue(value.value, operationName),
    };
  }

  function normalizeReadConfigOptions(value) {
    if (value === undefined) {
      return {
        cwd: undefined,
        includeLayers: false,
      };
    }
    if (!isPlainObject(value)) {
      throw new Error("nodeRepl.config.read options must be an object");
    }
    const { cwd, includeLayers } = value;
    if (cwd !== undefined && cwd !== null && typeof cwd !== "string") {
      throw new Error(
        "nodeRepl.config.read cwd must be a string or null",
      );
    }
    if (includeLayers !== undefined && typeof includeLayers !== "boolean") {
      throw new Error(
        "nodeRepl.config.read includeLayers must be a boolean",
      );
    }
    return {
      cwd,
      includeLayers: includeLayers ?? false,
    };
  }

  function readToml(pathValue) {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.readToml",
      async () => ({
        type: "config_action",
        action: "read_toml",
        path: normalizeTomlPath(await pathValue),
      }),
    );
  }

  function writeToml(pathOrValue, maybeValue) {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.writeToml",
      async () => ({
        type: "config_action",
        action: "write_toml",
        path: normalizeWritableTomlPath(await pathOrValue),
        value: normalizeTomlValue(await maybeValue),
      }),
    );
  }

  function readConfig(optionsValue) {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.read",
      async () => {
        const options = normalizeReadConfigOptions(await optionsValue);
        return {
          type: "config_action",
          action: "read_config",
          cwd: options.cwd,
          include_layers: options.includeLayers,
        };
      },
    );
  }

  function readConfigRequirements() {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.readRequirements",
      async () => ({
        type: "config_action",
        action: "read_config_requirements",
      }),
    );
  }

  function writeConfigValue(requestValue) {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.writeValue",
      async () => {
        const request = await requestValue;
        const normalized = normalizeConfigEditRequest(
          request,
          "nodeRepl.config.writeValue",
        );
        return {
          type: "config_action",
          action: "write_config_value",
          key_path: normalized.key_path,
          merge_strategy: normalized.merge_strategy,
          value: normalized.value,
          expected_version: normalizeExpectedVersion(
            request.expectedVersion,
            "nodeRepl.config.writeValue",
          ),
        };
      },
    );
  }

  function batchWrite(requestValue) {
    return handlePrivilegedNodeReplOperation(
      "nodeRepl.config.batchWrite",
      async () => {
        const request = await requestValue;
        if (!isPlainObject(request)) {
          throw new Error(
            "nodeRepl.config.batchWrite request must be an object",
          );
        }
        if (!Array.isArray(request.edits) || request.edits.length === 0) {
          throw new Error(
            "nodeRepl.config.batchWrite edits must be a non-empty array",
          );
        }
        if (
          request.reloadUserConfig !== undefined &&
          typeof request.reloadUserConfig !== "boolean"
        ) {
          throw new Error(
            "nodeRepl.config.batchWrite reloadUserConfig must be a boolean",
          );
        }
        return {
          type: "config_action",
          action: "batch_write_config",
          edits: request.edits.map((edit) =>
            normalizeConfigEditRequest(edit, "nodeRepl.config.batchWrite"),
          ),
          expected_version: normalizeExpectedVersion(
            request.expectedVersion,
            "nodeRepl.config.batchWrite",
          ),
          reload_user_config: request.reloadUserConfig ?? false,
        };
      },
    );
  }

  return Object.freeze({
    readToml,
    writeToml,
    read: readConfig,
    readRequirements: readConfigRequirements,
    writeValue: writeConfigValue,
    batchWrite,
  });
}

module.exports = {
  createPrivilegedNodeReplConfig,
};
