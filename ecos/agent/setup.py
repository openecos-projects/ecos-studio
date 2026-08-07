from pathlib import Path
from shutil import copytree, rmtree

from setuptools import setup
from setuptools.command.build_py import build_py as BuildPy


class BuildKnowledge(BuildPy):
    def run(self) -> None:
        super().run()
        package = Path(self.build_lib) / "ecos_agent"
        # build_py does not remove data relocated out of src between builds.
        for path in package.glob("*_knowledge"):
            if path.is_dir():
                rmtree(path)
        package.joinpath("place_knowledge.py").unlink(missing_ok=True)
        source = Path(__file__).parent / "knowledge"
        target = package / "knowledge"
        rmtree(target, ignore_errors=True)
        copytree(source, target)


setup(cmdclass={"build_py": BuildKnowledge})
