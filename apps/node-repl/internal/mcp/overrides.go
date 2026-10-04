package mcp

import (
	"encoding/json"
	"fmt"
	"os"
)

// ToolOverrides replaces the server instructions and tool descriptions a launcher
// such as cua_repl presents for the same runtime. It is read from the
// NODE_REPL_TOOL_OVERRIDES environment variable.
type ToolOverrides struct {
	ServerInstructions string                  `json:"server_instructions,omitempty"`
	Tools              map[string]ToolOverride `json:"tools,omitempty"`
}

// ToolOverride replaces one tool's description and the descriptions of its
// input fields.
type ToolOverride struct {
	Description       string            `json:"description,omitempty"`
	FieldDescriptions map[string]string `json:"field_descriptions,omitempty"`
}

// ParseToolOverrides decodes overrides. An empty value means no overrides.
func ParseToolOverrides(raw string) (*ToolOverrides, error) {
	if raw == "" {
		return nil, nil
	}
	var overrides ToolOverrides
	if err := json.Unmarshal([]byte(raw), &overrides); err != nil {
		return nil, fmt.Errorf("parse NODE_REPL_TOOL_OVERRIDES: %w", err)
	}
	for name := range overrides.Tools {
		if !overridableTools[name] {
			return nil, fmt.Errorf("NODE_REPL_TOOL_OVERRIDES names unknown tool %q", name)
		}
	}
	return &overrides, nil
}

// ToolOverridesFromEnv reads NODE_REPL_TOOL_OVERRIDES.
func ToolOverridesFromEnv() (*ToolOverrides, error) {
	return ParseToolOverrides(os.Getenv("NODE_REPL_TOOL_OVERRIDES"))
}

var overridableTools = map[string]bool{
	"js":                     true,
	"js_add_node_module_dir": true,
	"js_reset":               true,
}

func (o *ToolOverrides) instructions(fallback string) string {
	if o == nil || o.ServerInstructions == "" {
		return fallback
	}
	return o.ServerInstructions
}

// apply rewrites tool definitions in place.
func (o *ToolOverrides) apply(tools []map[string]any) {
	if o == nil {
		return
	}
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		override, ok := o.Tools[name]
		if !ok {
			continue
		}
		if override.Description != "" {
			tool["description"] = override.Description
		}
		schema, _ := tool["inputSchema"].(map[string]any)
		properties, _ := schema["properties"].(map[string]any)
		for field, description := range override.FieldDescriptions {
			property, ok := properties[field].(map[string]any)
			if !ok || description == "" {
				continue
			}
			property["description"] = description
		}
	}
}
