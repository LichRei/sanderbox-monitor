// Never log URLs, headers, request bodies or server error bodies: they may contain secrets.
// Retrying a write is opt-in: only operations with a verified idempotency contract qualify.
export function createRequestJson({ headers, fetchImpl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = Date.now, warn = console.warn }) {
  return async function requestJson(url, init, {
    operation = 'app', timeoutMs = 15_000, retrySafe = false, tries = 3, deadline = Infinity,
  } = {}) {
    const attempts = retrySafe ? tries : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`${operation}: prazo esgotado; checkpoint preservado`);
      let failure;
      let retryable = false;
      try {
        const res = await fetchImpl(url, {
          ...init, headers, signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(timeoutMs, remaining)))),
        });
        if (res.status >= 500) {
          failure = `HTTP ${res.status}`;
          retryable = true;
          await res.body?.cancel();
        } else if (!res.ok) {
          // 409 means another attempt may still be running. Never treat it as success.
          await res.body?.cancel();
          return { status: res.status, body: null };
        } else {
          return { status: res.status, body: await res.json() };
        }
      } catch (err) {
        failure = err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? 'tempo limite da requisição' : 'falha de rede ou resposta inválida';
        retryable = true;
      }
      const delay = 1000 * 2 ** (attempt - 1);
      if (!retryable || attempt === attempts || now() + delay >= deadline) {
        throw new Error(`${operation}: ${failure} (tentativa ${attempt}/${attempts})`);
      }
      warn(`${operation}: ${failure}; nova tentativa ${attempt + 1}/${attempts} em ${delay} ms`);
      await sleep(delay);
    }
  };
}
