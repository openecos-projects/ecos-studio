{
  lib,
  stdenv,
  fetchPnpmDeps,
  chipcompiler-cli,
  electron,
  makeWrapper,
  nodejs,
  pnpmConfigHook,
  pnpm,
  python3,
  yosysWithSlang,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "ecos-studio";
  version = "0.1.0-alpha.5";

  src =
    with lib.fileset;
    toSource {
      root = ./.;
      fileset = unions [
        ./README.md
        ./.gitignore
        ./.nvmrc
        ./apps
        ./packages
        ./package.json
        ./pnpm-lock.yaml
        ./pnpm-workspace.yaml
        ./tailwind.config.ts
      ];
    };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) version src;
    pname = "${finalAttrs.pname}-${finalAttrs.version}-pnpm-deps";
    fetcherVersion = 2;
    hash = "sha256-yspTctYMugjfMTyyaWd+diJHHbByI4T7WlTSnO/eSyg=";
  };

  nativeBuildInputs = [
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
    python3
  ];

  postPatch = ''
    cat <<EOF >> ./pnpm-workspace.yaml
    nodeLinker: hoisted
    shamefullyHoist: true
    EOF
  '';

  buildPhase = ''
    runHook preBuild

    pnpm run build
    # rebuild node-pty
    npm_config_nodedir=${electron.headers} pnpm --filter @ecos-studio/desktop-electron exec \
      electron-rebuild -f -v ${electron.version}
    CI=true pnpm install --frozen-lockfile --ignore-scripts --prod

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app_root="$out/share/ecos-studio"
    mkdir -p "$app_root/apps/desktop-electron" "$out/bin"

    cp -R node_modules "$app_root/node_modules"
    cp -R apps/desktop-electron/dist "$app_root/apps/desktop-electron/"
    cp apps/desktop-electron/package.json "$app_root/apps/desktop-electron/package.json"

    makeWrapper ${electron}/bin/electron "$out/bin/ecos-studio" \
      --add-flags "$app_root/apps/desktop-electron" \
      --prefix PATH : ${lib.makeBinPath [ chipcompiler-cli yosysWithSlang ]} \

    runHook postInstall
  '';

  doCheck = false;
  dontCheckForBrokenSymlinks = true;

  meta = {
    mainProgram = "ecos-studio";
  };
})
