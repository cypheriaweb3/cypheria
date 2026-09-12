package coordinator

import "testing"

func TestServerKeyDoesNotExposeServerID(t *testing.T) {
	t.Parallel()
	key := ServerKey("private-server-id")
	if key == "private-server-id" || len(key) != 64 {
		t.Fatalf("unexpected key %q", key)
	}
}

func TestRendezvousIsStable(t *testing.T) {
	t.Parallel()
	nodes := []Node{{ID: "one"}, {ID: "two"}, {ID: "three"}}
	first, err := Rendezvous("key", nodes)
	if err != nil {
		t.Fatal(err)
	}
	for range 10 {
		next, err := Rendezvous("key", nodes)
		if err != nil || next.ID != first.ID {
			t.Fatalf("route was not stable: %#v %#v", first, next)
		}
	}
}
