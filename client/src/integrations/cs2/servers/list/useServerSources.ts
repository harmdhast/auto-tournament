import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../module-sdk';
import type { FleetServer, FleetServersResponse, Server } from '../../cs2.types';

const POLL_MS = 10_000;

/** The Ready Up servers and the platform's server records, read every 10 s. */
export function useServerSources(): {
  fleetServers: FleetServer[];
  servers: Server[];
  /** When the server records were read (unix seconds), to tell which reported lately. */
  readAt: number;
  loaded: boolean;
  reload: () => Promise<void>;
} {
  const [fleetServers, setFleetServers] = useState<FleetServer[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [readAt, setReadAt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [f, s] = await Promise.all([
      api.get<FleetServersResponse>('/api/fleet/servers').catch(() => null),
      api.get<{ success: boolean; servers?: Server[] }>('/api/servers').catch(() => null),
    ]);
    if (f) setFleetServers(f.servers ?? []);
    if (s) {
      setServers(s.servers ?? []);
      setReadAt(Date.now() / 1000);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [reload]);

  return { fleetServers, servers, readAt, loaded, reload };
}
