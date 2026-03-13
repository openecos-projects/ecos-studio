{
  description = "Flake for ECOS Studio";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    ecc.url = "git+ssh://git@github.com/openecos-projects/ecc";
    ecc.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      parts,
      treefmt-nix,
      ecc,
      ...
    }:
    let
      overlay = (
        final: prev: {
          ecos-server = final.callPackage ./ecos/server { };
          ecos-studio = final.callPackage ./ecos/gui { };
        }
      );
      eccOverlay = inputs.ecc.overlays.default;
      infraOverlay = inputs.ecc.inputs.infra.overlays.default;
    in
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
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [
              overlay
              eccOverlay
              infraOverlay
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
          packages = {
            inherit (pkgs) ecos-studio;
          };
        };
    };
}
