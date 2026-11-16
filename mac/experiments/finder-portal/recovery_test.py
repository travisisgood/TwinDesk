#!/usr/bin/env python3
"""Bounded real-process crash test; only terminates its own disposable probe processes."""
import json, pathlib, subprocess, sys, time
from run import script

binary, output, victim = sys.argv[1:]
if victim not in ('helper', 'controller'):
    raise SystemExit('victim must be helper or controller')
out = pathlib.Path(output).resolve()
out.mkdir(parents=True, exist_ok=True)
child = subprocess.Popen([sys.executable, str(pathlib.Path(__file__).with_name('run.py')), '--viewer', '--quick', '--hold', '45', binary, str(out)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
fixture = None
try:
    for line in child.stdout:
        row = json.loads(line)
        if row.get('phase') == 'minimized' and row.get('index') == 0:
            assert row['finderState'].endswith('true') and not row['onScreen']
            fixture = json.loads((out / 'fixture.json').read_text())
            break
    if fixture is None:
        raise RuntimeError('Did not reach minimized precondition: ' + child.stderr.read()[:500])
    import os, signal
    target = fixture['capturePID'] if victim == 'helper' else child.pid
    start = time.monotonic()
    os.kill(target, signal.SIGKILL)
    if victim == 'controller': child.wait(timeout=5)
    checks = []
    for _ in range(30):
        state = script('tell application "Finder" to get {bounds, collapsed} of Finder window id ' + fixture['finderWindowID'])
        checks.append(state)
        if state == '100, 100, 900, 650, false': break
        time.sleep(0.2)
    result = {'victim': victim, 'minimizedBeforeCrash': True, 'restored': checks[-1] == '100, 100, 900, 650, false', 'elapsedSeconds': round(time.monotonic()-start,3), 'checks': checks}
    (out / 'recovery-result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result),flush=True)
    assert result['restored'], 'Source restoration failed'
finally:
    if child.poll() is None:
        child.terminate()
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
    if fixture:
        # Acceptance failure cleanup is explicit and happens AFTER result measurement.
        script('tell application "Finder"\nset collapsed of Finder window id '+fixture['finderWindowID']+' to false\nset bounds of Finder window id '+fixture['finderWindowID']+' to {100,100,900,650}\nend tell')
