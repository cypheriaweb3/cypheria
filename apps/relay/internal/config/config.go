package config

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

type Mode string

const (
	ModeSingle  Mode = "single"
	ModeCluster Mode = "cluster"
)

type Role string

const (
	RoleGateway Role = "gateway"
	RoleWorker  Role = "worker"
)

type Config struct {
	ConfigFile         string
	Mode               Mode
	Role               Role
	PublicAddr         string
	InternalAddr       string
	AdvertiseInternal  string
	NodeID             string
	EtcdEndpoints      []string
	InternalCAFile     string
	InternalCertFile   string
	InternalKeyFile    string
	InternalServerName string
	OTLPEndpoint       string
	MaxDataBytes       int64
	MaxControlBytes    int64
	IngressBudgetBytes int64
	AttachTimeout      time.Duration
	DeliveryTimeout    time.Duration
	TransportTimeout   time.Duration
}

type fileConfig struct {
	Mode   string `toml:"mode"`
	Role   string `toml:"role"`
	NodeID string `toml:"node_id"`

	Network struct {
		PublicAddr        string `toml:"public_addr"`
		InternalAddr      string `toml:"internal_addr"`
		AdvertiseInternal string `toml:"advertise_internal"`
	} `toml:"network"`

	Coordination struct {
		EtcdEndpoints []string `toml:"etcd_endpoints"`
	} `toml:"coordination"`

	InternalTLS struct {
		CAFile     string `toml:"ca_file"`
		CertFile   string `toml:"cert_file"`
		KeyFile    string `toml:"key_file"`
		ServerName string `toml:"server_name"`
	} `toml:"internal_tls"`

	Telemetry struct {
		OTLPEndpoint string `toml:"otlp_endpoint"`
	} `toml:"telemetry"`

	Limits struct {
		MaxDataBytes       *int64 `toml:"max_data_bytes"`
		MaxControlBytes    *int64 `toml:"max_control_bytes"`
		IngressBudgetBytes *int64 `toml:"ingress_budget_bytes"`
	} `toml:"limits"`

	Timeouts struct {
		Attach    string `toml:"attach"`
		Delivery  string `toml:"delivery"`
		Transport string `toml:"transport"`
	} `toml:"timeouts"`
}

func (c Config) Single() bool {
	return c.Mode == ModeSingle
}

func (c Config) ServesGateway() bool {
	return c.Single() || c.Role == RoleGateway
}

func (c Config) ServesWorker() bool {
	return c.Single() || c.Role == RoleWorker
}

func Parse(args []string, getenv func(string) string) (Config, error) {
	settings := defaultConfig()
	configFile, err := findConfigFile(args, getenv)
	if err != nil {
		return Config{}, err
	}
	if configFile != "" {
		if err := applyFile(&settings, configFile); err != nil {
			return Config{}, err
		}
		settings.ConfigFile = configFile
	}
	if err := applyEnvironment(&settings, getenv); err != nil {
		return Config{}, err
	}

	fs := flag.NewFlagSet("cypheria-relay", flag.ContinueOnError)
	mode := fs.String("mode", string(settings.Mode), "single or cluster")
	role := fs.String("role", string(settings.Role), "cluster role: gateway or worker")
	fs.StringVar(&settings.ConfigFile, "config", settings.ConfigFile, "TOML configuration file")
	fs.StringVar(&settings.PublicAddr, "public-addr", settings.PublicAddr, "public HTTP address")
	fs.StringVar(&settings.InternalAddr, "internal-addr", settings.InternalAddr, "internal worker address")
	fs.StringVar(&settings.AdvertiseInternal, "advertise-internal", settings.AdvertiseInternal, "advertised internal worker URL")
	fs.StringVar(&settings.NodeID, "node-id", settings.NodeID, "stable node identifier")
	fs.StringVar(&settings.InternalCAFile, "internal-ca", settings.InternalCAFile, "internal mTLS CA")
	fs.StringVar(&settings.InternalCertFile, "internal-cert", settings.InternalCertFile, "internal mTLS certificate")
	fs.StringVar(&settings.InternalKeyFile, "internal-key", settings.InternalKeyFile, "internal mTLS key")
	fs.StringVar(&settings.InternalServerName, "internal-server-name", settings.InternalServerName, "worker TLS server name override")
	fs.StringVar(&settings.OTLPEndpoint, "otlp-endpoint", settings.OTLPEndpoint, "OTLP gRPC endpoint")
	etcd := fs.String("etcd-endpoints", strings.Join(settings.EtcdEndpoints, ","), "comma-separated etcd endpoints")
	advertiseHost := fs.String("advertise-internal-host", strings.TrimSpace(getenv("CYPHERIA_RELAY_ADVERTISE_INTERNAL_HOST")), "worker host or pod IP advertised with the internal listener port")
	fs.Int64Var(&settings.MaxDataBytes, "max-data-bytes", settings.MaxDataBytes, "maximum data frame bytes")
	fs.Int64Var(&settings.MaxControlBytes, "max-control-bytes", settings.MaxControlBytes, "maximum control frame bytes")
	fs.Int64Var(&settings.IngressBudgetBytes, "ingress-budget-bytes", settings.IngressBudgetBytes, "process ingress memory budget")
	fs.DurationVar(&settings.AttachTimeout, "attach-timeout", settings.AttachTimeout, "peer attachment timeout")
	fs.DurationVar(&settings.DeliveryTimeout, "delivery-timeout", settings.DeliveryTimeout, "writer queue delivery timeout")
	fs.DurationVar(&settings.TransportTimeout, "transport-timeout", settings.TransportTimeout, "WebSocket transport timeout")
	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}
	if len(fs.Args()) != 0 {
		return Config{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(fs.Args(), " "))
	}

	settings.Mode = Mode(strings.ToLower(strings.TrimSpace(*mode)))
	settings.Role = Role(strings.ToLower(strings.TrimSpace(*role)))
	settings.EtcdEndpoints = splitList(*etcd)
	if host := strings.TrimSpace(*advertiseHost); host != "" {
		if settings.AdvertiseInternal != "" {
			return Config{}, errors.New("--advertise-internal-host and --advertise-internal cannot be used together")
		}
		_, port, err := net.SplitHostPort(settings.InternalAddr)
		if err != nil {
			return Config{}, fmt.Errorf("derive advertised worker port from internal address: %w", err)
		}
		settings.AdvertiseInternal = "https://" + net.JoinHostPort(host, port)
	}
	if err := settings.Validate(); err != nil {
		return Config{}, err
	}
	return settings, nil
}

func (c Config) Validate() error {
	if c.Mode != ModeSingle && c.Mode != ModeCluster {
		return fmt.Errorf("invalid --mode %q: expected single or cluster", c.Mode)
	}
	if c.MaxDataBytes <= 0 || c.MaxControlBytes <= 0 {
		return errors.New("frame limits must be positive")
	}
	if c.IngressBudgetBytes < c.MaxDataBytes {
		return errors.New("ingress budget must be at least one maximum data frame")
	}
	if c.AttachTimeout <= 0 || c.DeliveryTimeout <= 0 || c.TransportTimeout <= 0 {
		return errors.New("relay timeouts must be positive")
	}
	if c.Single() {
		if c.Role != "" {
			return errors.New("single mode does not accept --role")
		}
		if len(c.EtcdEndpoints) != 0 || c.AdvertiseInternal != "" || c.InternalCAFile != "" || c.InternalCertFile != "" || c.InternalKeyFile != "" || c.InternalServerName != "" {
			return errors.New("single mode does not use etcd, an advertised internal address, or internal TLS")
		}
	} else {
		if c.Role != RoleGateway && c.Role != RoleWorker {
			return fmt.Errorf("cluster mode requires --role=gateway or --role=worker, got %q", c.Role)
		}
		if len(c.EtcdEndpoints) == 0 {
			return errors.New("cluster mode requires CYPHERIA_RELAY_ETCD_ENDPOINTS or coordination.etcd_endpoints")
		}
		if c.Role == RoleWorker && c.AdvertiseInternal == "" {
			return errors.New("cluster worker role requires --advertise-internal")
		}
		if c.Role == RoleGateway && c.AdvertiseInternal != "" {
			return errors.New("cluster gateway role does not advertise an internal worker address")
		}
		if c.Role == RoleWorker && c.InternalServerName != "" {
			return errors.New("cluster worker role does not configure the gateway TLS server-name override")
		}
		if c.InternalCAFile == "" || c.InternalCertFile == "" || c.InternalKeyFile == "" {
			return errors.New("cluster mode requires internal CA, certificate, and key files")
		}
	}
	if len(c.NodeID) == 0 || len(c.NodeID) > 128 || strings.ContainsAny(c.NodeID, "/\\") {
		return errors.New("node ID must be 1-128 characters without path separators")
	}
	if c.AdvertiseInternal != "" {
		parsed, err := url.Parse(c.AdvertiseInternal)
		if err != nil || parsed.Host == "" || parsed.Scheme != "https" {
			return errors.New("advertise-internal must be an https URL")
		}
	}
	if strings.ContainsAny(c.InternalServerName, "/: 	\r\n") {
		return errors.New("internal TLS server name must be a DNS name or IP address without a port")
	}
	for _, endpoint := range c.EtcdEndpoints {
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Host == "" || parsed.Scheme != "https" {
			return fmt.Errorf("invalid etcd endpoint %q", endpoint)
		}
	}
	return nil
}

func defaultConfig() Config {
	return Config{
		Mode:               ModeSingle,
		PublicAddr:         "127.0.0.1:6770",
		InternalAddr:       "127.0.0.1:6771",
		NodeID:             hostname(),
		MaxDataBytes:       32*1024*1024 - 14,
		MaxControlBytes:    64 * 1024,
		IngressBudgetBytes: 512 * 1024 * 1024,
		AttachTimeout:      15 * time.Second,
		DeliveryTimeout:    30 * time.Second,
		TransportTimeout:   35 * time.Second,
	}
}

func findConfigFile(args []string, getenv func(string) string) (string, error) {
	path := strings.TrimSpace(getenv("CYPHERIA_RELAY_CONFIG_FILE"))
	for index := 0; index < len(args); index++ {
		argument := args[index]
		if argument == "--config" {
			if index+1 >= len(args) || strings.HasPrefix(args[index+1], "-") {
				return "", errors.New("--config requires a file path")
			}
			index++
			path = args[index]
			continue
		}
		if value, ok := strings.CutPrefix(argument, "--config="); ok {
			if value == "" {
				return "", errors.New("--config requires a file path")
			}
			path = value
		}
	}
	return strings.TrimSpace(path), nil
}

func applyFile(settings *Config, path string) error {
	var decoded fileConfig
	metadata, err := toml.DecodeFile(path, &decoded)
	if err != nil {
		return fmt.Errorf("read relay config %q: %w", path, err)
	}
	if unknown := metadata.Undecoded(); len(unknown) != 0 {
		values := make([]string, 0, len(unknown))
		for _, key := range unknown {
			values = append(values, key.String())
		}
		return fmt.Errorf("unknown relay config fields: %s", strings.Join(values, ", "))
	}
	if decoded.Mode != "" {
		settings.Mode = Mode(decoded.Mode)
	}
	if decoded.Role != "" {
		settings.Role = Role(decoded.Role)
	}
	if decoded.NodeID != "" {
		settings.NodeID = decoded.NodeID
	}
	applyString(&settings.PublicAddr, decoded.Network.PublicAddr)
	applyString(&settings.InternalAddr, decoded.Network.InternalAddr)
	applyString(&settings.AdvertiseInternal, decoded.Network.AdvertiseInternal)
	if decoded.Coordination.EtcdEndpoints != nil {
		settings.EtcdEndpoints = decoded.Coordination.EtcdEndpoints
	}
	applyString(&settings.InternalCAFile, decoded.InternalTLS.CAFile)
	applyString(&settings.InternalCertFile, decoded.InternalTLS.CertFile)
	applyString(&settings.InternalKeyFile, decoded.InternalTLS.KeyFile)
	applyString(&settings.InternalServerName, decoded.InternalTLS.ServerName)
	applyString(&settings.OTLPEndpoint, decoded.Telemetry.OTLPEndpoint)
	applyInt64(&settings.MaxDataBytes, decoded.Limits.MaxDataBytes)
	applyInt64(&settings.MaxControlBytes, decoded.Limits.MaxControlBytes)
	applyInt64(&settings.IngressBudgetBytes, decoded.Limits.IngressBudgetBytes)
	if err := applyDuration(&settings.AttachTimeout, decoded.Timeouts.Attach, "timeouts.attach"); err != nil {
		return err
	}
	if err := applyDuration(&settings.DeliveryTimeout, decoded.Timeouts.Delivery, "timeouts.delivery"); err != nil {
		return err
	}
	if err := applyDuration(&settings.TransportTimeout, decoded.Timeouts.Transport, "timeouts.transport"); err != nil {
		return err
	}
	return nil
}

func applyEnvironment(settings *Config, getenv func(string) string) error {
	if value := strings.TrimSpace(getenv("CYPHERIA_RELAY_MODE")); value != "" {
		settings.Mode = Mode(value)
	}
	if value := strings.TrimSpace(getenv("CYPHERIA_RELAY_ROLE")); value != "" {
		settings.Role = Role(value)
	}
	applyString(&settings.PublicAddr, strings.TrimSpace(getenv("CYPHERIA_RELAY_PUBLIC_ADDR")))
	applyString(&settings.InternalAddr, strings.TrimSpace(getenv("CYPHERIA_RELAY_INTERNAL_ADDR")))
	applyString(&settings.AdvertiseInternal, strings.TrimSpace(getenv("CYPHERIA_RELAY_ADVERTISE_INTERNAL")))
	applyString(&settings.NodeID, strings.TrimSpace(getenv("CYPHERIA_RELAY_NODE_ID")))
	applyString(&settings.InternalCAFile, strings.TrimSpace(getenv("CYPHERIA_RELAY_INTERNAL_CA_FILE")))
	applyString(&settings.InternalCertFile, strings.TrimSpace(getenv("CYPHERIA_RELAY_INTERNAL_CERT_FILE")))
	applyString(&settings.InternalKeyFile, strings.TrimSpace(getenv("CYPHERIA_RELAY_INTERNAL_KEY_FILE")))
	applyString(&settings.InternalServerName, strings.TrimSpace(getenv("CYPHERIA_RELAY_INTERNAL_SERVER_NAME")))
	applyString(&settings.OTLPEndpoint, strings.TrimSpace(getenv("OTEL_EXPORTER_OTLP_ENDPOINT")))
	if value := strings.TrimSpace(getenv("CYPHERIA_RELAY_ETCD_ENDPOINTS")); value != "" {
		settings.EtcdEndpoints = splitList(value)
	}
	if err := applyEnvInt64(&settings.MaxDataBytes, getenv, "CYPHERIA_RELAY_MAX_DATA_BYTES"); err != nil {
		return err
	}
	if err := applyEnvInt64(&settings.MaxControlBytes, getenv, "CYPHERIA_RELAY_MAX_CONTROL_BYTES"); err != nil {
		return err
	}
	if err := applyEnvInt64(&settings.IngressBudgetBytes, getenv, "CYPHERIA_RELAY_INGRESS_BUDGET_BYTES"); err != nil {
		return err
	}
	if err := applyEnvDuration(&settings.AttachTimeout, getenv, "CYPHERIA_RELAY_ATTACH_TIMEOUT"); err != nil {
		return err
	}
	if err := applyEnvDuration(&settings.DeliveryTimeout, getenv, "CYPHERIA_RELAY_DELIVERY_TIMEOUT"); err != nil {
		return err
	}
	return applyEnvDuration(&settings.TransportTimeout, getenv, "CYPHERIA_RELAY_TRANSPORT_TIMEOUT")
}

func applyString(target *string, value string) {
	if value != "" {
		*target = value
	}
}

func applyInt64(target *int64, value *int64) {
	if value != nil {
		*target = *value
	}
}

func applyDuration(target *time.Duration, value, name string) error {
	if value == "" {
		return nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fmt.Errorf("invalid %s: %w", name, err)
	}
	*target = parsed
	return nil
}

func applyEnvInt64(target *int64, getenv func(string) string, name string) error {
	value := strings.TrimSpace(getenv(name))
	if value == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid %s: %w", name, err)
	}
	*target = parsed
	return nil
}

func applyEnvDuration(target *time.Duration, getenv func(string) string, name string) error {
	return applyDuration(target, strings.TrimSpace(getenv(name)), name)
}

func splitList(value string) []string {
	var values []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			values = append(values, item)
		}
	}
	return values
}

func hostname() string {
	value, err := os.Hostname()
	if err != nil || value == "" {
		return "relay-node"
	}
	return value
}
