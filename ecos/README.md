# ECOS Studio

## Development

```bash
cd ecos/server && uv sync
cd ecos/gui && pnpm install && pnpm tauri dev
```

## Release Build

```bash
bazel build //:ecos_studio_bundle
```

