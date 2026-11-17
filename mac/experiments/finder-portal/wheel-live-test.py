#!/usr/bin/env python3
import json, pathlib, subprocess, sys, time
from run import receive, script
binary=str(pathlib.Path(sys.argv[1]).resolve());out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=False)
holder=worker=aux=None;fixture=None

def call(p,m):
 p.stdin.write((m if isinstance(m,str) else json.dumps(m))+'\n');p.stdin.flush();return receive(p)
try:
 holder=subprocess.Popen([str(pathlib.Path(binary).with_name('FinderPortalBacking')),'180','-1280','0'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);display=receive(holder);assert display.get('ready'),display
 worker=subprocess.Popen(['/usr/bin/python3',str(pathlib.Path(__file__).with_name('source_worker.py')),binary,str(out),str(display['displayID']),'-1240','60'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 meta=receive(worker);fixture=json.load(open(out/'fixture.json'));folder=pathlib.Path(fixture['folder'])
 for i in range(80):(folder/f'Scroll-{i:03}.txt').write_text('Disposable wheel fixture.\n')
 time.sleep(1)
 aux=subprocess.Popen([binary,'--source','--backing',str(display['displayID']),folder.name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);assert receive(aux)['ready']
 def bars():return [n.get('AXValue') for n in call(aux,'@axdump')['elements'] if n.get('AXRole')=='AXScrollBar']
 before=bars();stateBefore=call(worker,{'op':'probeState'})
 response=call(worker,{'op':'wheel','args':{'x':.6,'y':.6,'deltaX':0,'deltaY':600}});assert response.get('AXError')==0,response
 time.sleep(.5);after=bars();stateAfter=call(worker,{'op':'probeState'})
 assert before!=after,(before,after)
 assert stateBefore['cursor']==stateAfter['cursor'] and stateBefore['bounds']==stateAfter['bounds'],(stateBefore,stateAfter)
 assert call(worker,{'op':'releaseAll','args':{}})['AXError']==0
 released=call(worker,{'op':'probeState'});assert released['held']==0 and not released['leased']
 (out/'wheel-results.json').write_text(json.dumps({'before':before,'after':after,'stateBefore':stateBefore,'stateAfter':stateAfter,'released':released,'windowControls':meta.get('windowControls')},indent=2));print((out/'wheel-results.json').read_text())
finally:
 if aux:aux.stdin.close();aux.wait(timeout=5)
 if worker:worker.stdin.close();worker.wait(timeout=15)
 if fixture and (out/'recovery.json').exists() and json.load(open(out/'recovery.json'))['restored']:script(f'tell application "Finder" to close Finder window id {fixture["finderWindowID"]}')
 if holder:holder.stdin.close();holder.wait(timeout=5)
