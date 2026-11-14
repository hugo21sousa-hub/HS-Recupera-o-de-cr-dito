// Publica a demonstração (backend no navegador, dados fictícios) em /demonstracao do site.
import { copyFileSync, existsSync } from 'node:fs';
if (existsSync('dist-demo/hs-demo.html')) { copyFileSync('dist-demo/hs-demo.html', 'dist/demonstracao.html'); console.log('dist/demonstracao.html'); }
