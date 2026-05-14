{
  lib,
  stdenv,
  fetchPnpmDeps,
  electron,
  ecos-server,
  makeWrapper,
  nodejs,
  pnpmConfigHook,
  pnpm,
  python3,
  yosysWithSlang,
}:

let
  apiServerBinaryName =
    if stdenv.hostPlatform.system == "x86_64-linux" then
      "api-server-x86_64-unknown-linux-gnu"
    else if stdenv.hostPlatform.system == "aarch64-linux" then
      "api-server-aarch64-unknown-linux-gnu"
    else
      throw "Unsupported ECOS Studio GUI host platform: ${stdenv.hostPlatform.system}";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "ecos-studio";
  version = "0.1.0-alpha.5";

  src =
    with lib.fileset;
    toSource {
      root = ./.;
      fileset = intersection (gitTracked ./. ) (unions [
        ./README.md
        ./.gitignore
        ./.nvmrc
        ./apps
        ./packages
        ./package.json
        ./pnpm-lock.yaml
        ./pnpm-workspace.yaml
        ./tailwind.config.ts
      ]);
    };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) version src;
    pname = "${finalAttrs.pname}-${finalAttrs.version}-pnpm-deps";
    fetcherVersion = 2;
    hash = "sha256-wJBkYmBoG/4LOJcU1+b5o7RKL3Ii6Ph4cLHh67ZkmWY=";
  };

  nativeBuildInputs = [
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild

    mkdir -p apps/desktop-electron/resources/binaries
    cp ${ecos-server}/bin/ecos-server apps/desktop-electron/resources/binaries/${apiServerBinaryName}
    chmod +x apps/desktop-electron/resources/binaries/${apiServerBinaryName}

    mkdir -p apps/desktop-electron/resources/oss-cad-suite/bin
    ln -s ${yosysWithSlang}/bin/yosys apps/desktop-electron/resources/oss-cad-suite/bin/yosys
    echo "nix-provided OSS CAD bundle" > apps/desktop-electron/resources/oss-cad-suite/README

    pnpm install --offline --frozen-lockfile
    pnpm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app_root="$out/share/ecos-studio"
    mkdir -p "$app_root/apps/desktop-electron" "$app_root/server" "$out/bin"

    cp -R apps/desktop-electron/dist "$app_root/apps/desktop-electron/"
    cp apps/desktop-electron/package.json "$app_root/apps/desktop-electron/package.json"
    cp -R apps/desktop-electron/resources "$app_root/apps/desktop-electron/"

    cat > "$app_root/server/run_server.py" <<'PY'
#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BINARY = ROOT / "apps" / "desktop-electron" / "resources" / "binaries" / "${apiServerBinaryName}"
OSS_CAD_DIR = ROOT / "apps" / "desktop-electron" / "resources" / "oss-cad-suite"

if not BINARY.exists():
    raise SystemExit(f"Bundled API server binary not found: {BINARY}")

os.environ.setdefault("CHIPCOMPILER_OSS_CAD_DIR", str(OSS_CAD_DIR))
os.execv(str(BINARY), [str(BINARY), *sys.argv[1:]])
PY
    chmod +x "$app_root/server/run_server.py"

    makeWrapper ${electron}/bin/electron "$out/bin/ecos-studio" \
      --add-flags "$app_root/apps/desktop-electron" \
      --prefix PATH : ${lib.makeBinPath [ python3 ]} \
      --set-default ECOS_SERVER_DIRECTORY "$app_root/server" \
      --set-default ECOS_ELECTRON_BINARIES_DIR "$app_root/apps/desktop-electron/resources/binaries" \
      --set-default ECOS_ELECTRON_OSS_CAD_DIR "$app_root/apps/desktop-electron/resources/oss-cad-suite" \
      --set-default CHIPCOMPILER_OSS_CAD_DIR "$app_root/apps/desktop-electron/resources/oss-cad-suite"

    runHook postInstall
  '';

  doCheck = false;

  meta = {
    mainProgram = "ecos-studio";
  };
})
