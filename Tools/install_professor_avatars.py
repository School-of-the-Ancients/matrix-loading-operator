"""Register bundled Professor models without changing existing assets or scenes."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ControlService'))
from web_assets import WebAssetCatalog
from professor_avatars import bundled_catalog_path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,required=True)
    args=parser.parse_args()
    source=bundled_catalog_path().parent
    catalog=WebAssetCatalog(args.catalog)
    results=[]
    for item in json.loads((source/'catalog.json').read_text(encoding='utf-8'))['avatars']:
        path=source/item['file']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
            raise ValueError('Bundled professor hash mismatch')
        entry=catalog.register(path,item['displayName'],item.get('source','Original stylized human scholar. Approximate representation; MIT project license.'))
        results.append({'name':entry['displayName'],'assetId':entry['assetId']})
    print(json.dumps(results))

if __name__=='__main__':main()
