{
  nixConfig = {
    extra-trusted-substituters = [
      "https://serve.eminrepo.cc/"
    ];
    extra-trusted-public-keys = [ "serve.eminrepo.cc:fgdTGDMn75Z0NOvTmus/Z9Fyh6ExgoqddNVkaYVi5qk=" ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    parts.url = "github:hercules-ci/flake-parts";
    ecc.url = "git+ssh://git@github.com/openecos-projects/ecc";
    ecc.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      parts,
      ecc,
      ...
    }:
    let
      overlay = (final: prev: {
        ecos-server = final.callPackage ./ecos/server { };
        ecos-studio = final.callPackage ./ecos/gui { };
      });
      eccOverlay = inputs.ecc.overlays.default;
      infraOverlay = inputs.ecc.inputs.infra.overlays.default;
    in
    parts.lib.mkFlake { inherit inputs; } {
      imports = [ ];
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
          packages = {
            inherit (pkgs) ecos-studio;
          };
        };
    };
}
