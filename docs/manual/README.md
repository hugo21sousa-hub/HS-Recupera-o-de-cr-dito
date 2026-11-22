# Manual do Cliente

Fonte: `manual.html` (imagens em `img/`, tiradas da demonstração com o perfil "Empresa: administrador").

Para gerar o PDF de novo depois de editar:

    node docs/manual/gerar-pdf.cjs "$PWD/docs/manual/manual.html" web/public/manual-acorly.pdf

O PDF em `web/public/manual-acorly.pdf` fica em acorly.com.br/manual-acorly.pdf e é anexado ao e-mail de boas-vindas quando a assinatura da empresa é ativada.
