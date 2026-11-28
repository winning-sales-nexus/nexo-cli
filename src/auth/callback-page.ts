export type CallbackPageState = 'success' | 'error';

export interface CallbackPageContent {
    readonly state: CallbackPageState;
    readonly title: string;
    readonly text: string;
    readonly hint?: string;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character: string) => HTML_ESCAPES[character] ?? character);
}

/** Tokens from the Nexo web app (nexu-fe src/index.css) and the site (nexo-site global.css). */
const STYLE: string = `
:root{color-scheme:light dark;--bg:#f6f2ed;--surface:#fffdfa;--line:#eae2d8;--ink:#1e1915;--ink-2:#57504a;--ink-3:#736a61;--brand:#e0294b;--violet:#6e56cf;--good:#178046;--good-soft:#e3f4ea;--crit:#c42841;--crit-soft:#fce8eb;--code:#f8f3ee;--shadow:0 2px 4px rgba(20,18,40,.04),0 16px 40px -12px rgba(60,30,90,.18)}
@media (prefers-color-scheme:dark){:root{--bg:#13110f;--surface:#1c1916;--line:#302a25;--ink:#f6f1eb;--ink-2:#c7beb3;--ink-3:#9e958a;--brand:#ff4f6d;--violet:#9d8cf0;--good:#4acb86;--good-soft:#13281c;--crit:#ff6b82;--crit-soft:#33161e;--code:#231f1b;--shadow:0 2px 4px rgba(0,0,0,.3),0 20px 44px -12px rgba(0,0,0,.6)}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(60rem 30rem at 50% -10%,var(--surface),transparent);color:var(--ink);font-family:Nunito,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:40px 32px 36px;box-shadow:var(--shadow)}
.brand{color:var(--ink);display:inline-flex;align-items:center;gap:10px;margin:0 0 32px;font-size:1.5rem;font-weight:800;letter-spacing:-.02em}
.brand svg{width:32px;height:32px}
.mark-ring{fill:none;stroke:var(--brand);stroke-width:5}
.mark-handle{fill:none;stroke:var(--violet);stroke-width:5.5;stroke-linecap:round}
.badge{display:grid;place-items:center;width:72px;height:72px;margin:0 auto 20px;border-radius:50%}
.badge svg{width:36px;height:36px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.success .badge{background:var(--good-soft);color:var(--good)}
.error .badge{background:var(--crit-soft);color:var(--crit)}
h1{margin:0 0 8px;font-size:1.75rem;line-height:1.2;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
p{margin:0;color:var(--ink-2);font-size:1.0625rem;text-wrap:pretty}
.hint{margin-top:20px;padding-top:20px;border-top:1px solid var(--line);font-size:.9375rem;color:var(--ink-3)}
code{padding:2px 8px;border-radius:6px;background:var(--code);border:1px solid var(--line);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
@media (prefers-reduced-motion:no-preference){.badge{animation:pop .45s cubic-bezier(.2,.9,.3,1.2) both}@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}}
@media (max-width:420px){main{padding:32px 20px 28px;border-radius:16px}}
`
    .trim()
    .replace(/\n/g, '');

const MARK: string =
    '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle class="mark-ring" cx="13.5" cy="13.5" r="9"/><path class="mark-handle" d="M20.6 20.6L27 27"/></svg>';

const ICONS: Readonly<Record<CallbackPageState, string>> = {
    success: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
};

/** Escapes title and text, so a caller can pass text that came from the callback URL. The hint is trusted markup. */
export function renderCallbackPage(content: CallbackPageContent): string {
    const title: string = escapeHtml(content.title);
    const hint: string = content.hint === undefined ? '' : `<p class="hint">${content.hint}</p>`;
    return (
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="color-scheme" content="light dark"><title>${title} - Nexo</title><style>${STYLE}</style></head>` +
        `<body><main class="${content.state}"><div class="brand">${MARK}<span>Nexo</span></div>` +
        `<div class="badge">${ICONS[content.state]}</div><h1>${title}</h1><p>${escapeHtml(content.text)}</p>${hint}</main></body></html>`
    );
}

export const RETRY_HINT: string = 'Volte ao terminal e rode <code>nexo login</code> de novo.';
