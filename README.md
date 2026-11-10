# Vistoria Elétrica Básica

App de campo para a vistoria elétrica básica (diagnóstico) de escolas estaduais existentes (SEDUC-MT, CIPI-SNP), com inspeção visual, alicate amperímetro e câmera termográfica. Gera o relatório em .docx com recomendações à SEDUC por prioridade.

Endereço: https://marcelojoseparis.github.io/vistoria-eletrica/vistoria.html

## Funcionamento offline
- Abra o endereço uma vez com internet e instale o app: no Android, menu ⋮ do Chrome → "Instalar app" ou "Adicionar à tela inicial"; no iPhone, Safari → Compartilhar → "Adicionar à Tela de Início".
- Depois disso, o app abre e funciona sem internet. Vistorias e fotos ficam guardadas só no aparelho. Use "Vistorias → Exportar backup" ao terminar cada vistoria.
- Precisam de internet: a busca de endereço pelas coordenadas (OpenStreetMap) e a redação pelo Claude (pelo botão "Copiar pedido para o Claude").

## Convivência com o fiscaliza-coipt
Os dois apps ficam no mesmo endereço (marcelojoseparis.github.io). Este app não usa o Cache Storage, que o fiscaliza-coipt limpa ao atualizar: os arquivos offline ficam no banco próprio `vistoriaEletrica-shell`, e os dados em `vistoriaEletrica-dados`. A página principal se chama `vistoria.html`, para que um toque em aviso do fiscaliza-coipt não abra este app por engano.

## Atualizar o app
Altere os arquivos e aumente `VERSAO` em `sw.js`. Na próxima abertura com internet, o app baixa a versão nova e oferece "Recarregar agora".
