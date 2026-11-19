import json, os, pathlib, shlex, signal, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLI = str(ROOT / 'bin/titlewave.mjs')
RESULTS = []


def run(*args, env=None):
    return subprocess.check_output(args, env=env, text=True, stderr=subprocess.STDOUT, timeout=10).strip()


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            RESULTS.append({'name': 'Process cleanup', 'pass': False, 'error': f'PID {process.pid} did not exit after SIGKILL'})
            print(f'FAIL process cleanup: PID {process.pid}', flush=True)


def wait_for(probe, process, log, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        observation = probe()
        if observation: return observation
        if process and process.poll() is not None: raise AssertionError(log.read_text())
        time.sleep(.1)
    raise AssertionError('Title was not observed: ' + log.read_text())


def windows(node):
    yield node
    for child in node.get('nodes', []) + node.get('floating_nodes', []):
        yield from windows(child)


def check(name, action):
    try:
        observation = action()
        RESULTS.append({'name': name, 'pass': True, 'observed': observation})
        print('PASS', name, flush=True)
    except Exception as error:
        output = getattr(error, 'output', '') or ''
        if isinstance(output, bytes): output = output.decode('utf-8', 'replace')
        detail = f'{error}\n{output}'
        RESULTS.append({'name': name, 'pass': False, 'error': detail})
        print('FAIL', name, detail, flush=True)


packages = run('pacman', '-Q', 'ghostty', 'foot', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'terminator', 'sway').splitlines()
print('Installed packages:\n' + '\n'.join(packages), flush=True)
ghostty_version = run('ghostty', '--version').splitlines()[0]
print(ghostty_version, flush=True)

with tempfile.TemporaryDirectory(prefix='titlewave-desktop-') as temporary:
    directory = pathlib.Path(temporary)
    runtime = directory / 'runtime'; runtime.mkdir(mode=0o700)
    home = directory / 'home'; home.mkdir()
    env = {k:v for k,v in os.environ.items() if k not in ['TMUX', 'TMUX_PANE', 'STY', 'WINDOW', 'ZELLIJ', 'HERDR_PANE_ID', 'WEZTERM_PANE', 'KITTY_WINDOW_ID', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS']}
    env.update(HOME=str(home), XDG_RUNTIME_DIR=str(runtime), LANG='C.UTF-8', LIBGL_ALWAYS_SOFTWARE='1', GSK_RENDERER='cairo')
    xlog = directory / 'xvfb.log'
    with xlog.open('w') as output:
        xvfb = subprocess.Popen(['Xvfb', ':94', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], stdout=output, stderr=output, start_new_session=True)
    xenv = {**env, 'DISPLAY': ':94', 'GDK_BACKEND': 'x11', 'QT_QPA_PLATFORM': 'xcb'}
    try:
        wait_for(lambda: pathlib.Path('/tmp/.X11-unix/X94').exists(), xvfb, xlog)

        def emulator(exe, backend='x11', fixed=False):
            name = f'Titlewave-{exe}-{backend}'
            observed = 'Titlewave-locked' if fixed else name
            case = pathlib.Path(tempfile.mkdtemp(prefix='case-', dir=directory))
            script = case / 'title.sh'
            script.write_text('#!/bin/sh\n' + shlex.join(['node', CLI, 'terminal', name]) + ' >' + shlex.quote(str(case / 'result')) + ' 2>&1\nprintf "%s" "$?" >' + shlex.quote(str(case / 'status.tmp')) + '\nmv ' + shlex.quote(str(case / 'status.tmp')) + ' ' + shlex.quote(str(case / 'status')) + '\nsleep 60\n')
            command = ['sh', str(script)]
            args = {
                'ghostty': ['ghostty', '--gtk-single-instance=false', '--shell-integration=none', *(['--title=Titlewave-locked'] if fixed else []), '-e', *command],
                'gnome-terminal': ['gnome-terminal', '--wait', '--', *command],
                'konsole': ['konsole', '--separate', '--nofork', '-p', 'LocalTabTitleFormat=%w', '-e', *command],
                'xfce4-terminal': ['xfce4-terminal', '--disable-server', '-x', *command],
                'terminator': ['terminator', '--no-dbus', '-x', *command],
                'foot': ['foot', *command],
            }[exe]
            log = case / 'stderr'
            with log.open('w') as output:
                process = subprocess.Popen(['dbus-run-session', '--', *args], env=xenv if backend == 'x11' else wenv, stdout=output, stderr=output, start_new_session=True)
            try:
                state = ''
                identity = None
                def renamed():
                    nonlocal state, identity
                    status = case / 'status'
                    if not status.exists(): return False
                    assert status.read_text() == '0', (case / 'result').read_text()
                    if backend == 'x11':
                        state = run('xwininfo', '-root', '-tree', env=xenv)
                        match = next((line.strip() for line in state.splitlines() if observed in line), None)
                        if match: identity = match.split()[0]
                        return match
                    tree = json.loads(run('swaymsg', '-s', str(socket), '-t', 'get_tree', '-r', env=wenv))
                    state = json.dumps(tree)
                    match = next((node for node in windows(tree) if node.get('app_id') and observed in (node.get('name') or '')), None)
                    if match:
                        identity = match['id']
                        return {'title': match['name'], 'app_id': match['app_id']}
                try: observation = wait_for(renamed, process, log)
                except AssertionError as error: raise AssertionError(f'{error}\nWindow state: {state}') from error
                if fixed:
                    assert 'visible terminal label not verified' in (case / 'result').read_text()
                    deadline = time.monotonic() + 1
                    while time.monotonic() < deadline:
                        state = run('xwininfo', '-root', '-tree', env=xenv)
                        assert name not in state and observed in state, state
                        time.sleep(.1)
                return observation
            finally:
                stop(process)
                if identity is not None:
                    def closed():
                        if backend == 'x11':
                            result = subprocess.run(['xwininfo', '-id', identity], env=xenv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                            if result.returncode == 0: return False
                            run('xwininfo', '-root', env=xenv)
                            return True
                        tree = json.loads(run('swaymsg', '-s', str(socket), '-t', 'get_tree', '-r', env=wenv))
                        return not any(node['id'] == identity and node.get('app_id') for node in windows(tree))
                    try: wait_for(closed, None, log, timeout=5)
                    except Exception as error:
                        RESULTS.append({'name': f'{name} cleanup', 'pass': False, 'error': f'Window {identity} not confirmed closed: {error}'})
                        print(f'FAIL {name} cleanup: {error}', flush=True)

        for exe in ['ghostty', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'terminator']:
            check(f'{exe} X11 window title', lambda exe=exe: emulator(exe))
        check('Ghostty fixed title correctly prevents OSC changes', lambda: emulator('ghostty', fixed=True))
    finally:
        stop(xvfb)

    config = directory / 'sway.conf'
    config.write_text('xwayland disable\nfont pango:DejaVu Sans 10\nswaybg_command -\n')
    wlog = directory / 'sway.log'
    wenv = {**env, 'WLR_BACKENDS': 'headless', 'WLR_LIBINPUT_NO_DEVICES': '1', 'WLR_RENDERER': 'pixman', 'GDK_BACKEND': 'wayland', 'QT_QPA_PLATFORM': 'wayland'}
    with wlog.open('w') as output:
        sway = subprocess.Popen(['sway', '-c', str(config)], env=wenv, stdout=output, stderr=output, start_new_session=True)
    try:
        def compositor_ready():
            ipc = next(iter(runtime.glob('sway-ipc.*.sock')), None)
            display = next((path for path in runtime.glob('wayland-*') if path.is_socket()), None)
            if ipc and display:
                try: run('swaymsg', '-s', str(ipc), '-t', 'get_version', '-r', env=wenv)
                except subprocess.CalledProcessError: return None
                return ipc, display.name
        socket, wenv['WAYLAND_DISPLAY'] = wait_for(compositor_ready, sway, wlog)
        for exe in ['foot', 'ghostty']:
            check(f'{exe} Wayland compositor title', lambda exe=exe: emulator(exe, 'wayland'))
    finally:
        stop(sway)

evidence = pathlib.Path(os.environ.get('TITLEWAVE_DESKTOP_EVIDENCE', ROOT / '.evidence' / 'desktop-terminals.json'))
evidence.parent.mkdir(parents=True, exist_ok=True)
evidence.write_text(json.dumps({'packages': packages, 'ghostty_version': ghostty_version, 'results': RESULTS}, indent=2))
print(evidence.read_text(), flush=True)
raise SystemExit(any(not result['pass'] for result in RESULTS))
