#!/usr/bin/env python3
"""Read-only native AX geometry validation on an existing dedicated Finder source."""
import json, pathlib, re, subprocess, sys
from run import receive
capture, session_dir, output = sys.argv[1:]
session_dir=pathlib.Path(session_dir);out=pathlib.Path(output);out.mkdir(parents=True,exist_ok=True)
session=json.loads((session_dir/'session.json').read_text());fixture=json.loads((session_dir/'fixture.json').read_text())
p=subprocess.Popen([capture,'--source','--backing',str(session['display']['id']),pathlib.Path(fixture['folder']).name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
def call(cmd):
 p.stdin.write(cmd+'\n');p.stdin.flush();return receive(p)
def rect(text):return list(map(float,re.findall(r'-?\d+(?:\.\d+)?',text)))
def overlap(a,b):return a[0]<b[0]+b[2] and b[0]<a[0]+a[2] and a[1]<b[1]+b[3] and b[1]<a[1]+a[3]
try:
 assert receive(p).get('ready')
 m=call('@wire-metadata');nodes=call('@axdump')['elements']
 root=next(n for n in nodes if n.get('AXRole')=='AXWindow');origin=rect(root['frame'])
 toolbar=next(n for n in nodes if n.get('AXRole')=='AXToolbar');bar=rect(toolbar['frame']);bar[0]-=origin[0];bar[1]-=origin[1]
 regions=[[r[k] for k in ('x','y','width','height')] for r in m['dragRegions']]
 assert 'sourceDragRegions' in m['capabilities'] and 0<len(regions)<=32
 roles={'AXButton','AXMenuButton','AXPopUpButton','AXTextField','AXCheckBox','AXRadioButton','AXSlider','AXComboBox','AXLink','AXMenuItem'}
 controls=[]
 for n in nodes:
  if n.get('AXRole') not in roles or 'frame' not in n:continue
  r=rect(n['frame']);r[0]-=origin[0];r[1]-=origin[1]
  if r[2]>0 and r[3]>0 and overlap(r,bar):controls.append(r)
 for i,r in enumerate(regions):
  assert r[0]>=bar[0] and r[1]>=bar[1] and r[0]+r[2]<=bar[0]+bar[2] and r[1]+r[3]<=bar[1]+bar[3]
  assert not any(overlap(r,c) for c in controls)
  assert not any(overlap(r,c) for c in regions[:i])
 titles=[n for n in nodes if n.get('AXRole')=='AXStaticText' and n.get('AXValue')==root.get('AXTitle')]
 assert titles
 t=rect(titles[0]['frame']);point=[t[0]-origin[0]+t[2]/2,t[1]-origin[1]+t[3]/2]
 assert any(r[0]<=point[0]<r[0]+r[2] and r[1]<=point[1]<r[1]+r[3] for r in regions)
 result={'readOnlyActualFinder':True,'logicalSize':m['logicalSize'],'dragRegions':m['dragRegions'],'excludedToolbarControls':len(controls),'titleCenterDraggable':True,'overlap':False,'receiverDragTest':'pending paired validation'}
 (out/'drag-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 p.stdin.close();p.wait(timeout=10)
