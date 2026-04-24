{
  lib,
  python3Packages,
  chipcompiler,
}:

python3Packages.buildPythonPackage {
  pname = "ecos-server";
  version = "0.1.0-alpha.4";
  pyproject = true;

  src =
    with lib.fileset;
    toSource {
      root = ./.;
      fileset = unions [
        ./ecos.spec
        ./uv.lock
        ./pyproject.toml
        ./run_server.py
        ./ecos_server
      ];
    };

  build-system = with python3Packages; [ hatchling ];

  dependencies = [
    chipcompiler
  ]
  ++ (with python3Packages; [
    fastapi
    uvicorn
  ]);

  # Skip tests for now (they require full environment setup)
  doCheck = false;

  pythonImportsCheck = [
    "ecos_server"
  ];

  meta = {
    description = "API server for ECOS Studio";
    homepage = "https://github.com/openecos-projects/ecos-studio";
    platforms = lib.platforms.linux;
    maintainers = [ ];
    mainProgram = "ecos-server";
  };
}
