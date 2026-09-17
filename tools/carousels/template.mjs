/**
 * Slide markup + the four carousel aesthetics.
 * Tokens mirror mobile/src/theme/colors.ts — keep them in sync by hand.
 */

export const W = 1080;
export const H = 1350;

const TOKENS = {
  green: '#27AE60',
  greenDim: '#1F8C4F',
  mint: '#D1F7E3',
  cream: '#FAFAF7',
  surface: '#F5F1E9',
  white: '#FFFFFF',
  text: '#1C1C1C',
  textSoft: '#6D6A63',
  border: '#E8E2D9',
  red: '#EF4444',
  yellow: '#F59E0B',
};

const AESTHETICS = {
  dato: { bg: TOKENS.cream, fg: TOKENS.text, soft: TOKENS.textSoft, accent: TOKENS.green, rule: TOKENS.border },
  checklist: { bg: TOKENS.white, fg: TOKENS.text, soft: TOKENS.textSoft, accent: TOKENS.green, rule: TOKENS.border },
  comparativa: { bg: TOKENS.surface, fg: TOKENS.text, soft: TOKENS.textSoft, accent: TOKENS.green, rule: TOKENS.border },
  story: { bg: '#123A26', fg: '#F7F3E8', soft: 'rgba(247,243,232,.68)', accent: TOKENS.mint, rule: 'rgba(247,243,232,.18)' },
};

export const AESTHETIC_NAMES = Object.keys(AESTHETICS);

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fontFace(fonts) {
  if (!fonts.length) {
    return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap">';
  }
  return `<style>${fonts
    .map(
      (f) => `@font-face{font-family:"Montserrat";font-style:normal;font-weight:${f.weight};` +
        `src:url(data:font/${f.format};base64,${f.data}) format("${f.format === 'ttf' ? 'truetype' : f.format}");font-display:block;}`
    )
    .join('')}</style>`;
}

function body(slide, a) {
  switch (slide.type) {
    case 'cover':
      return `
        <div class="block cover">
          ${slide.kicker ? `<p class="kicker">${esc(slide.kicker)}</p>` : ''}
          <h1>${esc(slide.title)}</h1>
          ${slide.sub ? `<p class="sub">${esc(slide.sub)}</p>` : ''}
        </div>`;

    case 'stat':
      return `
        <div class="block stat">
          ${slide.kicker ? `<p class="kicker">${esc(slide.kicker)}</p>` : ''}
          <p class="figure">${esc(slide.figure)}</p>
          <p class="figlabel">${esc(slide.label)}</p>
        </div>`;

    case 'point':
      return `
        <div class="block point">
          ${slide.n ? `<span class="chip">${esc(slide.n)}</span>` : ''}
          <h2>${esc(slide.title)}</h2>
          ${slide.body ? `<p class="body">${esc(slide.body)}</p>` : ''}
        </div>`;

    case 'compare':
      return `
        <div class="block compare">
          <div class="col">
            <p class="collabel">${esc(slide.leftLabel)}</p>
            <p class="coltext">${esc(slide.leftText)}</p>
          </div>
          <div class="vs">vs</div>
          <div class="col mine">
            <p class="collabel">${esc(slide.rightLabel)}</p>
            <p class="coltext">${esc(slide.rightText)}</p>
          </div>
        </div>`;

    case 'quote':
      return `
        <div class="block quote">
          <h2>${esc(slide.text)}</h2>
        </div>`;

    case 'close':
      return `
        <div class="block close">
          <h2>${esc(slide.title)}</h2>
          ${slide.body ? `<p class="body">${esc(slide.body)}</p>` : ''}
          <p class="cta">${esc(slide.cta)}</p>
        </div>`;

    default:
      throw new Error(`Tipo de slide desconocido: ${slide.type}`);
  }
}

/** Una cifra larga ("$1.564.716") se sale del canvas a 210px. Se achica por largo. */
function figureSize(figure) {
  const n = String(figure ?? '').length;
  if (n <= 4) return 210;
  if (n <= 6) return 176;
  if (n <= 8) return 140;
  return 112;
}

export function slideHTML({ carousel, slide, index, total, fonts }) {
  const a = AESTHETICS[carousel.aesthetic];
  if (!a) throw new Error(`Estética desconocida: ${carousel.aesthetic}`);

  return `<!doctype html>
<meta charset="utf-8">
${fontFace(fonts)}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  /* Todo vive dentro de .canvas, que tiene alto explícito: los offsets absolutos
     se resuelven contra él y no contra el body, cuyo alto la captura no respeta. */
  .canvas{
    position:relative;width:${W}px;height:${H}px;overflow:hidden;
    background:${a.bg};color:${a.fg};
    font-family:"Montserrat",system-ui,sans-serif;
  }

  .deco{position:absolute;border-radius:9999px;pointer-events:none}
  .deco-a{width:520px;height:520px;right:-180px;top:-160px;background:${a.accent};opacity:${carousel.aesthetic === 'story' ? .16 : .09}}
  .deco-b{width:260px;height:260px;left:-120px;bottom:120px;background:${a.accent};opacity:${carousel.aesthetic === 'story' ? .1 : .06}}

  .block{
    position:absolute;left:88px;right:88px;top:96px;bottom:200px;z-index:1;
    display:flex;flex-direction:column;justify-content:center;gap:34px;overflow:hidden;
  }

  .kicker{font-size:30px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${a.accent}}
  h1{font-size:104px;font-weight:800;line-height:1.02;letter-spacing:-.035em;text-wrap:balance}
  h2{font-size:80px;font-weight:800;line-height:1.08;letter-spacing:-.03em;text-wrap:balance}
  .sub{font-size:38px;font-weight:500;color:${a.soft};line-height:1.35;max-width:22ch}
  .body{font-size:40px;font-weight:500;color:${a.soft};line-height:1.4}

  .figure{font-size:${figureSize(slide.figure)}px;font-weight:800;letter-spacing:-.05em;line-height:.95;color:${a.accent};font-variant-numeric:tabular-nums;white-space:nowrap}
  .figlabel{font-size:46px;font-weight:700;line-height:1.25;max-width:20ch}

  .chip{
    display:inline-flex;align-items:center;justify-content:center;
    width:92px;height:92px;border-radius:9999px;
    background:${a.accent};color:${carousel.aesthetic === 'story' ? '#123A26' : '#fff'};
    font-size:44px;font-weight:800;
  }
  .point h2{font-size:68px}

  .compare{flex-direction:row;align-items:stretch;gap:30px}
  .col{flex:1;background:${carousel.aesthetic === 'story' ? 'rgba(255,255,255,.07)' : '#fff'};
    border:3px solid ${a.rule};border-radius:24px;padding:44px 38px;display:flex;flex-direction:column;gap:22px;justify-content:center}
  .col.mine{border-color:${a.accent}}
  .collabel{font-size:32px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${a.soft}}
  .col.mine .collabel{color:${a.accent}}
  .coltext{font-size:44px;font-weight:700;line-height:1.2}
  .vs{align-self:center;font-size:36px;font-weight:800;color:${a.soft}}

  .quote h2{font-size:92px}
  .close .cta{font-size:44px;font-weight:800;color:${a.accent}}

  footer{
    position:absolute;left:88px;right:88px;bottom:72px;z-index:1;
    display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
    border-top:3px solid ${a.rule};padding-top:28px;
  }
  .brand{font-size:44px;font-weight:800;letter-spacing:-.03em}
  .brand span{color:${a.accent}}
  .source{font-size:22px;font-weight:600;color:${a.soft};max-width:58ch;line-height:1.3;text-align:right}
  .counter{font-size:26px;font-weight:800;color:${a.soft};font-variant-numeric:tabular-nums;white-space:nowrap}
</style>
<div class="canvas">
  <div class="deco deco-a"></div>
  <div class="deco deco-b"></div>
  ${body(slide, a)}
  <footer>
    <p class="brand">Nomi<span>.</span></p>
    ${slide.source ? `<p class="source">${esc(slide.source)}</p>` : '<span></span>'}
    <p class="counter">${index + 1}/${total}</p>
  </footer>
</div>
`;
}
