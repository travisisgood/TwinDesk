#!/usr/bin/env python3
"""Bounded Finder snapshot freshness experiment; never imports TwinDesk code."""
import argparse, json, os, pathlib, select, subprocess, time, uuid


def script(source):
    return subprocess.check_output(['/usr/bin/osascript', '-e', source], text=True, timeout=15).strip()


def receive(process):
    if not select.select([process.stdout], [], [], 20)[0]:
        raise RuntimeError('Capture timed out (check Screen Recording permission)')
    line = process.stdout.readline()
    if not line:
        raise RuntimeError('Capture process exited')
    return json.loads(line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hold', type=int, default=0, choices=range(0,61), help='Keep the minimized live viewer available for up to 60 seconds')
    parser.add_argument('--click', help='Normalized x,y point routed through the viewer click handler')
    parser.add_argument('--press', help='Exact accessible description; invoked once while minimized')
    parser.add_argument('--viewer', action='store_true')
    parser.add_argument('capture', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    permission = json.loads(subprocess.check_output([str(args.capture.resolve()), '--permission'], text=True, timeout=10))
    if not permission.get('screenRecording'):
        (out / 'results.json').write_text(json.dumps({'blocked': 'Screen Recording permission denied', 'permission': permission}, indent=2))
        raise RuntimeError('Grant Screen Recording to the standalone probe, then rerun; no Finder window was changed.')
    title = 'FinderPortal-' + uuid.uuid4().hex[:8]
    folder = out / title
    folder.mkdir()
    (folder / 'BASELINE.txt').write_text('Dedicated Finder capture fixture.\n')
    # JSON string quoting also quotes this generated POSIX path for AppleScript.
    wid = script('tell application "Finder"\nset w to make new Finder window to POSIX file ' + json.dumps(str(folder)) + '\nset current view of w to list view\nset bounds of w to {100, 100, 900, 650}\nactivate\nreturn id of w\nend tell')
    if not wid.isdigit():
        raise RuntimeError('Invalid Finder window ID')
    restore = f'tell application "Finder"\nif exists Finder window id {wid} then\nset collapsed of Finder window id {wid} to false\nset bounds of Finder window id {wid} to {{100, 100, 900, 650}}\nend if\nend tell'
    # Independent bounded watchdog restores ONLY our disposable window if the runner dies.
    watchdog = subprocess.Popen(['/usr/bin/python3', '-c',
        'import os,time,subprocess,sys\npid=int(sys.argv[1])\nfor i in range(180):\n time.sleep(1)\n try: os.kill(pid,0)\n except ProcessLookupError: break\nsubprocess.run(["/usr/bin/osascript","-e",sys.argv[2]],timeout=15)',
        str(os.getpid()), restore], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    capture = None
    results = []
    try:
        time.sleep(2)
        capture = subprocess.Popen([str(args.capture.resolve())] + (['--viewer'] if args.viewer else []) + [title], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = receive(capture)
        results.append(ready)
        if not ready.get('ready'):
            raise RuntimeError(ready)
        for phase in ['visible', 'offscreen', 'minimized', 'restored']:
            script(restore)
            if phase == 'offscreen':
                script(f'tell application "Finder" to set bounds of Finder window id {wid} to {{-10000, 100, -9200, 650}}')
            if phase == 'minimized':
                script(f'tell application "Finder" to set collapsed of Finder window id {wid} to true')
            time.sleep(2)
            marker = phase.upper() + 'PROOF'
            # Before-image proves the marker was not already visible.
            for index in range(4):
                if index == 1:
                    (folder / (marker + '.txt')).write_text('Created after source entered ' + phase + '.\n')
                time.sleep(2)
                path = out / f'{phase}-{index}.png'
                capture.stdin.write(str(path) + '\n')
                capture.stdin.flush()
                sample = receive(capture)
                sample.update(phase=phase, index=index, marker=marker,
                    markerSeen=None, # PNGs require visual verification; OCR is not on the capture path.
                    finderState=script(f'tell application "Finder" to get {{bounds, collapsed}} of Finder window id {wid}'))
                results.append(sample)
                if args.viewer and phase == 'minimized' and index == 0:
                    capture.stdin.write('@axdump\n'); capture.stdin.flush()
                    (out / 'minimized-ax.json').write_text(json.dumps(receive(capture), indent=2))
                    if args.press or args.click:
                        command = '@click:' + args.click if args.click else '@press:' + args.press
                        if '\n' in command or '\r' in command: raise ValueError('Invalid input command')
                        capture.stdin.write(command + '\n'); capture.stdin.flush()
                        action = receive(capture)
                        results.append({'inputAction': action})
                        (out / 'action.json').write_text(json.dumps(action, indent=2))
                print(json.dumps(sample), flush=True)
                if args.viewer and phase == 'minimized' and index == 3 and args.hold:
                    print(json.dumps({'manualViewerSeconds': args.hold, 'sourceMinimized': True}), flush=True)
                    time.sleep(args.hold)
                    capture.stdin.write(str(out / 'after-manual.png') + '\n'); capture.stdin.flush()
                    results.append({'afterManual': receive(capture)})
    finally:
        try:
            script(restore)
            results.append({'restored': True, 'finderWindowID': wid})
        finally:
            if capture:
                capture.terminate()
                try: capture.wait(timeout=5)
                except subprocess.TimeoutExpired: capture.kill(); capture.wait()
            (out / 'results.json').write_text(json.dumps(results, indent=2))
            # Stop watchdog only after successful normal restoration.
            if results and results[-1].get('restored'):
                watchdog.terminate()
                watchdog.wait(timeout=5)

if __name__ == '__main__':
    main()
