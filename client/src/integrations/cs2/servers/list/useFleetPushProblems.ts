import { useEffect, useState } from 'react';
import { api } from '../../../../module-sdk';
import type { FleetPushStatus, FleetServerPushResponse } from '../fleetPush.types';

const POLL_MS = 30_000;
/** A push the server has not answered after this long is stuck. */
const STUCK_S = 300;
const NONE = new Set<string>();

export function pushProblem(push: FleetServerPushResponse, nowS: number): boolean {
  return Object.values(push.pushed).some(
    (p: FleetPushStatus | null) =>
      !!p &&
      (p.status === 'rejected' ||
        p.status === 'failed' ||
        p.status === 'expired' ||
        (p.status === 'pending' && nowS - p.at > STUCK_S))
  );
}

/** The Ready Up servers whose last push failed or is stuck, read every 30 s. */
export function useFleetPushProblems(ids: string[]): Set<string> {
  const [problems, setProblems] = useState<Set<string>>(() => new Set());
  const key = [...ids].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let live = true;
    const load = async () => {
      const list = key.split(',');
      const answers = await Promise.all(
        list.map((id) =>
          api
            .get<FleetServerPushResponse>(`/api/fleet/servers/${encodeURIComponent(id)}/push`)
            .catch(() => null)
        )
      );
      if (!live) return;
      const now = Date.now() / 1000;
      setProblems(new Set(list.filter((_id, i) => answers[i] && pushProblem(answers[i], now))));
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key]);

  return key ? problems : NONE;
}
