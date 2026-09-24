"""Register a Blender-exported static GLB for hot loading by Matrix Web Runtime."""
import argparse
import json
from pathlib import Path

from web_assets import WebAssetCatalog, WebAssetError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--catalog", type=Path, default=Path(__file__).with_name("web_assets"))
    args = parser.parse_args()
    try:
        entry = WebAssetCatalog(args.catalog).register(args.glb, args.name, args.description)
    except (OSError, WebAssetError) as error:
        parser.error(str(error))
    print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
