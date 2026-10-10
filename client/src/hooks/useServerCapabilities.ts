import { useEffect, useState } from 'react';
import { api } from '../utils/api';

/** What a game server's transport supports (GET /api/rcon/capabilities/:serverId). */
export interface ServerCapabilities {
  transport: string;
  commands: string[];
  matchControls: string[];
}

/** The server's capabilities, read once per server; null while loading or when unreadable (show everything). */
export function useServerCapabilities(serverId?: string | null): { caps: ServerCapabilities | null; loaded: boolean } {
  const [read, setRead] = useState<{ id: string; caps: ServerCapabilities | null } | null>(null);
  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    api
      .get<ServerCapabilities & { success: boolean }>(`/api/rcon/capabilities/${encodeURIComponent(serverId)}`)
      .then((res) => {
        if (!cancelled) setRead({ id: serverId, caps: res.success && Array.isArray(res.matchControls) ? res : null });
      })
      .catch(() => {
        if (!cancelled) setRead({ id: serverId, caps: null });
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);
  const current = read && read.id === serverId ? read : null;
  return { caps: current?.caps ?? null, loaded: current !== null };
}
