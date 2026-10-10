import { useCallback, useEffect, useState } from 'react';
import type { FleetServer } from '../../../cs2.types';

const POLL_MS = 5_000;

/** One Ready Up server while its panel is open: read every 5 s; `gone` when the platform no longer has it. */
export function useFleetServer(id: string | null): {
  server: FleetServer | null;
  loaded: boolean;
  gone: boolean;
  reload: () => Promise<void>;
} {
  const [server, setServer] = useState<FleetServer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      // fetch, not api.get: a 404 (the server was removed) is an answer here, not an error.
      const res = await fetch(`/api/fleet/servers/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
      });
      if (res.status === 404) {
        setServer(null);
        setGone(true);
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { success: boolean; server?: FleetServer };
      setServer(body.server ?? null);
      setGone(false);
    } catch {
      // Keep what is shown; the next poll tries again.
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    setServer(null);
    setLoaded(false);
    setGone(false);
    if (!id) return;
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [id, reload]);

  return { server, loaded, gone, reload };
}
