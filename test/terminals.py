import json, os, pathlib, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLI = str(ROOT / 'bin/titlewave.mjs')
RESULTS = []

def run(*args, env=None):
    return subprocess.check_output(args, env=env, text=True, stderr=subprocess.STDOUT, timeout=15).strip()

def check(name, action):
    try:
        action()
        RESULTS.append({'name': name, 'pass': True})
        print('PASS', name, flush=True)
    except Exception as error:
        RESULTS.append({'name': name, 'pass': False, 'error': str(error)})
        print('FAIL', name, str(error), flush=True)

clean = {k:v for k,v in os.environ.items() if k not in ['TMUX','TMUX_PANE','STY','WINDOW','ZELLIJ','ZELLIJ_PANE_ID','HERDR_PANE_ID','WEZTERM_PANE','KITTY_WINDOW_ID']}

def tmux():
    socket = 'titlewave-' + str(os.getpid())
    try:
        run('tmux','-L',socket,'new-session','-d','-s','test','-n','Before','sleep 120')
        pane = run('tmux','-L',socket,'display-message','-p','#{pane_id}')
        address = run('tmux','-L',socket,'display-message','-p','#{socket_path},#{pid},0')
        env = {**clean, 'TMUX': address, 'TMUX_PANE':pane}
        run('node',CLI,'terminal','Tmux title',env=env)
        assert run('tmux','-L',socket,'display-message','-p','#{window_name}') == 'Tmux title'
        run('tmux','-L',socket,'split-window','-d','sleep 120')
        run('node',CLI,'terminal','Pane only',env=env)
        assert run('tmux','-L',socket,'display-message','-p','#{window_name}') == 'Tmux title'
        assert run('tmux','-L',socket,'display-message','-p','-t',pane,'#{pane_title}') == 'Pane only'
    finally:
        subprocess.run(['tmux','-L',socket,'kill-server'],capture_output=True)
check('tmux targeted title and split-window protection', tmux)

def screen():
    name = 'titlewave-' + str(os.getpid())
    try:
        run('screen','-dmS',name,'bash','-c','sleep 120')
        run('node',CLI,'terminal','Screen title',env={**clean,'STY':name,'WINDOW':'0'})
        assert 'Screen title' in run('screen','-S',name,'-Q','windows')
    finally:
        subprocess.run(['screen','-S',name,'-X','quit'],capture_output=True)
check('GNU Screen targets its own window', screen)

def zellij():
    name = 'titlewave-zellij-' + str(os.getpid())
    socket = name + '-tmux'
    with tempfile.TemporaryDirectory() as td:
        config = pathlib.Path(td) / 'config.kdl'
        config.write_text('show_startup_tips false\nshow_release_notes false\n')
        script = pathlib.Path(td) / 'title.sh'
        script.write_text('#!/bin/sh\nnode '+CLI+' terminal "Zellij title" >'+td+'/result 2>&1\nsleep 120\n')
        try:
            panes = ''
            run('tmux','-L',socket,'new-session','-d','-s','test','env -u TMUX -u TMUX_PANE zellij --config '+str(config)+' attach --create '+name+' 2>'+td+'/zellij.log; sleep 120')
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                try:
                    ready = json.loads(run('zellij','--session',name,'action','list-panes','--json'))
                    if any(not pane['is_plugin'] and pane.get('pane_command') for pane in ready): break
                except (subprocess.CalledProcessError, json.JSONDecodeError): pass
                time.sleep(.15)
            target = int(run('zellij','--session',name,'run','--','sh',str(script)).removeprefix('terminal_'))
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                try:
                    panes = run('zellij','--session',name,'action','list-panes','--json')
                    if any(not pane['is_plugin'] and pane['id'] == target and pane['title'] == 'Zellij title' for pane in json.loads(panes)): break
                except (subprocess.CalledProcessError, json.JSONDecodeError): pass
                time.sleep(.15)
            assert 'Zellij title' in panes, str({p.name:p.read_text() for p in pathlib.Path(td).iterdir() if p.name in ['result','zellij.log']}) + run('tmux','-L',socket,'capture-pane','-p') + panes
        finally:
            subprocess.run(['zellij','kill-session',name],capture_output=True)
            subprocess.run(['tmux','-L',socket,'kill-server'],capture_output=True)
check('Zellij explicit calling-pane title', zellij)

xvfb = subprocess.Popen(['Xvfb', ':93', '-screen','0','1280x800x24'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
display = {**clean,'DISPLAY':':93','LIBGL_ALWAYS_SOFTWARE':'1'}

def emulator(exe):
    title = 'Titlewave-' + exe
    with tempfile.TemporaryDirectory() as td:
        script = pathlib.Path(td) / 'title.sh'
        script.write_text('#!/bin/sh\nnode '+CLI+' terminal '+title+' >'+td+'/result 2>&1\nsleep 30\n')
        args = {'xterm':['xterm','-e','sh',str(script)], 'urxvt':['urxvt','-e','sh',str(script)], 'alacritty':['alacritty','-e','sh',str(script)], 'kitty':['kitty','-o','allow_remote_control=yes','--listen-on','unix:'+td+'/kitty.sock','sh',str(script)]}[exe]
        process = subprocess.Popen(args,env=display,stdout=subprocess.DEVNULL,stderr=open(td+'/stderr','w'))
        try:
            for _ in range(80):
                tree = run('xwininfo','-root','-tree',env=display)
                if title in tree: break
                if process.poll() is not None: raise AssertionError(pathlib.Path(td+'/stderr').read_text())
                time.sleep(.15)
            assert title in tree, pathlib.Path(td+'/result').read_text() if pathlib.Path(td+'/result').exists() else tree
        finally:
            process.terminate();process.wait(timeout=10)
for exe in ['xterm','urxvt','alacritty','kitty']:
    check(exe+' real X11 window title',lambda exe=exe:emulator(exe))
xvfb.terminate();xvfb.wait()
(ROOT/'.evidence').mkdir(exist_ok=True)
(ROOT/'.evidence/terminals.json').write_text(json.dumps(RESULTS,indent=2))
raise SystemExit(any(not result['pass'] for result in RESULTS))
