#!/usr/bin/env python3
"""Private local pipe adapter. Start only after network authentication."""
import json, os, pathlib, subprocess, sys, time, uuid
from run import receive, script

binary, output, display_id, x, y = sys.argv[1:]
out=pathlib.Path(output).resolve(); out.mkdir(parents=True,exist_ok=True)
folder=out/('FinderNetwork-'+uuid.uuid4().hex[:8]); folder.mkdir()
(folder/'BASELINE.txt').write_text('Authenticated Finder source fixture.\n')
wid=script('tell application "Finder"\nset w to make new Finder window to POSIX file '+json.dumps(str(folder))+'\nset current view of w to list view\nset bounds of w to {100,100,900,650}\nreturn id of w\nend tell')
if not wid.isdigit(): raise RuntimeError('Invalid Finder fixture id')
restore=f'tell application "Finder"\nif exists Finder window id {wid} then\nset collapsed of Finder window id {wid} to false\nset bounds of Finder window id {wid} to {{100,100,900,650}}\nend if\nend tell'
guardian=subprocess.Popen(['/usr/bin/python3','-c',
 'import os,time,subprocess,sys,json\nfor i in range(3600):\n time.sleep(1)\n try: os.kill(int(sys.argv[1]),0)\n except ProcessLookupError: break\nsubprocess.run(["/usr/bin/osascript","-e",sys.argv[2]],timeout=15)\n',str(os.getpid()),restore],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
capture=None

def emit(data):
 print(json.dumps(data),flush=True)

def call(line):
 capture.stdin.write(line+'\n'); capture.stdin.flush()
 return receive(capture)

try:
 x,y=int(x),int(y)
 script(f'tell application "Finder" to set bounds of Finder window id {wid} to {{{x},{y},{x+800},{y+550}}}')
 time.sleep(1)
 if script(f'tell application "Finder" to get bounds of Finder window id {wid}') != f'{x}, {y}, {x+800}, {y+550}': raise RuntimeError('Backing placement failed')
 capture=subprocess.Popen([binary,'--source','--backing',display_id,folder.name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
 ready=receive(capture)
 if not ready.get('ready'): raise RuntimeError(ready)
 fixture={'finderWindowID':wid,'workerPID':os.getpid(),'capturePID':capture.pid,'folder':str(folder)}
 (out/'fixture.json').write_text(json.dumps(fixture))
 emit(call('@wire-metadata'))
 for line in sys.stdin:
  message=json.loads(line)
  op=message.get('op')
  if op=='frame': result=call('@wire-frame')
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
  script(restore)
  actual=script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}')
  restored=actual=='100, 100, 900, 650, false'
  (out/'recovery.json').write_text(json.dumps({'restored':restored,'state':actual}))
  if not restored: raise RuntimeError('Source restoration failed: '+actual)
  guardian.terminate(); guardian.wait(timeout=5)
 finally:
  if capture:
   capture.terminate()
   try: capture.wait(timeout=5)
   except subprocess.TimeoutExpired: capture.kill(); capture.wait()
