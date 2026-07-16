{
  lib,
  rustPlatform,
  pkg-config,
  libGL,
  libxkbcommon,
  libx11,
  libxcursor,
  libxi,
  libxrandr,
  makeWrapper,
  wayland,
}:

rustPlatform.buildRustPackage {
  pname = "ecos-layout-viewer";
  version = "0.1.0";

  src =
    with lib.fileset;
    toSource {
      root = ./.;
      fileset = unions [
        ./Cargo.toml
        ./Cargo.lock
        ./apps
        ./crates
      ];
    };

  cargoLock = {
    lockFile = ./Cargo.lock;
  };

  nativeBuildInputs = [
    makeWrapper
    pkg-config
  ];

  buildInputs = [
    libGL
    libxkbcommon
    libx11
    libxcursor
    libxi
    libxrandr
    wayland
  ];

  cargoBuildFlags = [
    "-p"
    "ecos-layout-packer"
    "-p"
    "layout-viewer-native"
  ];

  doCheck = false;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"

    packer_path="$(find target -path '*/release/ecos-layout-packer' -type f | head -n 1)"
    viewer_path="$(find target -path '*/release/layout-viewer-native' -type f | head -n 1)"

    if [ -z "$packer_path" ] || [ -z "$viewer_path" ]; then
      echo "layout-viewer binaries were not found under target/**/release" >&2
      find target -maxdepth 4 -type f -perm -111 -print >&2
      exit 1
    fi

    install -m755 "$packer_path" "$out/bin/ecos-layout-packer"
    install -m755 "$viewer_path" "$out/bin/layout-viewer-native"
    wrapProgram "$out/bin/layout-viewer-native" \
      --prefix LD_LIBRARY_PATH : ${
        lib.makeLibraryPath [
          libxkbcommon
          libGL
          wayland
        ]
      }

    runHook postInstall
  '';

  meta = {
    mainProgram = "layout-viewer-native";
  };
}
