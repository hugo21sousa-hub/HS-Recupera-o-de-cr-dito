// Junta o build da demonstração num único HTML (CSS e JS embutidos) em dist-demo/hs-demo.html
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'dist-demo/assets';
const arquivos = readdirSync(dir);
const css = arquivos.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
const js = arquivos.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
const favicon = 'data:image/png;base64,' + Buffer.from(readFileSync('public/favicon.png')).toString('base64');
const seguro = js.replace(/<\/script/gi, '<\\/script');
const html = `<title>Acorly | Recuperação de crédito</title>
<meta name="theme-color" content="#0B2545">
<link rel="icon" href="${favicon}">
<style>${css}</style>
<div id="root"></div>
<script type="module">${seguro}</script>
`;
writeFileSync('dist-demo/hs-demo.html', html);
console.log('dist-demo/hs-demo.html', (html.length / 1024).toFixed(0) + ' KB');
