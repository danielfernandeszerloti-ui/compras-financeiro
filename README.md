# Compras · Financeiro — Grupo Zerbini

Sistema de solicitações de compra: os colaboradores pedem, o Financeiro aprova e acompanha, e a solicitação só é finalizada depois que o solicitante anexa o comprovante de compra e o Financeiro confere.

Endereço: **https://compras.grupozerbini.com.br**

## Fluxo

| Etapa | Quem | O que acontece |
|---|---|---|
| Solicitada | Colaborador | Título, setor, empresa, itens (quantidade, valor, fornecedor, link), justificativa, prazo, urgência, quem vai comprar e orçamentos anexos (opcional). O Financeiro recebe e-mail. |
| Aprovada / Reprovada | Financeiro | Aprova (pode trocar quem compra e definir a forma de pagamento) ou reprova com motivo. Reprovada volta para o solicitante ajustar e reenviar, ou cancelar. |
| Comprada | Quem compra | Registro opcional de pedido e previsão de chegada. Quem compra é o Financeiro ou o próprio solicitante, decidido em cada solicitação. |
| Comprovante | Solicitante | Anexa nota fiscal, cupom ou comprovante (PDF ou foto) e informa valor pago, data da compra e NF. Sem anexo não envia. |
| Finalizada | Financeiro | Confere e finaliza, ou devolve com o motivo. O comprovante devolvido fica no histórico, e o solicitante anexa outro. |

Também é possível cancelar com motivo: o solicitante até a aprovação (ou enquanto ainda não comprou) e o Financeiro a qualquer momento antes de finalizar. Cada passo fica no histórico da solicitação, e os avisos por e-mail saem automaticamente.

## Telas

- **Minhas solicitações** (todos): o que está em aberto, o que precisa de você e as encerradas.
- **Painel** (Financeiro): totais por etapa, o que precisa de atenção (urgentes, prazos vencidos, entregas atrasadas, paradas há dias) e o valor pago no mês por setor.
- **Aprovações**, **Conferência** e **Em andamento** (Financeiro): uma fila para cada etapa.
- **Todas** (Financeiro): busca, filtros e exportação para Excel (CSV).
- **Configurações** (administrador): equipe do Financeiro (perfil, recebe e-mails, ativo) e as listas de empresas, setores e formas de pagamento.

## Acesso

- Login com código por e-mail ou senha. É a mesma conta do Helpdesk e só aceita e-mails @grupozerbini.com.br (trigger `bloquear_cadastro_externo`).
- Quem não está na equipe do Financeiro é **colaborador** e vê só as próprias solicitações.
- `fc_membros`: perfil **financeiro** (aprova, compra, confere) ou **admin** (financeiro + configurações).

## Técnica

- Página estática (`www/`), publicada pelo GitHub Pages com o workflow `.github/workflows/pages.yml`. Sem build: `vendor/supabase.js` é a supabase-js 2.119 copiada do npm.
- Banco: projeto Supabase `gestao-ativos-ti` (o mesmo da Gestão de Ativos e do Helpdesk), com tabelas de prefixo `fc_`. Migração em `supabase/migrations/20261104_compras_financeiro.sql`.
- As tabelas só permitem leitura (RLS). Toda escrita passa pelas funções `fc_salvar`, `fc_decidir`, `fc_registrar_compra`, `fc_enviar_comprovante`, `fc_conferir`, `fc_cancelar`, `fc_anexo_registrar` e `fc_anexo_remover`, que conferem perfil e etapa.
- Anexos ficam no bucket privado `compras` (até 15 MB), no caminho `{solicitação}/{orcamento|comprovante}/{arquivo}`, e abrem por link temporário.
- E-mails: entram na fila `hd_notificacoes` (tipo `fc_compras`, sem chamado) e saem pelo mesmo envio do Helpdesk (cron `hd-notificacoes`).
- Atualização em tempo real pela tabela `fc_solicitacoes` no Realtime.

## Publicação

1. No Registro.br, crie um registro **CNAME** `compras` apontando para `danielfernandeszerloti-ui.github.io`.
2. No GitHub: **Settings → Pages → Source: GitHub Actions**. Em **Custom domain**, informe `compras.grupozerbini.com.br` e marque **Enforce HTTPS** quando o certificado sair.
3. No Supabase (Authentication → URL Configuration), adicione `https://compras.grupozerbini.com.br` em **Redirect URLs**.
