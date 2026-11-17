#!/usr/bin/env python3
"""Private local pipe adapter. Start only after network authentication."""
import json, os, pathlib, subprocess, sys, time, uuid
from run import receive, script

binary, output, display_id, x, y = sys.argv[1:6]
adopt=json.loads(sys.argv[6]) if len(sys.argv)>6 else None
out=pathlib.Path(output).resolve(); out.mkdir(parents=True,exist_ok=True)
original=[100,100,900,650]
if adopt:
 if not isinstance(adopt,dict) or adopt.get('appId')!='com.apple.finder' or not isinstance(adopt.get('wid'),int) or adopt['wid']<=0: raise RuntimeError('Only an explicit existing Finder window may be adopted')
 wid=str(adopt['wid'])
 # Finder scripting IDs match its CGWindowIDs; native capture independently verifies the ID belongs to Finder.
 original=[int(n.strip()) for n in script(f'tell application "Finder" to get bounds of Finder window id {wid}').split(',')]
 if len(original)!=4 or not (300<=original[2]-original[0]<=1200 and 200<=original[3]-original[1]<=800): raise RuntimeError('Existing Finder size does not fit backing')
 folder=pathlib.Path(script(f'tell application "Finder" to get POSIX path of (target of Finder window id {wid} as alias)'))
 selector='window:'+wid
else:
 folder=out/('FinderNetwork-'+uuid.uuid4().hex[:8]); folder.mkdir()
 (folder/'BASELINE.txt').write_text('Authenticated Finder source fixture.\n')
 for name in ['Alpha.txt','Beta.txt']: (folder/name).write_text('Pointer test fixture.\n')
 (folder/'PortalChild').mkdir(); (folder/'PortalChild'/'Inside.txt').write_text('Navigation proof.\n')
 wid=script('tell application "Finder"\nset w to make new Finder window to POSIX file '+json.dumps(str(folder))+'\nset current view of w to list view\nset bounds of w to {100,100,900,650}\nreturn id of w\nend tell')
 selector=folder.name
if not wid.isdigit(): raise RuntimeError('Invalid Finder fixture id')
width,height=original[2]-original[0],original[3]-original[1]
restore_bounds=','.join(map(str,original))
restore=f'tell application "Finder"\nif exists Finder window id {wid} then\nset collapsed of Finder window id {wid} to false\nset bounds of Finder window id {wid} to {{{restore_bounds}}}\nend if\nend tell'
guardian=subprocess.Popen(['/usr/bin/python3','-c',
 'import os,time,subprocess,sys,json\nfor i in range(3600):\n time.sleep(1)\n try: os.kill(int(sys.argv[1]),0)\n except ProcessLookupError: break\nsubprocess.run(["/usr/bin/osascript","-e",sys.argv[2]],timeout=15)\n',str(os.getpid()),restore],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
capture=None
held=set(); held_keys=set(); last_point={'x':0.5,'y':0.5}; native_identity=None

def emit(data):
 print(json.dumps(data),flush=True)

def call(line):
 capture.stdin.write(line+'\n'); capture.stdin.flush()
 return receive(capture)

try:
 x,y=int(x),int(y)
 script(f'tell application "Finder" to set bounds of Finder window id {wid} to {{{x},{y},{x+width},{y+height}}}')
 time.sleep(1)
 if script(f'tell application "Finder" to get bounds of Finder window id {wid}') != f'{x}, {y}, {x+width}, {y+height}': raise RuntimeError('Backing placement failed')
 capture=subprocess.Popen([binary,'--source','--backing',display_id,selector],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 ready=receive(capture)
 native_identity={'wid':ready.get('wid'),'pid':ready.get('pid')}
 if not ready.get('ready'): raise RuntimeError(ready)
 fixture={'finderWindowID':wid,'workerPID':os.getpid(),'capturePID':capture.pid,'folder':str(folder),'adopted':bool(adopt),'originalBounds':original}
 (out/'fixture.json').write_text(json.dumps(fixture))
 emit(call('@wire-metadata'))
 for line in sys.stdin:
  message=json.loads(line)
  op=message.get('op')
  if op=='frame':
   result=call('@wire-frame')
   if result.get('geometryChanged'): result={'metadata':call('@wire-metadata')}
  elif op=='probeState': result=call('@pointer-state') # Private harness only, never advertised.
  elif op=='key':
   args=message['args']
   if args['phase']=='down': held_keys.add(args['usage'])
   result=call('@key-json:'+json.dumps(args))
   if args['phase']=='up': held_keys.discard(args['usage'])
  elif op=='text': result=call('@text-native-json:'+json.dumps(message['args']))
  elif op=='wheel': result=call('@wheel-json:'+json.dumps(message['args']))
  elif op=='pointer':
   args=message['args']; last_point={'x':args['x'],'y':args['y']}
   if args['phase']=='down': held.add(args['button']) # Record before posting, including a helper crash before its reply.
   result=call('@pointer-json:'+json.dumps(args))
   if args['phase']=='up': held.discard(args['button'])
  elif op=='releaseAll':
   result=call('@release-all'); held.clear(); held_keys.clear()
  elif op=='pressAt': result=call('@click:'+str(message['args']['x'])+','+str(message['args']['y']))
  elif op=='setSearchText': result=call('@text-json:'+json.dumps({'text':message['args']['text']}))
  elif op=='confirmSearch': result=call('@confirm')
  elif op=='resize':
   result=call('@resize-json:'+json.dumps(message['args']))
   if result.get('AXError')==0 and not result.get('error'): result['metadata']=call('@wire-metadata')
  elif op=='close': break
  else: result={'error':'Unsupported operation'}
  emit(result)
finally:
 try:
  if capture and capture.poll() is None:
   try: call('@release-all'); held.clear(); held_keys.clear()
   except Exception: pass # Emergency release below before physical recovery.
  if (held or held_keys) and native_identity:
   emergency={**native_identity,**last_point,'buttons':sorted(held),'keys':sorted(held_keys)}
   try:
    released=json.loads(subprocess.check_output([binary,'--release-pointer',json.dumps(emergency)],text=True,timeout=5))
    (out/'emergency-release.json').write_text(json.dumps(released))
   except Exception as error: (out/'emergency-release.json').write_text(json.dumps({'released':False,'error':str(error)}))
  script(restore)
  actual=script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}')
  restored=actual==', '.join(map(str,original))+', false'
  (out/'recovery.json').write_text(json.dumps({'restored':restored,'state':actual}))
  if not restored: raise RuntimeError('Source restoration failed: '+actual)
  guardian.terminate(); guardian.wait(timeout=5)
 finally:
  if capture:
   capture.terminate()
   try: capture.wait(timeout=5)
   except subprocess.TimeoutExpired: capture.kill(); capture.wait()
