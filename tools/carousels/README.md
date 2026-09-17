# Generador de carruseles

Escribís el texto en `carousels.json` y salen los PNG de 1080×1350 listos para Instagram, con la identidad de Nomi aplicada. 27 slides tardan unos 3 segundos.

## Instalación (una sola vez)

```bash
cd tools/carousels
npm install
npx playwright install chromium
```

## Uso

```bash
node render.mjs                 # todos los carruseles
node render.mjs --only dia-01   # uno solo, por slug
node render.mjs --out ../../out # otra carpeta de salida
```

Los PNG quedan en `out/<slug>/01.png`, `02.png`, … en orden de publicación.

## Tipografía

Si `./fonts` tiene los archivos de Montserrat (`Montserrat-400.ttf`, `Montserrat-800.ttf`, …), se empotran en el HTML y el render sale idéntico en cualquier máquina, sin internet. El peso se lee del número en el nombre del archivo.

Si la carpeta no existe, se usa Google Fonts y hace falta conexión. Para producción conviene bajar los archivos: el render queda reproducible.

## Las cuatro estéticas

| `aesthetic` | Para qué | Fondo |
|---|---|---|
| `dato` | Una cifra fuerte — pilar Mitos & data | Crema |
| `checklist` | Listas accionables — pilar Tips rápidos | Blanco |
| `comparativa` | Dos lados enfrentados, como INDEC vs. vos | Superficie |
| `story` | Narrativo, una frase por slide — fechas especiales | Verde oscuro |

## Tipos de slide

| `type` | Campos | Notas |
|---|---|---|
| `cover` | `title`, `kicker?`, `sub?` | Portada, slide 1 |
| `stat` | `figure`, `label`, `source` | `source` es obligatorio |
| `point` | `title`, `body?`, `n?` | `n` dibuja el número en un círculo |
| `compare` | `leftLabel`, `leftText`, `rightLabel`, `rightText` | La columna derecha es la de Nomi |
| `quote` | `text` | Una frase grande, para `story` |
| `close` | `title`, `cta`, `body?` | Cierre, `cta` obligatorio |

Cualquier slide acepta `source`, que se imprime en el pie.

## Dos reglas que el generador hace cumplir

No son sugerencias: si no se cumplen, no se renderiza nada y te dice qué corregir.

1. **Una cifra en pantalla sin fuente no se renderiza.** Es la regla 3 del brief de producción. La fuente va en el pie de la slide, siempre visible.
2. **Entre 3 y 10 slides por carrusel.** Las fuentes de industria no tienen consenso sobre el número óptimo; 5 a 10 es el rango usable.

## Por qué Playwright y no Chrome por línea de comandos

Con `chrome --headless --screenshot`, el `--window-size` incluye el marco de la ventana: pedir 1350 de alto da un viewport de 1263, y el pie de cada slide se cortaba sin ningún aviso. Playwright fija el viewport exacto y además abre el navegador una sola vez para todas las slides, en vez de una por PNG.
