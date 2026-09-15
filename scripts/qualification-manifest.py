from pathlib import Path
import hashlib, json, datetime
ROOT=Path(r'C:\Users\Ashley\Resonance\OpenNova\apps\epublisher-sovereign-local-v0.1')
OUT=ROOT/'docs'/'generated'/'FINAL_BUILD_IDENTITY_20260912.json'
EXACT=['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.types.json','index.html','.env.local']
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def collect_source():
    files=[]
    for base in [ROOT/'src',ROOT/'scripts']:
        if base.exists(): files += [p for p in base.rglob('*') if p.is_file() and not p.name.endswith('.bak')]
    files += [ROOT/x for x in EXACT if (ROOT/x).is_file()]
    return sorted(set(files),key=lambda p:p.relative_to(ROOT).as_posix())
def tree(files):
    rows=[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in files]
    digest=hashlib.sha256(''.join(f"{r['path']}\t{r['sha256']}\n" for r in rows).encode()).hexdigest()
    return rows,digest
source_files,source_id=tree(collect_source())
dist_files=sorted([p for p in (ROOT/'dist').rglob('*') if p.is_file()],key=lambda p:p.relative_to(ROOT).as_posix())
dist_rows,dist_id=tree(dist_files)
config={}
for name in EXACT:
    p=ROOT/name
    if p.is_file(): config[name]={'sha256':sha(p),'bytes':p.stat().st_size,'contentRecorded':False if name=='.env.local' else True}
data={
 'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'machine':'Ealiophin','app':'epublisher-sovereign-local-v0.1','identityMethod':'SHA-256 tree manifest; no Git commit available',
 'source':{'aggregateSha256':source_id,'fileCount':len(source_files),'files':source_files},
 'configuration':config,
 'dist':{'aggregateSha256':dist_id,'fileCount':len(dist_rows),'files':dist_rows},
}
OUT.write_text(json.dumps(data,indent=2),encoding='utf-8')
print(f'SOURCE_ID={source_id}')
print(f'SOURCE_FILES={len(source_files)}')
print(f'DIST_ID={dist_id}')
print(f'DIST_FILES={len(dist_rows)}')
print(f'OUT={OUT}')