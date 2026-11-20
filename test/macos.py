import json, os, pathlib, subprocess, sys, time, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
if sys.platform != 'darwin': raise SystemExit('Run this check on native macOS with test/macos.command.')
cleanup = len(sys.argv) == 5 and sys.argv[1] == '--cleanup'
if not cleanup and os.environ.get('TITLEWAVE_MAC_TEST_WINDOW') != '1':
    raise SystemExit('Launch a fresh test window with: open test/macos.command')
EVIDENCE = pathlib.Path(sys.argv[3]) if cleanup else ROOT / '.evidence' / f'macos-terminal-{os.getpid()}.json'


def applescript(script, *args):
    result = subprocess.run(['/usr/bin/osascript', '-e', script, *map(str, args)], text=True, capture_output=True, timeout=12)
    if result.returncode: raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


if cleanup:
    time.sleep(2)
    window = int(sys.argv[2])
    if not sys.argv[4].startswith('/dev/ttys') or not sys.argv[4][9:].isdigit(): raise SystemExit('Invalid test TTY')
    data = json.loads(EVIDENCE.read_text())
    if data.get('window_id') != window: raise SystemExit('Cleanup evidence does not match the test window')
    try:
        applescript(f'''with timeout of 8 seconds
            tell application "Terminal"
                repeat 30 times
                    if not (exists window id {window}) then return "closed"
                    if (count of tabs of window id {window}) is not 1 then error "Test window gained another tab; leaving it open"
                    if tty of selected tab of window id {window} is not "{sys.argv[4]}" then error "Test window TTY changed; leaving it open"
                    if not (busy of selected tab of window id {window}) then
                        close window id {window} saving no
                        if not (exists window id {window}) then return "closed"
                    end if
                    delay 0.2
                end repeat
                error "Test window did not close"
            end tell
        end timeout''')
        data['cleanup'] = {'pass': True, 'window_closed': True}
    except Exception as error:
        data['cleanup'] = {'pass': False, 'error': str(error)}
    EVIDENCE.write_text(json.dumps(data, indent=2))
    raise SystemExit(not data['cleanup']['pass'])

node = os.environ.get('TITLEWAVE_NODE', 'node')
results = []
window = None
node_version = 'unavailable'
EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
try:
    tty = os.ttyname(sys.stdin.fileno())
    found = applescript('''on run argv
        with timeout of 5 seconds
            tell application "Terminal"
                repeat with w in windows
                    repeat with t in tabs of w
                        if tty of t is item 1 of argv then
                            if (count of tabs of w) is not 1 then error "Use a fresh single-tab test window"
                            return (id of w as text) & linefeed & name of w
                        end if
                    end repeat
                end repeat
                error "Calling Terminal tab was not found"
            end tell
        end timeout
    end run''', tty)
    window = int(found.splitlines()[0])
    node_version = subprocess.check_output([node, '--version'], text=True).strip()
    assert int(node_version.lstrip('v').split('.')[0]) >= 22, 'Node 22 or later is required'
    def title():
        return applescript(f'with timeout of 5 seconds\ntell application "Terminal" to return name of window id {window}\nend timeout')
    def renamed(name, detached=False):
        result = subprocess.run([node, str(ROOT/'bin/titlewave.mjs'), 'terminal', name], capture_output=True, text=True, timeout=15, start_new_session=detached)
        assert result.returncode == 0, result.stderr
        deadline = time.monotonic() + 5
        observed = ''
        while time.monotonic() < deadline:
            observed = title()
            if name in observed: return observed
            time.sleep(.1)
        raise AssertionError(f'Title not observed: {observed!r}')
    marker = uuid.uuid4().hex[:8]
    first = 'Titlewave ' + marker + ' quotes " \' $HOME & \u03a9'
    results.append({'name':'Native Terminal literal OSC title with redirected stdout','pass':True,'observed':renamed(first)})
    second = 'Titlewave second ' + marker
    observed = renamed(second)
    assert first not in observed, observed
    results.append({'name':'Native Terminal replaces previous title','pass':True,'observed':observed})
    bad = subprocess.run([node, str(ROOT/'bin/titlewave.mjs'), 'terminal', 'bad\nname'], capture_output=True, text=True, timeout=15)
    assert bad.returncode != 0 and second in title(), bad.stdout + bad.stderr
    results.append({'name':'Invalid title preserves visible native window title','pass':True})
    results.append({'name':'Detached tool process targets its parent native Terminal','pass':True,'observed':renamed('Titlewave detached ' + marker, detached=True)})
except Exception as error:
    results.append({'name':'Native Terminal check','pass':False,'error':str(error)})
finally:
    version = subprocess.check_output(['/usr/libexec/PlistBuddy','-c','Print :CFBundleShortVersionString','/System/Applications/Utilities/Terminal.app/Contents/Info.plist'], text=True).strip()
    data={'terminal':version,'os':subprocess.check_output(['sw_vers','-productVersion'],text=True).strip(),'node':node_version,'results':results,'window_id':window}
    EVIDENCE.write_text(json.dumps(data,indent=2))
    if window is not None:
        with (ROOT/'.evidence/macos-cleanup.log').open('w') as log:
            subprocess.Popen([sys.executable,__file__,'--cleanup',str(window),str(EVIDENCE),tty],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
print(json.dumps(data,indent=2))
print(f'Evidence: {EVIDENCE}')
raise SystemExit(any(not result['pass'] for result in results))
