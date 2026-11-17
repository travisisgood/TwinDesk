#!/usr/bin/env python3
"""Actual source-worker pointer/navigation and helper-crash recovery test."""
import json, os, pathlib, re, signal, subprocess, sys, time
from run import receive, script
binary=str(pathlib.Path(sys.argv[1]).resolve()); out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=False)
holder=worker=aux=None;fixture=None;results=[]
def call(p,m):
 p.stdin.write((m if isinstance(m,str) else json.dumps(m))+'\n');p.stdin.flush();return receive(p)
try:
 holder=subprocess.Popen([str(pathlib.Path(binary).with_name('FinderPortalBacking')),'180','-1280','0'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 display=receive(holder);assert display.get('ready'),display
 worker=subprocess.Popen(['/usr/bin/python3',str(pathlib.Path(__file__).with_name('source_worker.py')),binary,str(out),str(display['displayID']),'-1240','60'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 meta=receive(worker);assert 'pointer' in meta['capabilities'] and 'releaseAll' in meta['capabilities']
 fixture=json.load(open(out/'fixture.json'));title=pathlib.Path(fixture['folder']).name
 aux=subprocess.Popen([binary,'--source','--backing',str(display['displayID']),title],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);assert receive(aux)['ready']
 nodes=call(aux,'@axdump')['elements'];aux.stdin.close();aux.wait(timeout=5);aux=None
 def point(name):
  n=next(n for n in nodes if n.get('AXValue')==name and n.get('frame'))
  x,y,w,h=map(float,re.findall(r'-?\d+(?:\.\d+)?',n['frame']))
  return {'x':(x+w/2+1240)/799,'y':(y+h/2-60)/549}
 def event(phase,xy):
  r=call(worker,{'op':'pointer','args':{'phase':phase,'button':0,**xy}});assert r.get('AXError')==0,r;return r
 def click(name,count=1):
  xy=point(name)
  for i in range(count):event('down',xy);event('up',xy)
  time.sleep(.3)
  state=script(f'tell application "Finder" to get bounds of Finder window id {fixture["finderWindowID"]}')
  assert state=='-1240, 60, -440, 610',state
  selection=script('tell application "Finder"\nset names to {}\nrepeat with chosen in (get selection)\nset end of names to name of chosen\nend repeat\nreturn names\nend tell')
  target=script(f'tell application "Finder" to get POSIX path of (target of Finder window id {fixture["finderWindowID"]} as alias)')
  results.append({'action':name,'selection':selection,'childOpened':target.endswith('/PortalChild/'),'bounds':state})
  return selection,target
 assert click('Alpha.txt')[0]=='Alpha.txt'
 assert click('Beta.txt')[0]=='Beta.txt'
 assert click('PortalChild',2)[1].endswith('/PortalChild/')
 # Hold, explicitly release, then hold again and kill only the native capture helper.
 event('down',{'x':.5,'y':.5});assert call(worker,{'op':'releaseAll','args':{}})['AXError']==0
 event('down',{'x':.5,'y':.5});os.kill(fixture['capturePID'],signal.SIGKILL)
 try: call(worker,{'op':'frame'})
 except RuntimeError: pass
 worker.stdin.close();worker.wait(timeout=15)
 recovery=json.load(open(out/'recovery.json'));emergency=json.load(open(out/'emergency-release.json'))
 assert recovery['restored'] and emergency['released'],(recovery,emergency)
 (out/'pointer-results.json').write_text(json.dumps({'actions':results,'explicitRelease':True,'helperCrashRecovery':recovery,'emergencyUpConstructed':emergency},indent=2))
 print(json.dumps({'actions':results,'recovery':recovery,'emergency':emergency}))
finally:
 if worker and worker.poll() is None:worker.stdin.close();worker.wait(timeout=15)
 if aux and aux.poll() is None:aux.stdin.close();aux.wait(timeout=5)
 if fixture and (out/'recovery.json').exists() and json.load(open(out/'recovery.json'))['restored']:
  script(f'tell application "Finder" to close Finder window id {fixture["finderWindowID"]}')
 if holder:holder.stdin.close();holder.wait(timeout=5)
