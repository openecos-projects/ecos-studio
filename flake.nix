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
              (final: prev: {
                ecc-tools = (inputs'.ecc.packages.ecc-tools).overrideAttrs (old: {
                  postPatch =
                    (old.postPatch or "") + ''
                      sed -i '1i find_package(Boost REQUIRED)' src/operation/iPA/test/CMakeLists.txt
                      sed -i 's/boost_system/Boost::headers/g' src/operation/iPA/test/CMakeLists.txt
                    '';
                });
                chipcompiler =
                  (inputs'.ecc.packages.chipcompiler).override
                    {
                      ecc-tools = final.ecc-tools;
                    }
                    .overrideAttrs
                    (old: {
                      postPatch =
                        (old.postPatch or "")
                        + ''
                          sed -i 's/uv-build>=0.8.5,<0.10/uv-build>=0.8.5/' pyproject.toml
                        '';
                    });
              })
              ecc.inputs.infra.overlays.default # yosysWithSlang
              overlay
            ];
          };
          packages = {
            inherit (pkgs) ecos-studio;
          };
        };
    };
}
