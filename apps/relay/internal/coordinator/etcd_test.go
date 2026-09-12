package coordinator

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"testing"
	"time"

	"go.etcd.io/etcd/server/v3/embed"
)

func TestEtcdRegistersWorkersAndClaimsStableOwner(t *testing.T) {
	t.Parallel()
	endpoint, stop := startEmbeddedEtcd(t)
	defer stop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	firstNode := Node{ID: "worker-one", Internal: "https://worker-one.test"}
	secondNode := Node{ID: "worker-two", Internal: "https://worker-two.test"}
	first, err := NewEtcd(ctx, []string{endpoint}, &firstNode, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := NewEtcd(ctx, []string{endpoint}, &secondNode, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	key := ServerKey("server-for-etcd-test")
	owner, err := first.Route(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := second.Route(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if owner.ID != again.ID {
		t.Fatalf("ownership changed: %q then %q", owner.ID, again.ID)
	}
}

func TestEtcdReassignsAStaleOwner(t *testing.T) {
	t.Parallel()
	endpoint, stop := startEmbeddedEtcd(t)
	defer stop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	firstNode := Node{ID: "worker-one", Internal: "https://worker-one.test"}
	secondNode := Node{ID: "worker-two", Internal: "https://worker-two.test"}
	first, err := NewEtcd(ctx, []string{endpoint}, &firstNode, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := NewEtcd(ctx, []string{endpoint}, &secondNode, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	key := ServerKey("server-with-stale-owner")
	owner, err := first.Route(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := first.client.Delete(ctx, Prefix+"/nodes/"+owner.ID); err != nil {
		t.Fatal(err)
	}
	reassigned, err := second.Route(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if reassigned.ID == owner.ID {
		t.Fatalf("stale owner %q was not replaced", owner.ID)
	}
}

func TestEtcdCloseRevokesWorkerRegistrationImmediately(t *testing.T) {
	t.Parallel()
	endpoint, stop := startEmbeddedEtcd(t)
	defer stop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	observer, err := NewEtcd(ctx, []string{endpoint}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	node := Node{ID: "worker-to-close", Internal: "https://worker-to-close.test"}
	worker, err := NewEtcd(ctx, []string{endpoint}, &node, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := observer.client.Get(ctx, Prefix+"/nodes/"+node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Kvs) != 1 {
		t.Fatalf("worker registration count before close = %d", len(before.Kvs))
	}
	if err := worker.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := observer.client.Get(ctx, Prefix+"/nodes/"+node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Kvs) != 0 {
		t.Fatalf("worker registration remained after close: %d keys", len(after.Kvs))
	}
}

func startEmbeddedEtcd(t *testing.T) (string, func()) {
	t.Helper()
	clientPort := reserveTCPPort(t)
	peerPort := reserveTCPPort(t)
	clientURL := mustURL(t, fmt.Sprintf("http://127.0.0.1:%d", clientPort))
	peerURL := mustURL(t, fmt.Sprintf("http://127.0.0.1:%d", peerPort))
	config := embed.NewConfig()
	config.Dir = t.TempDir()
	config.LogLevel = "error"
	config.ListenClientUrls = []url.URL{clientURL}
	config.AdvertiseClientUrls = []url.URL{clientURL}
	config.ListenPeerUrls = []url.URL{peerURL}
	config.AdvertisePeerUrls = []url.URL{peerURL}
	config.InitialCluster = config.InitialClusterFromName(config.Name)
	server, err := embed.StartEtcd(config)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-server.Server.ReadyNotify():
	case <-time.After(15 * time.Second):
		server.Close()
		t.Fatal("embedded etcd did not become ready")
	}
	return clientURL.String(), server.Close
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func mustURL(t *testing.T, value string) url.URL {
	t.Helper()
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return *parsed
}
