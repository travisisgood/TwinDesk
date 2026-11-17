#!/usr/bin/env python3
"""Bounded real Finder pointer diagnostics; no receiver or global injection."""
import argparse, json, os, pathlib, subprocess, time, uuid
from run import receive, script


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('capture', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    binary = args.capture.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    folder = out / ('FinderPointer-' + uuid.uuid4().hex[:8])
    folder.mkdir()
    for name in ['Alpha.txt', 'Beta.txt', 'Gamma.txt']:
        (folder / name).write_text('Disposable native pointer fixture.\n')
    holder = capture = guardian = None
    wid = None
    result = {'realFinder': True, 'probes': []}
    try:
        holder = subprocess.Popen([str(binary.with_name('FinderPortalBacking')), '180', '-1280', '0'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = receive(holder)
        if not ready.get('ready'): raise RuntimeError(ready)
        result['display'] = ready
        display = next(d for d in ready['topology'] if d['id'] == ready['displayID'])
        wid = script('tell application "Finder"\nset w to make new Finder window to POSIX file ' + json.dumps(str(folder)) + '\nset current view of w to list view\nset bounds of w to {100,100,900,650}\nreturn id of w\nend tell')
        if not wid.isdigit(): raise RuntimeError('Invalid fixture ID')
        restore = f'tell application "Finder" to set bounds of Finder window id {wid} to {{100,100,900,650}}'
        guardian = subprocess.Popen(['/usr/bin/python3', '-c', 'import os,time,subprocess,sys\nfor i in range(150):\n time.sleep(1)\n try: os.kill(int(sys.argv[1]),0)\n except ProcessLookupError: break\nsubprocess.run(["/usr/bin/osascript","-e",sys.argv[2]],timeout=15)', str(os.getpid()), restore])
        x,y=int(display['x'])+40,int(display['y'])+60
        script(f'tell application "Finder" to set bounds of Finder window id {wid} to {{{x},{y},{x+800},{y+550}}}')
        capture = subprocess.Popen([str(binary), '--source', '--backing', str(ready['displayID']), folder.name], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        if not receive(capture).get('ready'): raise RuntimeError('Capture not ready')
        for command in ['@raw-sort', '@raw-focus-sort', '@raw-appkit-sort', '@raw-tagged-sort', '@raw-location-sort', '@raw-sky-sort', '@raw-bottom-sort', '@raw-active-sort']:
            before = script(f'tell application "Finder" to get bounds of Finder window id {wid}')
            if before != f'{x}, {y}, {x+800}, {y+550}': raise RuntimeError('Fixture left backing display')
            capture.stdin.write(command+'\n');capture.stdin.flush()
            probe=receive(capture)
            probe.update(command=command, sourceBoundsBefore=before, sourceBoundsAfter=script(f'tell application "Finder" to get bounds of Finder window id {wid}'))
            result['probes'].append(probe)
            print(json.dumps(probe),flush=True)
            (out/'results.json').write_text(json.dumps(result,indent=2))
            if 'error' in probe or probe['sourceBoundsAfter'] != before: break
        capture.stdin.write('@press:Name\n');capture.stdin.flush()
        result['semanticPositiveControl']=receive(capture)
        capture.stdin.write('@axdump\n');capture.stdin.flush()
        result['headersAfterPositiveControl']=[e for e in receive(capture)['elements'] if e.get('AXDescription')=='Name']
    finally:
        if wid:
            script(restore)
            actual=script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}')
            result['recovery']={'restored':actual=='100, 100, 900, 650, false','state':actual}
            if result['recovery']['restored']:
                if guardian: guardian.terminate();guardian.wait(timeout=5)
                script(f'tell application "Finder" to close Finder window id {wid}')
                result['fixtureClosed']=True
        if capture:
            capture.stdin.close()
            try:capture.wait(timeout=5)
            except subprocess.TimeoutExpired:capture.terminate();capture.wait(timeout=5)
        if holder:
            holder.stdin.close()
            try:holder.wait(timeout=5)
            except subprocess.TimeoutExpired:holder.terminate();holder.wait(timeout=5)
        (out/'results.json').write_text(json.dumps(result,indent=2))

if __name__=='__main__':main()
