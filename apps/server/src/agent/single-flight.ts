/** Share one pending initialization per key and permit retry after failure. */
export function getOrInitialize<K, V>(
  runtimes: Map<K, Promise<V>>,
  key: K,
  initialize: () => Promise<V>
): Promise<V> {
  const existing = runtimes.get(key)
  if (existing) return existing
  const pending = initialize()
  runtimes.set(key, pending)
  void pending.catch(() => {
    if (runtimes.get(key) === pending) runtimes.delete(key)
  })
  return pending
}
