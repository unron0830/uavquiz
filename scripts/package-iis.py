"""Package a NEW IIS site directory after `npm run build -w apps/web`.
Usage: python scripts/package-iis.py OUTPUT DATA_SOURCE
DATA_SOURCE is an existing site's App_Data. Existing output is never overwritten.
"""
from pathlib import Path
import json
import re
import shutil
import sys
import secrets

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'iis/quiz'

assets = out / 'assets'
if assets.exists() and assets.resolve().parent == out.resolve(): shutil.rmtree(assets)
shutil.copytree(root / 'apps/web/dist', out, dirs_exist_ok=True)
shutil.copy2(root / 'apps/iis/web.config', out / 'web.config')
usings, bodies = [], []
for p in sorted((root / 'apps/iis/App_Code').glob('*.cs')):
    src = p.read_text(encoding='utf-8-sig')
    for line in src.splitlines():
        if re.match(r'^\s*using\s+[\w.]+\s*;\s*$', line) and line.strip() not in usings:
            usings.append(line.strip())
    bodies.append('// ' + p.name + '\n' + re.sub(r'^\s*using\s+[\w.]+\s*;\s*\n', '', src, flags=re.M))
head = '<%@ WebHandler Language="C#" Class="Uqa.Api" %>\n<%@ Assembly Name="System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31BF3856AD364E35" %>\n<%@ Assembly Name="System.Drawing, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a" %>\n'
(out / 'api.ashx').write_text(head + '\n'.join(usings) + '\n\n' + '\n'.join(bodies), encoding='utf-8-sig')
