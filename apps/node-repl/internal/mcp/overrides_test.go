package mcp

import "testing"

func TestToolOverridesReplaceDescriptions(t *testing.T) {
	overrides, err := ParseToolOverrides(`{
		"server_instructions": "UI automation through cua_repl.",
		"tools": {
			"js": {"description": "Control apps.", "field_descriptions": {"code": "JavaScript for cua."}},
			"js_reset": {"description": "Reset cua."}
		}
	}`)
	if err != nil {
		t.Fatalf("parse overrides: %v", err)
	}
	if got := overrides.instructions("default"); got != "UI automation through cua_repl." {
		t.Fatalf("instructions = %q", got)
	}

	tools := baseToolDefinitions()
	overrides.apply(tools)
	byName := map[string]map[string]any{}
	for _, tool := range tools {
		byName[tool["name"].(string)] = tool
	}
	if got := byName["js"]["description"]; got != "Control apps." {
		t.Fatalf("js description = %v", got)
	}
	code := byName["js"]["inputSchema"].(map[string]any)["properties"].(map[string]any)["code"].(map[string]any)
	if got := code["description"]; got != "JavaScript for cua." {
		t.Fatalf("code description = %v", got)
	}
	if got := byName["js_reset"]["description"]; got != "Reset cua." {
		t.Fatalf("js_reset description = %v", got)
	}
	if got := byName["turn_ended"]["description"]; got == "" {
		t.Fatal("turn_ended lost its description")
	}
}

func TestToolOverridesRejectUnknownTools(t *testing.T) {
	if _, err := ParseToolOverrides(`{"tools":{"turn_ended":{"description":"x"}}}`); err == nil {
		t.Fatal("expected turn_ended to be rejected")
	}
	if _, err := ParseToolOverrides(`not json`); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
	overrides, err := ParseToolOverrides("")
	if err != nil || overrides != nil {
		t.Fatalf("empty overrides = %v, %v", overrides, err)
	}
	if got := overrides.instructions("default"); got != "default" {
		t.Fatalf("nil overrides instructions = %q", got)
	}
}
