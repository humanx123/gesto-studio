import { useEffect, useState } from 'react';
import { fetchFreellmapiModels, useSettings, type GatewayModel } from '../state/settings';

export type GatewayList = { state: 'idle' | 'loading' | 'ok' | 'error'; models: GatewayModel[]; error?: string };

/** Lists the models of the user's FreeLLMAPI server while `enabled`; refetches when its address or key changes. */
export function useGatewayModels(enabled: boolean): GatewayList {
  const url = useSettings((s) => s.freellmapiUrl);
  const key = useSettings((s) => s.freellmapiKey);
  const [list, setList] = useState<GatewayList>({ state: 'idle', models: [] });
  useEffect(() => {
    if (!enabled || !key.trim()) { setList({ state: 'idle', models: [] }); return; }
    const ctrl = new AbortController();
    setList((l) => ({ ...l, state: 'loading' }));
    fetchFreellmapiModels(url, key.trim(), ctrl.signal)
      .then((models) => setList({ state: 'ok', models }))
      .catch((e: Error) => { if (!ctrl.signal.aborted) setList({ state: 'error', models: [], error: e.message }); });
    return () => ctrl.abort();
  }, [enabled, url, key]);
  return list;
}
