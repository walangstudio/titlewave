import { terminalTitleWriter } from '../lib/terminal.mjs';

export default {
  id: 'titlewave',
  tui: async api => {
    const writer = terminalTitleWriter(title => api.renderer.setTerminalTitle(title));
    let selected, generation = 0, attempts = 0, done = false, inFlight;
    const current = () => api.route.current?.name === 'session' ? api.route.current.params?.sessionID : undefined;
    const sync = async () => {
      const id = current();
      if (id !== selected) { selected = id; generation++; attempts = 0; done = false; }
      if (!id || done || attempts >= 3 || inFlight === generation || api.lifecycle.signal.aborted) return;
      const request = generation;
      inFlight = request; attempts++;
      try {
        const { data, error } = await api.client.session.get({ sessionID: id }, { signal: AbortSignal.any([api.lifecycle.signal, AbortSignal.timeout(5000)]) });
        if (api.lifecycle.signal.aborted || current() !== id || request !== generation) return;
        if (error || data?.id !== id) throw new Error('OpenCode did not identify the selected session.');
        done = true;
        if (data.title && !/^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.title)) await writer.write(data.title, () => !api.lifecycle.signal.aborted && current() === id && request === generation);
      } catch (error) {
        if (!api.lifecycle.signal.aborted && current() === id && request === generation && (done || attempts === 3)) api.ui.toast({ message: `Titlewave: resume title not restored: ${error.message}`, variant: 'warning' });
      } finally { if (inFlight === request) inFlight = undefined; }
    };
    // Poll only the local route; replace when the TUI exposes a route-change event.
    const timer = setInterval(sync, 250);
    api.lifecycle.onDispose(() => { clearInterval(timer); return writer.close(); });
    void sync();
  },
};
