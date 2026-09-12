package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseDefaultsToSingleMode(t *testing.T) {
	t.Parallel()
	settings, err := Parse([]string{"--public-addr=0.0.0.0:6770"}, emptyEnvironment)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Mode != ModeSingle || settings.Role != "" {
		t.Fatalf("mode and role = %q, %q", settings.Mode, settings.Role)
	}
	if !settings.Single() || !settings.ServesGateway() || !settings.ServesWorker() {
		t.Fatalf("single mode components are incorrect: %#v", settings)
	}
	if len(settings.EtcdEndpoints) != 0 || settings.AdvertiseInternal != "" {
		t.Fatalf("single mode unexpectedly configured coordination: %#v", settings)
	}
}

func TestSingleModeRejectsClusterSettings(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{
		{"--mode=single", "--role=gateway"},
		{"--mode=single", "--etcd-endpoints=http://127.0.0.1:2379"},
		{"--mode=single", "--internal-ca=ca.pem"},
		{"--mode=single", "--internal-server-name=worker.internal"},
	} {
		if _, err := Parse(args, emptyEnvironment); err == nil {
			t.Fatalf("expected %v to be rejected", args)
		}
	}
}

func TestClusterModeRequiresRoleEtcdAndMTLS(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{
		{"--mode=cluster"},
		{"--mode=cluster", "--role=gateway"},
		{"--mode=cluster", "--role=gateway", "--etcd-endpoints=https://etcd.test:2379"},
	} {
		if _, err := Parse(args, emptyEnvironment); err == nil {
			t.Fatalf("expected %v to be rejected", args)
		}
	}
}

func TestClusterRoles(t *testing.T) {
	t.Parallel()
	base := []string{
		"--mode=cluster",
		"--etcd-endpoints=https://etcd.test:2379",
		"--internal-ca=ca.pem",
		"--internal-cert=cert.pem",
		"--internal-key=key.pem",
	}
	gateway, err := Parse(append(base, "--role=gateway", "--internal-server-name=worker.internal"), emptyEnvironment)
	if err != nil {
		t.Fatal(err)
	}
	if !gateway.ServesGateway() || gateway.ServesWorker() {
		t.Fatalf("gateway components are incorrect: %#v", gateway)
	}
	worker, err := Parse(append(base, "--role=worker", "--advertise-internal=https://worker.test:6771"), emptyEnvironment)
	if err != nil {
		t.Fatal(err)
	}
	if worker.ServesGateway() || !worker.ServesWorker() {
		t.Fatalf("worker components are incorrect: %#v", worker)
	}
}

func TestAdvertiseInternalHostUsesListenerPortAndIPv6Brackets(t *testing.T) {
	t.Parallel()
	settings, err := Parse([]string{
		"--mode=cluster",
		"--role=worker",
		"--internal-addr=[::]:7443",
		"--advertise-internal-host=2001:db8::1",
		"--etcd-endpoints=https://etcd.test:2379",
		"--internal-ca=ca.pem",
		"--internal-cert=cert.pem",
		"--internal-key=key.pem",
	}, emptyEnvironment)
	if err != nil {
		t.Fatal(err)
	}
	if settings.AdvertiseInternal != "https://[2001:db8::1]:7443" {
		t.Fatalf("advertised address = %q", settings.AdvertiseInternal)
	}
}

func TestLegacyModesAndClusterAllRoleAreRejected(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{
		{"--mode=all"},
		{"--mode=gateway"},
		{"--mode=worker"},
		{"--mode=cluster", "--role=all"},
	} {
		if _, err := Parse(args, emptyEnvironment); err == nil {
			t.Fatalf("expected legacy or invalid topology %v to be rejected", args)
		}
	}
}

func TestConfigPrecedence(t *testing.T) {
	t.Parallel()
	path := writeConfig(t, `
mode = "cluster"
role = "worker"
node_id = "from-file"

[network]
public_addr = "127.0.0.1:7000"
internal_addr = "127.0.0.1:7001"
advertise_internal = "https://worker.test:7001"

[coordination]
etcd_endpoints = ["https://etcd.test:2379"]

[internal_tls]
ca_file = "ca.pem"
cert_file = "cert.pem"
key_file = "key.pem"

[telemetry]
otlp_endpoint = "collector-file.test:4317"

[limits]
max_data_bytes = 1024
max_control_bytes = 512
ingress_budget_bytes = 4096

[timeouts]
attach = "5s"
delivery = "6s"
transport = "7s"
`)
	getenv := func(name string) string {
		values := map[string]string{
			"CYPHERIA_RELAY_NODE_ID":           "from-env",
			"CYPHERIA_RELAY_MAX_CONTROL_BYTES": "768",
			"OTEL_EXPORTER_OTLP_ENDPOINT":      "collector-env.test:4317",
		}
		return values[name]
	}
	settings, err := Parse([]string{"--config", path, "--node-id=from-flag", "--attach-timeout=8s"}, getenv)
	if err != nil {
		t.Fatal(err)
	}
	if settings.ConfigFile != path || settings.NodeID != "from-flag" {
		t.Fatalf("config path and node ID = %q, %q", settings.ConfigFile, settings.NodeID)
	}
	if settings.PublicAddr != "127.0.0.1:7000" || settings.MaxDataBytes != 1024 {
		t.Fatalf("file settings were not applied: %#v", settings)
	}
	if settings.MaxControlBytes != 768 || settings.OTLPEndpoint != "collector-env.test:4317" {
		t.Fatalf("environment settings were not applied: %#v", settings)
	}
	if settings.AttachTimeout != 8*time.Second || settings.DeliveryTimeout != 6*time.Second {
		t.Fatalf("timeout precedence is incorrect: %#v", settings)
	}
}

func TestConfigFileFromEnvironment(t *testing.T) {
	t.Parallel()
	path := writeConfig(t, "mode = \"single\"\nnode_id = \"configured\"\n")
	settings, err := Parse(nil, func(name string) string {
		if name == "CYPHERIA_RELAY_CONFIG_FILE" {
			return path
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if settings.ConfigFile != path || settings.NodeID != "configured" {
		t.Fatalf("environment-selected config was not loaded: %#v", settings)
	}
}

func TestUnknownConfigFieldFailsFast(t *testing.T) {
	t.Parallel()
	path := writeConfig(t, "mode = \"single\"\nmod = \"typo\"\n")
	_, err := Parse([]string{"--config=" + path}, emptyEnvironment)
	if err == nil || !strings.Contains(err.Error(), "unknown relay config fields: mod") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestExampleConfigFilesParse(t *testing.T) {
	t.Parallel()
	examples := []struct {
		name string
		args []string
	}{
		{name: "relay.single.example.toml"},
		{name: "relay.gateway.example.toml"},
		{name: "relay.worker.example.toml"},
	}
	for _, example := range examples {
		path := filepath.Join("..", "..", "config", example.name)
		if _, err := Parse(append([]string{"--config=" + path}, example.args...), emptyEnvironment); err != nil {
			t.Errorf("parse %s: %v", example.name, err)
		}
	}
}

func TestKustomizeConfigFilesParseWithRuntimeIdentity(t *testing.T) {
	t.Parallel()
	base := filepath.Join("..", "..", "deploy", "kustomize", "base", "config")
	cases := []struct {
		name string
		args []string
	}{
		{name: "gateway.toml", args: []string{"--node-id=relay-gateway-1"}},
		{
			name: "worker.toml",
			args: []string{
				"--node-id=relay-worker-0",
				"--advertise-internal-host=10.0.0.10",
			},
		},
	}
	for _, testCase := range cases {
		args := append([]string{"--config=" + filepath.Join(base, testCase.name)}, testCase.args...)
		if _, err := Parse(args, emptyEnvironment); err != nil {
			t.Errorf("parse %s: %v", testCase.name, err)
		}
	}
}

func TestDistributedEndpointsRequireTLS(t *testing.T) {
	t.Parallel()
	base := []string{
		"--mode=cluster",
		"--role=worker",
		"--internal-ca=ca.pem",
		"--internal-cert=cert.pem",
		"--internal-key=key.pem",
		"--advertise-internal=https://worker.test:6771",
	}
	_, err := Parse(append(base, "--etcd-endpoints=http://etcd.test:2379"), emptyEnvironment)
	if err == nil {
		t.Fatal("expected insecure remote etcd endpoint to be rejected")
	}
	args := append([]string{}, base...)
	args[5] = "--advertise-internal=http://worker.test:6771"
	_, err = Parse(append(args, "--etcd-endpoints=https://etcd.test:2379"), emptyEnvironment)
	if err == nil {
		t.Fatal("expected insecure worker advertisement to be rejected")
	}
}

func TestInvalidEnvironmentFailsFast(t *testing.T) {
	t.Parallel()
	for name, value := range map[string]string{
		"CYPHERIA_RELAY_MAX_DATA_BYTES": "not-a-number",
		"CYPHERIA_RELAY_ATTACH_TIMEOUT": "soon",
	} {
		_, err := Parse(nil, func(candidate string) string {
			if candidate == name {
				return value
			}
			return ""
		})
		if err == nil {
			t.Fatalf("expected malformed %s to be rejected", name)
		}
	}
}

func emptyEnvironment(string) string { return "" }

func writeConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "relay.toml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
