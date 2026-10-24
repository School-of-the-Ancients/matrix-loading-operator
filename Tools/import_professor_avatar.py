"""Import an owner-supplied VRM 1.0 into a chosen local Matrix asset directory.

This copies unchanged bytes for local use. It does not download, modify, publish,
or grant rights to the model. Keep restricted models outside version control.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ControlService'))
from web_assets import WebAssetCatalog, inspect_glb

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--name',required=True)
    args=parser.parse_args()
    source=args.source.resolve(strict=True)
    if not inspect_glb(source).get('vrm'):
        parser.error('Expected a validated VRM 1.0 file')
    entry=WebAssetCatalog(args.catalog).register(source,args.name,'Owner-supplied local avatar; approximate representation.')
    print(json.dumps({'assetId':entry['assetId'],'sha256':entry['sha256'],'byteLength':entry['byteLength']}))

if __name__=='__main__':main()
