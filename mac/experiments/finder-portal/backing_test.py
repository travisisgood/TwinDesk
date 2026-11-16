#!/usr/bin/env python3
"""Bounded standalone backing-display test. No TwinDesk build/network/KVM."""
import argparse, json, os, pathlib, subprocess, time, uuid
from run import script, receive


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--search-focus', action='store_true', help='Test focus and text in an expanded backing Finder search field')
    parser.add_argument('--fail-holder', action='store_true', help='Kill only the experiment display holder and verify restoration')
    parser.add_argument('capture', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    capture_path = args.capture.resolve()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    for flag, key in [('--permission', 'screenRecording'), ('--accessibility', 'accessibility')]:
        if not json.loads(subprocess.check_output([str(capture_path), flag], text=True))[key]:
            raise RuntimeError('Normal macOS permission required: ' + key)
    folder = out / ('FinderBacking-' + uuid.uuid4().hex[:8]); folder.mkdir()
    (folder / 'BASELINE.txt').write_text('Initial fixture.\n')
    wid = script('tell application "Finder"\nset w to make new Finder window to POSIX file ' + json.dumps(str(folder)) + '\nset current view of w to list view\nset bounds of w to {100,100,900,650}\nreturn id of w\nend tell')
    if not wid.isdigit(): raise RuntimeError('Invalid fixture ID')
    restore = f'tell application "Finder"\nif exists Finder window id {wid} then\nset collapsed of Finder window id {wid} to false\nset bounds of Finder window id {wid} to {{100,100,900,650}}\nend if\nend tell'
    guardian = subprocess.Popen(['/usr/bin/python3', '-c',
        'import os,time,subprocess,sys\nfor i in range(160):\n time.sleep(1)\n try: os.kill(int(sys.argv[1]),0)\n except ProcessLookupError: break\nsubprocess.run(["/usr/bin/osascript","-e",sys.argv[2]],timeout=15)', str(os.getpid()), restore])
    holder = capture = None; results = []
    def command(process, line):
        process.stdin.write(line + '\n'); process.stdin.flush()
        response = receive(process)
        if 'error' in response: raise RuntimeError(response)
        return response
    try:
        holder = subprocess.Popen([str(capture_path.with_name('FinderPortalBacking'))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = receive(holder); results.append({'backingReady': ready})
        if not ready.get('ready'): raise RuntimeError(ready)
        display = next(d for d in ready['topology'] if d['id'] == ready['displayID'])
        x, y = int(display['x']) + 40, int(display['y']) + 60
        def park():
            script(f'tell application "Finder" to set bounds of Finder window id {wid} to {{{x},{y},{x+800},{y+550}}}')
            time.sleep(1)
            actual = script(f'tell application "Finder" to get bounds of Finder window id {wid}')
            if [int(v.strip()) for v in actual.split(',')] != [x,y,x+800,y+550]:
                raise RuntimeError('Finder placement failed: ' + actual)
        park()
        capture = subprocess.Popen([str(capture_path), '--viewer', '--backing', str(ready['displayID']), folder.name], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        results.append({'captureReady': receive(capture)})
        for phase in ['baseline', 'changed', 'returned', 'reparked']:
            if phase == 'changed':
                (folder / 'BACKINGLIVEPROOF.txt').write_text('Created while source is on persistent backing display.\n')
            elif phase == 'returned': script(restore)
            elif phase == 'reparked': park()
            time.sleep(2)
            sample = command(capture, str(out / (phase + '.png')))
            state = command(holder, 'status')
            assert state['displayID'] == ready['displayID'] and state['topology'] == ready['topology'], state
            results.append({'phase': phase, 'sample': sample, 'display': state,
                'finderState': script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}')})
            if phase == 'changed':
                results.append({'rawSort': command(capture, '@raw-sort')})
                results.append({'semanticSort': command(capture, '@press:Name')})
                results.append({'afterInput': command(capture, str(out / 'after-input.png'))})
                if args.search_focus:
                    results.append({'openSearch': command(capture, '@press:Search')})
                    time.sleep(1)
                    elements = command(capture, '@axdump')['elements']
                    field = next(e for e in elements if e.get('AXSubrole') == 'AXSearchField')
                    import re
                    fx, fy, fw, fh = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', field['frame'])]
                    results.append({'focusSearch': command(capture, '@click:' + str((fx+fw/2-x)/800) + ',' + str((fy+fh/2-y)/550))})
                    results.append({'searchText': command(capture, '@text-json:' + json.dumps({'text':'BACKINGLIVEPROOF'}))})
                    results.append({'confirmSearch': command(capture, '@confirm')})
                    time.sleep(2)
                    results.append({'afterSearch': command(capture, str(out / 'after-search.png'))})
                results.append({'localMinimize': command(capture, '@viewer-minimize')})
                time.sleep(1)
                results.append({'localRestore': command(capture, '@viewer-restore')})
                results.append({'afterLocalRestore': command(capture, str(out / 'after-local-restore.png'))})
            print(json.dumps(results[-1]), flush=True)
            if args.fail_holder and phase == 'changed':
                holder.kill(); holder.wait(timeout=5)
                results.append({'injectedHolderFailure': True})
                break
        capture.stdin.close(); capture.wait(timeout=10); capture = None
        if not args.fail_holder:
            state = command(holder, 'status')
            assert state['topology'] == ready['topology'], state
            results.append({'afterCaptureExit': state})
    finally:
        try:
            script(restore)
            restored = script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}')
            results.append({'restored': restored == '100, 100, 900, 650, false', 'finalFinderState': restored})
            assert results[-1]['restored'], restored
            guardian.terminate(); guardian.wait(timeout=5)
        finally:
            if capture:
                capture.terminate()
                try: capture.wait(timeout=5)
                except subprocess.TimeoutExpired: capture.kill(); capture.wait()
            if holder:
                if holder.poll() is None:
                    holder.stdin.close()
                    try: holder.wait(timeout=5)
                    except subprocess.TimeoutExpired: holder.kill(); holder.wait()
                results.append({'backingExit': holder.returncode})
            (out / 'results.json').write_text(json.dumps(results, indent=2))

if __name__ == '__main__': main()
