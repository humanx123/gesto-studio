// Gesto Studio's only server code: a narrow proxy to Kilo's free models, which answer anonymously
// but send no CORS headers, so a page can't call them directly. Static files never reach this
// script (run_worker_first is limited to /api/*), so the site's own traffic stays free.
// Only Kilo's free routes pass, without any credentials, and only for this site's own pages.

const KILO = 'https://api.kilo.ai/api/gateway/';
const FREE = /(:free|\/free|-free)$/;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/kilo/')) return env.ASSETS.fetch(request);

    // Same-site callers only (the studio and the APK both load this origin).
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json(403, { error: { message: 'Forbidden origin' } });

    const path = url.pathname.slice('/api/kilo/'.length);
    if (request.method === 'GET' && (path === 'v1/models' || path === 'models')) {
      const res = await fetch(KILO + 'models', { headers: { accept: 'application/json' }, cf: { cacheTtl: 600, cacheEverything: true } });
      if (!res.ok) return json(res.status, { error: { message: `Kilo ${res.status}` } });
      const body = await res.json();
      const data = (body.data ?? []).filter((m) => FREE.test(m.id) && (m.supported_parameters ?? []).includes('tools'))
        .map((m) => ({ id: m.id, name: m.name, context_length: m.context_length }));
      return json(200, { object: 'list', data });
    }
    if (request.method === 'POST' && path === 'v1/chat/completions') {
      let body;
      try { body = await request.json(); } catch { return json(400, { error: { message: 'Invalid JSON' } }); }
      if (typeof body?.model !== 'string' || !FREE.test(body.model)) return json(400, { error: { message: 'Only Kilo free models are available here.' } });
      const res = await fetch(KILO + 'v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: request.headers.get('accept') ?? '*/*' },
        body: JSON.stringify(body),
      });
      const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
      const retry = res.headers.get('retry-after');
      if (retry) headers.set('retry-after', retry);
      return new Response(res.body, { status: res.status, headers });
    }
    return json(404, { error: { message: 'Not found' } });
  },
};
