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
          pkgs,
          system,
          ...
        }:
        {
          packages.default = pkgs.callPackage ./ecos/gui {
            chipcompiler-cli = ecc.packages.${system}.default;
            inherit (ecc.inputs.infra.packages.${system}) yosysWithSlang;
          };
          devShells.default = pkgs.mkShell {
            ELECTRON_EXEC_PATH = "${pkgs.electron}/bin/electron";
            CUSTOM_FPM_PATH = "${pkgs.fpm}/bin/fpm";
            nativeBuildInputs = with pkgs; [
              ecc.inputs.infra.packages.${system}.yosysWithSlang
              nodejs
              pnpm
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
