# `@cypheria/web3`

Pure, testable Web3 domain modules shared by the Cypheria Server and privileged Desktop boundaries.

## Public entry points

- `@cypheria/web3/network`: chain identity, network and RPC schemas, catalog data, URL and conversion helpers.
- `@cypheria/web3/policy`: signing-policy schemas and deterministic evaluation.
- `@cypheria/web3/wallet`: wallet, account, chain-account, capability, context, and signing-intent models.
- `@cypheria/web3/provider`: dApp sessions, Ethereum and Solana bridges, permissions, events, and bounded transport schemas.

```ts
import { evaluateSigningPolicies } from "@cypheria/web3/policy"
import { createEthereumProvider } from "@cypheria/web3/provider"
```

## Dependency boundary

The package contains no database or filesystem access, secret custody, signing execution, RPC credential storage, or service lifecycle. Those responsibilities belong to `apps/server/src/runtime`. Provider transports forward validated requests to the Server and never handle private keys.

See [Web3](../../docs/web3.md) for lifecycle and security rules.
