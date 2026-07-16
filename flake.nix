{
  description = "Flake for ECOS Studio";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    ecc.url = "git+https://github.com/openecos-projects/ecc.git";
  };

  outputs =
    inputs@{
      parts,
      treefmt-nix,
      ecc,
      ...
    }:
    parts.lib.mkFlake { inherit inputs; } {
      imports = [
        treefmt-nix.flakeModule
      ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      perSystem =
        {
          inputs',
          self',
          pkgs,
          system,
          ...
        }:
        {
          packages.default = pkgs.callPackage ./ecos/gui {
            chipcompiler-cli = ecc.packages.${system}.default;
            inherit (self'.packages) layout-viewer;
            inherit (ecc.inputs.infra.packages.${system}) yosysWithSlang;
          };
          packages.layout-viewer = pkgs.callPackage ./ecos/layout-viewer { };
          devShells.default = pkgs.mkShell {
            inputsFrom = [ self'.packages.layout-viewer ];
            ELECTRON_EXEC_PATH = "${pkgs.electron}/bin/electron";
            CUSTOM_FPM_PATH = "${pkgs.fpm}/bin/fpm";
            ECOS_ECC_USE_NIX = true;
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (
              with pkgs;
              [
                libxkbcommon
                libGL
                wayland
                expat
              ]
            );
            nativeBuildInputs = with pkgs; [
              ecc.inputs.infra.packages.${system}.yosysWithSlang
              nodejs
              pnpm
              uv
              appimage-run
              nixfmt
              git
            ];
          };
          treefmt = {
            projectRootFile = "flake.nix";
            programs = {
              nixfmt.enable = true;
              nixfmt.package = pkgs.nixfmt;
            };
            flakeCheck = true;
          };
        };
    };
}
