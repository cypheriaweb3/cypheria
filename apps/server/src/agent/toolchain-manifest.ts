import type { ToolchainId } from "@cypheria/protocol"

export type ToolchainPlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-arm64"
  | "win32-x64"

/** Managed toolchain releases reviewed for this Cypheria build. */
export const TOOLCHAIN_RELEASES = {
  node: {
    sha256: {
      "darwin-arm64": "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
      "darwin-x64": "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
      "linux-arm64": "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5",
      "linux-x64": "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
      "win32-arm64": "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921",
      "win32-x64": "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
    },
    version: "24.21.0",
  },
  python: { version: "3.14.7" },
  uv: {
    sha256: {
      "darwin-arm64": "85f00cbdc6dd3e97eba4c31b4d014375a9fdfe8f570023b84e5102fc3456896b",
      "darwin-x64": "8dcf05a8c809bb3c471d2b614788ba27a6e41298fc8c31ac84b5f4339fd468e5",
      "linux-arm64": "d636d1b678e9e7f367ecb22b46bd1cabbed234d6bc3b4d96365d2b507f72f86c",
      "linux-x64": "fa82fd8dde8e8eefdecada6aa0889666556cfceb690d06e0c3bca49eb3070a63",
      "win32-arm64": "3e1aa6849d77f0e00dc865e4afab5c5b32de053e21fe35bf5ad5cec3734ec976",
      "win32-x64": "a252121d5b59398fcb137c6ea448176459a44010f33f67e0072305a637119ca7",
    },
    version: "0.12.17",
  },
} as const satisfies Record<
  ToolchainId,
  { sha256?: Record<ToolchainPlatform, string>; version: string }
>
