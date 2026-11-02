// The map's own words in the map's language. The agent translates the list of interface strings once
// (codemap/ui-strings.json, folded into graph.uiStrings by the build); this swaps them in wherever they appear,
// in text and in titles, labels and placeholders, including parts drawn later. Code names and paths are untouched.
(() => {
  const SC = window.Codemap;
  if (SC?.graph?.meta?.rtl) {
    document.documentElement.dir = 'rtl';
    const st = document.createElement('style');
    st.textContent = '[dir=rtl] code,[dir=rtl] pre,[dir=rtl] kbd,[dir=rtl] .mono,[dir=rtl] .path,[dir=rtl] .tp,[dir=rtl] .rpath,[dir=rtl] .method,[dir=rtl] #search{direction:ltr;unicode-bidi:isolate}[dir=rtl] #svg,[dir=rtl] #svg *{direction:ltr}';
    document.head.appendChild(st);
  }
  const T = SC?.graph?.uiStrings;
  if (!T || !Object.keys(T).length) return;
  const ATTRS = ['title', 'aria-label', 'placeholder'];
  const swap = (s) => { const k = s.trim(); if (!k || !Object.hasOwn(T, k)) return null; return s.replace(k, T[k]); };
  function pass(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('code, pre, .path, script, style, [data-no-i18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const v = swap(n.nodeValue); if (v != null && v !== n.nodeValue) n.nodeValue = v; }
    const els = root.querySelectorAll ? root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')) : [];
    for (const el of [root, ...els]) for (const a of ATTRS) { const cur = el.getAttribute?.(a); if (cur) { const v = swap(cur); if (v != null && v !== cur) el.setAttribute(a, v); } }
  }
  const start = () => {
    pass(document.body);
    let busy = false;
    new MutationObserver((muts) => {
      if (busy) return;
      busy = true;
      try {
        for (const m of muts) {
          // text changed in place (a count, a label set later): swap just that text
          if (m.type === 'characterData') { const v = swap(m.target.nodeValue || ''); if (v != null && v !== m.target.nodeValue) m.target.nodeValue = v; continue; }
          if (m.type === 'attributes') { const cur = m.target.getAttribute(m.attributeName); const v = cur && swap(cur); if (v != null && v !== cur) m.target.setAttribute(m.attributeName, v); continue; }
          for (const n of m.addedNodes) if (n.nodeType === 1) pass(n); else if (n.nodeType === 3 && n.parentElement) pass(n.parentElement);
        }
      } finally { busy = false; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  document.documentElement.lang = SC.graph.meta?.languageCode || document.documentElement.lang;
})();
