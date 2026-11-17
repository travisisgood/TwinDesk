#!/usr/bin/env python3
"""Native keyboard proof on a dedicated Finder source; closes only its fixture."""
import json,os,pathlib,re,subprocess,sys,time
from run import receive,script
binary=str(pathlib.Path(sys.argv[1]).resolve());out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=False)
# Optional current owned display avoids creating a second backing display.
display_id=sys.argv[3] if len(sys.argv)>3 else None
holder=worker=aux=None;fixture=None

def call(p,m):
 p.stdin.write((m if isinstance(m,str) else json.dumps(m))+'\n');p.stdin.flush();return receive(p)
def key(usage,phase):
 r=call(worker,{'op':'key','args':{'usage':usage,'phase':phase}});assert r.get('AXError')==0,r
try:
 if display_id is None:
  holder=subprocess.Popen([str(pathlib.Path(binary).with_name('FinderPortalBacking')),'180','-1280','0'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);d=receive(holder);assert d['ready'];display_id=str(d['displayID'])
 worker=subprocess.Popen(['/usr/bin/python3',str(pathlib.Path(__file__).with_name('source_worker.py')),binary,str(out),display_id,'-1240','60'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);meta=receive(worker);fixture=json.load(open(out/'fixture.json'))
 aux=subprocess.Popen([binary,'--source','--backing',display_id,'window:'+fixture['finderWindowID']],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1);assert receive(aux)['ready']
 nodes=call(aux,'@axdump')['elements'];alpha=next(n for n in nodes if n.get('AXValue')=='Alpha.txt' and n.get('frame'));x,y,w,h=map(float,re.findall(r'-?\d+(?:\.\d+)?',alpha['frame']));point={'x':(x+w/2+1240)/799,'y':(y+h/2-60)/549}
 for phase in ['down','up']:assert call(worker,{'op':'pointer','args':{'phase':phase,'button':0,**point}})['AXError']==0
 state=call(worker,{'op':'probeState'})
 key(81,'down');key(81,'up');time.sleep(.3)
 selection=script('tell application "Finder"\nset names to {}\nrepeat with chosen in (get selection)\nset end of names to name of chosen\nend repeat\nreturn names\nend tell');assert selection and selection!='Alpha.txt',selection
 key(227,'down');key(9,'down');key(9,'up');key(227,'up');time.sleep(.4)
 fields=[n for n in call(aux,'@axdump')['elements'] if n.get('AXSubrole')=='AXSearchField'];assert fields,'Cmd-F did not expose search'
 response=call(worker,{'op':'text','args':{'text':'PortalNeedle42'}});assert response.get('AXError')==0,response
 time.sleep(.4);fields=[n for n in call(aux,'@axdump')['elements'] if n.get('AXSubrole')=='AXSearchField'];assert any(n.get('AXValue')=='PortalNeedle42' for n in fields),fields
 key(225,'down');assert call(worker,{'op':'probeState'})['heldKeys']==1
 assert call(worker,{'op':'releaseAll','args':{}})['AXError']==0
 released=call(worker,{'op':'probeState'});assert released['heldKeys']==0 and not released['leased']
 assert released['bounds']==state['bounds'] and released['cursor']==state['cursor']
 result={'arrowSelection':selection,'commandFSearch':True,'committedText':'PortalNeedle42','heldModifierRelease':released,'initial':state}
 (out/'keyboard-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
finally:
 if aux:aux.stdin.close();aux.wait(timeout=5)
 if worker:worker.stdin.close();worker.wait(timeout=15)
 if fixture and (out/'recovery.json').exists() and json.load(open(out/'recovery.json'))['restored']:script(f'tell application "Finder" to close Finder window id {fixture["finderWindowID"]}')
 if holder:holder.stdin.close();holder.wait(timeout=5)
