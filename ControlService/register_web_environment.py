"""Register one validated 2:1 PNG panorama for Matrix Web worlds."""
import argparse
import json
from pathlib import Path

from web_environments import WebEnvironmentCatalog, WebEnvironmentError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("png", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--catalog", type=Path,
                        default=Path(__file__).with_name("web_environments"))
    args = parser.parse_args()
    try:
        entry = WebEnvironmentCatalog(args.catalog).register(args.png, args.name)
    except (OSError, ValueError, WebEnvironmentError) as error:
        parser.error(str(error))
    print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
