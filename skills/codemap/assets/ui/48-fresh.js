// Is the map behind the code? When the map's server is running, ask it (git, per repo) and say so plainly, with the
// words to update it. Nothing is shown when the map is current, in an exported copy, or when opened as a file.
(() => {
  const SC = window.Codemap;
  const srv = window.CODEMAP_SERVER;
  if (!SC || SC.exported || !srv?.token) return;
  const show = (text) => {
    if (document.getElementById('fp-fresh')) return;
    const bar = document.createElement('div');
    bar.id = 'fp-fresh';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 58px);transform:translateX(-50%);z-index:40;max-width:min(92vw,560px);padding:8px 12px;border-radius:10px;background:var(--panel,#fff);color:var(--text,#111);border:1px solid var(--line,#ddd);box-shadow:0 4px 18px rgba(0,0,0,.12);font:13px/1.4 Inter,system-ui,sans-serif;display:flex;gap:10px;align-items:center';
    bar.innerHTML = `<span>${SC.h(text)}</span><button type="button" class="btn soft" style="margin-left:auto">Got it</button>`;
    bar.querySelector('button').onclick = () => bar.remove();
    document.body.appendChild(bar);
  };
  fetch('/api/freshness', { headers: { 'x-codemap-token': srv.token } }).then((r) => (r.ok ? r.json() : null)).then((f) => {
    if (!f?.repos?.length) return;
    const behind = f.repos.reduce((n, r) => n + (r.behind || 0), 0);
    const dirty = f.repos.reduce((n, r) => n + (r.dirty || 0), 0);
    if (!behind && !dirty && !f.repos.some((r) => r.moved)) return;
    const parts = [];
    if (behind) parts.push(`${behind} commit${behind === 1 ? '' : 's'} newer than this map`);
    else if (f.repos.some((r) => r.moved)) parts.push('the code has moved to another commit');
    if (dirty) parts.push(`${dirty} changed file${dirty === 1 ? '' : 's'} not committed yet`);
    show(`The code has ${parts.join(' and ')}. Ask ${SC.agent?.name || 'Claude'} to “update the codemap” (only what changed is re-read).`);
  }).catch(() => {});
})();
