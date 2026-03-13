{
  lib,
  stdenv,
  rustPlatform,
  fetchPnpmDeps,
  cargo-tauri,
  ecos-server,
  glib-networking,
  nodejs,
  pnpmConfigHook,
  pnpm,
  openssl,
  pkg-config,
  webkitgtk_4_1,
  wrapGAppsHook4,
  yosysWithSlang,
}:

rustPlatform.buildRustPackage (finalAttrs: {
  pname = "ecos-studio";
  version = "0.1.0-alpha";

  src =
    with lib.fileset;
    toSource {
      root = ./.;
      fileset = unions [
        ./README.md
        ./index.html
        ./.gitignore
        ./.nvmrc
        ./package.json
        ./pnpm-lock.yaml
        ./tailwind.config.ts
        ./tsconfig.json
        ./tsconfig.node.json
        ./vite.config.ts
        ./src
        ./src-tauri
        ./public
      ];
    };

  cargoHash = "sha256-FWwjXeTCXqGUfOv+EZUGCFm0iHeFuMqYLaFaUf9W4lo=";

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) version src;
    pname = "${finalAttrs.pname}-${finalAttrs.version}-pnpm-deps";
    fetcherVersion = 2;
    hash = "sha256-wJBkYmBoG/4LOJcU1+b5o7RKL3Ii6Ph4cLHh67ZkmWY=";
  };

  nativeBuildInputs = [
    cargo-tauri.hook

    nodejs
    pnpm
    pnpmConfigHook

    # Make sure we can find our libraries
    pkg-config
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [ wrapGAppsHook4 ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    glib-networking # Most Tauri apps need networking
    openssl
    webkitgtk_4_1
  ];

  preBuild = ''
    mkdir -p src-tauri/binaries
    cp ${ecos-server}/bin/ecos-server src-tauri/binaries/api-server-x86_64-unknown-linux-gnu

    # Keep Tauri resource globs valid even when OSS CAD suite payload is not vendored yet.
    mkdir -p src-tauri/resources/oss-cad-suite
    echo "placeholder for nix build" > src-tauri/resources/oss-cad-suite/README
    echo "placeholder" > src-tauri/resources/oss-cad-suite/placeholder.txt
  '';

  postFixup = ''
    mkdir -p $out/lib/ECOS-Studio/resources/oss-cad-suite/bin
    ln -s ${yosysWithSlang}/bin/yosys $out/lib/ECOS-Studio/resources/oss-cad-suite/bin/yosys

    wrapProgram $out/bin/ecos-studio \
      --set CHIPCOMPILER_OSS_CAD_DIR "${yosysWithSlang}"
  '';

  # Set our Tauri source directory
  cargoRoot = "src-tauri";
  buildAndTestSubdir = finalAttrs.cargoRoot;
  doCheck = false;
})
