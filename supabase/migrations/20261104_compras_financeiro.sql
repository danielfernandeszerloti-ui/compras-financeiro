-- =====================================================================
-- Compras · Financeiro (aplicada em 2026-11-04)
-- Mesmo projeto Supabase da Gestão de Ativos e do Helpdesk, tabelas com prefixo fc_.
-- Fluxo: colaborador solicita → Financeiro aprova/reprova → quem compra (solicitante ou
-- Financeiro) registra a compra → solicitante anexa o comprovante → Financeiro confere e
-- finaliza (ou devolve pedindo outro comprovante).
-- Toda escrita passa pelas funções fc_* (security definer); as tabelas só têm leitura.
-- =====================================================================

-- ---------- equipe e configuração ----------
create table public.fc_membros (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  nome text not null default '',
  papel text not null default 'financeiro' check (papel in ('financeiro','admin')),
  ativo boolean not null default true,
  recebe_email boolean not null default true,
  criado_em timestamptz not null default now()
);
insert into public.fc_membros (email, nome, papel) values ('daniel.zerloti@grupozerbini.com.br', 'Daniel Zerloti', 'admin');

create table public.fc_config (chave text primary key, valor jsonb not null);
insert into public.fc_config values
  ('site_url', '"https://compras.grupozerbini.com.br"'),
  ('empresas', '[]'),
  ('setores', '["Comercial","Compras","Controladoria","Diretoria","Estoque","Expedição","Financeiro","Logística","Marketing","Pricing","Recepção","RH","TI"]'),
  ('formas_pagamento', '["Cartão corporativo","Reembolso","Boleto","PIX","Transferência"]');

-- ---------- solicitações ----------
create table public.fc_solicitacoes (
  id bigint generated always as identity primary key,
  solicitante_email text not null,
  solicitante_nome text not null default '',
  setor text not null default '',
  empresa text not null default '',
  titulo text not null,
  justificativa text not null default '',
  necessario_ate date,
  urgente boolean not null default false,
  quem_compra text not null default 'financeiro' check (quem_compra in ('solicitante','financeiro')),
  forma_pagamento text not null default '',
  valor_estimado numeric(12,2),
  status text not null default 'aguardando_aprovacao' check (status in
    ('aguardando_aprovacao','reprovada','aprovada','comprada','comprovante_enviado','finalizada','cancelada')),
  decisao_obs text not null default '', decidido_por text, decidido_em timestamptz,
  pedido text not null default '', previsao date, comprado_por text, comprado_em timestamptz,
  valor_pago numeric(12,2), data_compra date, nf_numero text not null default '', comprovante_obs text not null default '',
  comprovante_em timestamptz,
  devolucao_obs text not null default '', devolucoes int not null default 0,
  conferido_por text, conferido_em timestamptz,
  cancelado_por text, cancelado_em timestamptz, cancelado_motivo text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index fc_sol_solicitante on public.fc_solicitacoes (solicitante_email);
create index fc_sol_status on public.fc_solicitacoes (status);

create table public.fc_itens (
  id bigint generated always as identity primary key,
  solicitacao_id bigint not null references public.fc_solicitacoes(id) on delete cascade,
  ordem int not null default 0,
  item text not null,
  quantidade int not null default 1 check (quantidade between 1 and 9999),
  valor_unit numeric(12,2) check (valor_unit is null or valor_unit >= 0),
  fornecedor text not null default '',
  link text not null default '',
  obs text not null default ''
);
create index fc_itens_sol on public.fc_itens (solicitacao_id);

create table public.fc_anexos (
  id bigint generated always as identity primary key,
  solicitacao_id bigint not null references public.fc_solicitacoes(id) on delete cascade,
  tipo text not null check (tipo in ('orcamento','comprovante')),
  nome text not null,
  caminho text not null unique,
  tamanho bigint, mime text not null default '',
  enviado_por text not null, enviado_em timestamptz not null default now(),
  recusado boolean not null default false
);
create index fc_anexos_sol on public.fc_anexos (solicitacao_id);

create table public.fc_eventos (
  id bigint generated always as identity primary key,
  solicitacao_id bigint not null references public.fc_solicitacoes(id) on delete cascade,
  em timestamptz not null default now(),
  por_email text not null default '', por_nome text not null default '',
  tipo text not null, texto text not null,
  de text, para text
);
create index fc_eventos_sol on public.fc_eventos (solicitacao_id);

-- ---------- funções de apoio ----------
create or replace function public.fc_email() returns text language sql stable set search_path = public as
$$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function public.fc_papel() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select papel from fc_membros where email = public.fc_email() and ativo),
                  case when public.fc_email() <> '' then 'solicitante' end) $$;

create or replace function public.fc_eh_fin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.fc_papel() in ('financeiro','admin'), false) $$;

create or replace function public.fc_cfg(p text) returns jsonb language sql stable security definer set search_path = public as
$$ select valor from fc_config where chave = p $$;

create or replace function public.fc_nome(p_email text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select nome from fc_membros where email = lower(p_email)),''),
                  nullif((select nome from usuarios where lower(email) = lower(p_email) order by criado_em desc limit 1),''),
                  initcap(replace(split_part(p_email,'@',1),'.',' '))) $$;

create or replace function public.fc_pode_ver(p_id bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.fc_eh_fin() or exists (select 1 from fc_solicitacoes where id = p_id and solicitante_email = public.fc_email()) $$;

create or replace function public.fc_cod(p_id bigint) returns text language sql immutable set search_path = '' as
$$ select '#' || lpad(p_id::text, 4, '0') $$;

create or replace function public.fc_status_label(s text) returns text language sql immutable set search_path = '' as $$
  select case s when 'aguardando_aprovacao' then 'Aguardando aprovação' when 'reprovada' then 'Reprovada' when 'aprovada' then 'Aprovada'
    when 'comprada' then 'Comprada' when 'comprovante_enviado' then 'Comprovante em conferência' when 'finalizada' then 'Finalizada'
    when 'cancelada' then 'Cancelada' else s end $$;

create or replace function public.fc_brl(v numeric) returns text language sql immutable set search_path = '' as $$
  select case when v is null then '' else 'R$ ' || replace(replace(replace(to_char(v, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end $$;

create or replace function public.fc_log(p_sol bigint, p_tipo text, p_texto text, p_de text default null, p_para text default null)
returns void language sql security definer set search_path = public as $$
  insert into fc_eventos (solicitacao_id, por_email, por_nome, tipo, texto, de, para)
  values (p_sol, public.fc_email(), case when public.fc_email() = '' then 'Sistema' else public.fc_nome(public.fc_email()) end, p_tipo, p_texto, p_de, p_para) $$;

-- e-mails: usa a fila do helpdesk (hd_notificacoes, sem chamado), enviada pelo cron hd-notificacoes
create or replace function public.fc_fin_emails() returns text[] language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(email order by email), '{}') from fc_membros where ativo and recebe_email $$;

create or replace function public.fc_email_html(p_sol fc_solicitacoes, p_titulo text, p_intro text, p_corpo text, p_botao text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_url text := coalesce(public.fc_cfg('site_url')#>>'{}', '') || '/#s/' || p_sol.id;
begin
  return '<div style="background:#f3f4f8;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#1f2233">'
  || '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e3e4ec">'
  || '<div style="height:4px;background:linear-gradient(90deg,#4be0db,#212f96,#f9518d);background-color:#212f96"></div>'
  || '<div style="padding:22px 26px">'
  || '<div style="font-size:12px;color:#6b7085;margin-bottom:6px">Compras · Financeiro · Solicitação ' || public.fc_cod(p_sol.id) || '</div>'
  || '<h2 style="margin:0 0 6px;font-size:19px;color:#0f2c66">' || public.hd_esc(p_titulo) || '</h2>'
  || '<p style="margin:0 0 14px;font-size:14px;color:#3b4255">' || p_intro || '</p>'
  || case when coalesce(p_corpo,'') <> '' then
       '<div style="background:#f7f8fe;border-left:3px solid #4be0db;padding:12px 14px;border-radius:6px;font-size:14px;margin-bottom:16px;white-space:pre-wrap">'
       || public.hd_texto_html(left(p_corpo, 3000)) || '</div>' else '' end
  || '<a href="' || v_url || '" style="display:inline-block;background:#212f96;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">'
  || public.hd_esc(p_botao) || '</a></div></div>'
  || '<p style="text-align:center;font-size:11px;color:#9a9db0;margin:14px 0 0">E-mail automático do sistema de compras do Grupo Zerbini.</p></div>';
end $$;

create or replace function public.fc_notificar(p_para text[], p_sol fc_solicitacoes, p_assunto text, p_titulo text, p_intro text, p_corpo text, p_botao text)
returns void language plpgsql security definer set search_path = public as $$
declare v_para text[];
begin
  select coalesce(array_agg(distinct lower(d)), '{}') into v_para from unnest(p_para) d
   where coalesce(d,'') <> '' and lower(d) <> public.fc_email();
  if cardinality(v_para) = 0 then return; end if;
  insert into hd_notificacoes (chamado_id, tipo, destinatarios, assunto, html, status)
  values (null, 'fc_compras', v_para, '[Compras ' || public.fc_cod(p_sol.id) || '] ' || p_assunto,
          public.fc_email_html(p_sol, p_titulo, p_intro, p_corpo, p_botao), 'pendente');
end $$;

create or replace function public.fc_itens_texto(p_id bigint) returns text language sql stable security definer set search_path = public as $$
  select string_agg(quantidade || '× ' || item || case when valor_unit is not null then ' — ' || public.fc_brl(valor_unit * quantidade) else '' end, E'\n' order by ordem, id)
  from fc_itens where solicitacao_id = p_id $$;

-- ---------- regras de acesso: só leitura; escrita pelas funções ----------
alter table public.fc_membros enable row level security;
alter table public.fc_config enable row level security;
alter table public.fc_solicitacoes enable row level security;
alter table public.fc_itens enable row level security;
alter table public.fc_anexos enable row level security;
alter table public.fc_eventos enable row level security;
create policy fc_membros_ler on public.fc_membros for select to authenticated using (public.fc_eh_fin());
create policy fc_config_ler on public.fc_config for select to authenticated using (true);
create policy fc_sol_ler on public.fc_solicitacoes for select to authenticated using (public.fc_eh_fin() or solicitante_email = public.fc_email());
create policy fc_itens_ler on public.fc_itens for select to authenticated using (public.fc_pode_ver(solicitacao_id));
create policy fc_anexos_ler on public.fc_anexos for select to authenticated using (public.fc_pode_ver(solicitacao_id));
create policy fc_eventos_ler on public.fc_eventos for select to authenticated using (public.fc_pode_ver(solicitacao_id));
revoke insert, update, delete, truncate on public.fc_membros, public.fc_config, public.fc_solicitacoes, public.fc_itens, public.fc_anexos, public.fc_eventos from anon, authenticated;
revoke all on public.fc_membros, public.fc_config, public.fc_solicitacoes, public.fc_itens, public.fc_anexos, public.fc_eventos from anon;

-- ---------- quem sou eu ----------
create or replace function public.fc_eu() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('email', public.fc_email(), 'papel', public.fc_papel(), 'nome', public.fc_nome(public.fc_email()),
    'setor', coalesce((select setor from usuarios where lower(email) = public.fc_email() order by criado_em desc limit 1), ''),
    'foto', (select url from hd_fotos where lower(email) = public.fc_email())) $$;

-- ---------- criar / editar / reenviar ----------
-- p: {titulo, justificativa, setor, empresa, necessario_ate, urgente, quem_compra, forma_pagamento,
--     itens:[{item, quantidade, valor_unit, fornecedor, link, obs}]}
create or replace function public.fc_salvar(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_email text := public.fc_email(); it jsonb; n int := 0; v_tot numeric := 0; v_sem_valor boolean := false;
  v_reenvio boolean := false; v_qc text := coalesce(nullif(p->>'quem_compra',''), 'financeiro');
begin
  if v_email = '' then raise exception 'Faça login novamente'; end if;
  if btrim(coalesce(p->>'titulo','')) = '' then raise exception 'Informe o que precisa ser comprado (título)'; end if;
  if btrim(coalesce(p->>'justificativa','')) = '' then raise exception 'Informe a justificativa da compra'; end if;
  if v_qc not in ('solicitante','financeiro') then raise exception 'Informe quem vai fazer a compra'; end if;
  if jsonb_typeof(p->'itens') <> 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Inclua ao menos um item'; end if;
  if jsonb_array_length(p->'itens') > 50 then raise exception 'No máximo 50 itens por solicitação'; end if;

  if p_id is null then
    insert into fc_solicitacoes (solicitante_email, solicitante_nome, titulo) values (v_email, public.fc_nome(v_email), btrim(p->>'titulo'))
    returning * into s;
  else
    select * into s from fc_solicitacoes where id = p_id for update;
    if not found then raise exception 'Solicitação não encontrada'; end if;
    if s.solicitante_email <> v_email and public.fc_papel() <> 'admin' then raise exception 'Só quem pediu pode alterar a solicitação'; end if;
    if s.status not in ('aguardando_aprovacao','reprovada') then raise exception 'Depois de aprovada, a solicitação não pode mais ser alterada. Cancele e abra outra, se precisar.'; end if;
    v_reenvio := s.status = 'reprovada';
    delete from fc_itens where solicitacao_id = s.id;
  end if;

  for it in select * from jsonb_array_elements(p->'itens') loop
    if btrim(coalesce(it->>'item','')) = '' then raise exception 'Informe a descrição de cada item'; end if;
    n := n + 1;
    insert into fc_itens (solicitacao_id, ordem, item, quantidade, valor_unit, fornecedor, link, obs)
    values (s.id, n, btrim(it->>'item'), greatest(1, coalesce(nullif(it->>'quantidade','')::int, 1)),
            nullif(it->>'valor_unit','')::numeric, btrim(coalesce(it->>'fornecedor','')), btrim(coalesce(it->>'link','')), btrim(coalesce(it->>'obs','')));
    if nullif(it->>'valor_unit','') is null then v_sem_valor := true;
    else v_tot := v_tot + (it->>'valor_unit')::numeric * greatest(1, coalesce(nullif(it->>'quantidade','')::int, 1)); end if;
  end loop;

  update fc_solicitacoes set
    titulo = btrim(p->>'titulo'), justificativa = btrim(p->>'justificativa'),
    setor = btrim(coalesce(p->>'setor','')), empresa = btrim(coalesce(p->>'empresa','')),
    necessario_ate = nullif(p->>'necessario_ate','')::date, urgente = coalesce((p->>'urgente')::boolean, false),
    quem_compra = v_qc, forma_pagamento = btrim(coalesce(p->>'forma_pagamento','')),
    valor_estimado = case when v_tot > 0 then v_tot end,
    status = 'aguardando_aprovacao',
    decisao_obs = case when v_reenvio then '' else decisao_obs end,
    decidido_por = case when v_reenvio then null else decidido_por end,
    decidido_em = case when v_reenvio then null else decidido_em end,
    atualizado_em = now()
  where id = s.id returning * into s;

  if p_id is null then
    perform public.fc_log(s.id, 'criada', 'Solicitação criada' || coalesce(' · ' || public.fc_brl(s.valor_estimado), ''), null, 'aguardando_aprovacao');
    perform public.fc_notificar(public.fc_fin_emails(), s, 'Nova solicitação: ' || s.titulo, 'Nova solicitação de compra',
      '<b>' || public.hd_esc(s.solicitante_nome) || '</b>' || case when s.setor <> '' then ' (' || public.hd_esc(s.setor) || ')' else '' end
      || ' pediu uma compra' || coalesce(' de <b>' || public.fc_brl(s.valor_estimado) || '</b>', '') || case when s.urgente then ' · <b style="color:#c62828">urgente</b>' else '' end || '.',
      s.titulo || E'\n\n' || public.fc_itens_texto(s.id) || E'\n\nJustificativa: ' || s.justificativa, 'Abrir para aprovar');
  elsif v_reenvio then
    perform public.fc_log(s.id, 'reenviada', 'Alterada e reenviada para aprovação', 'reprovada', 'aguardando_aprovacao');
    perform public.fc_notificar(public.fc_fin_emails(), s, 'Reenviada: ' || s.titulo, 'Solicitação reenviada para aprovação',
      '<b>' || public.hd_esc(s.solicitante_nome) || '</b> alterou a solicitação reprovada e enviou de novo.',
      s.titulo || E'\n\n' || public.fc_itens_texto(s.id), 'Abrir para aprovar');
  else
    perform public.fc_log(s.id, 'editada', 'Solicitação alterada' || coalesce(' · ' || public.fc_brl(s.valor_estimado), ''));
  end if;
  return s.id;
end $$;

-- ---------- aprovar / reprovar (Financeiro) ----------
create or replace function public.fc_decidir(p_id bigint, p_aprovar boolean, p_obs text default '', p_quem_compra text default null, p_forma text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_qc text;
begin
  if not public.fc_eh_fin() then raise exception 'Somente o Financeiro pode aprovar ou reprovar'; end if;
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.status <> 'aguardando_aprovacao' then raise exception 'Esta solicitação não está aguardando aprovação'; end if;
  if not p_aprovar and btrim(coalesce(p_obs,'')) = '' then raise exception 'Informe o motivo da reprovação'; end if;
  v_qc := coalesce(nullif(p_quem_compra,''), s.quem_compra);
  if v_qc not in ('solicitante','financeiro') then raise exception 'Quem compra inválido'; end if;
  update fc_solicitacoes set status = case when p_aprovar then 'aprovada' else 'reprovada' end,
    decisao_obs = btrim(coalesce(p_obs,'')), decidido_por = public.fc_email(), decidido_em = now(),
    quem_compra = v_qc, forma_pagamento = coalesce(nullif(btrim(p_forma),''), forma_pagamento), atualizado_em = now()
  where id = p_id returning * into s;
  if p_aprovar then
    perform public.fc_log(s.id, 'aprovada', 'Aprovada' || case when v_qc = 'solicitante' then ' · compra feita pelo solicitante' else ' · compra feita pelo Financeiro' end
      || case when s.decisao_obs <> '' then ' — ' || s.decisao_obs else '' end, 'aguardando_aprovacao', 'aprovada');
    perform public.fc_notificar(array[s.solicitante_email], s, 'Aprovada: ' || s.titulo, 'Sua solicitação foi aprovada',
      case when v_qc = 'solicitante' then 'Pode fazer a compra' || case when s.forma_pagamento <> '' then ' (' || public.hd_esc(s.forma_pagamento) || ')' else '' end
        || '. Depois, <b>anexe o comprovante</b> na solicitação para o Financeiro conferir e finalizar.'
      else 'O Financeiro vai fazer a compra. Quando receber, <b>anexe o comprovante</b> na solicitação para finalizar.' end,
      nullif(s.decisao_obs,''), 'Abrir solicitação');
  else
    perform public.fc_log(s.id, 'reprovada', 'Reprovada — ' || s.decisao_obs, 'aguardando_aprovacao', 'reprovada');
    perform public.fc_notificar(array[s.solicitante_email], s, 'Reprovada: ' || s.titulo, 'Sua solicitação foi reprovada',
      'O Financeiro reprovou a solicitação. Você pode ajustar e reenviar, ou cancelar.', 'Motivo: ' || s.decisao_obs, 'Abrir solicitação');
  end if;
end $$;

-- ---------- registrar a compra (Financeiro, ou o solicitante quando é ele quem compra) ----------
create or replace function public.fc_registrar_compra(p_id bigint, p_pedido text, p_previsao date, p_obs text default '')
returns void language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_fin boolean := public.fc_eh_fin(); v_de text;
begin
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  v_de := s.status;
  if not v_fin and not (s.solicitante_email = public.fc_email() and s.quem_compra = 'solicitante') then
    raise exception 'Somente quem faz a compra pode registrá-la'; end if;
  if s.status not in ('aprovada','comprada') then raise exception 'A solicitação precisa estar aprovada'; end if;
  update fc_solicitacoes set status = 'comprada', pedido = btrim(coalesce(p_pedido,'')), previsao = p_previsao,
    comprado_por = coalesce(comprado_por, public.fc_email()), comprado_em = coalesce(comprado_em, now()), atualizado_em = now()
  where id = p_id returning * into s;
  perform public.fc_log(s.id, 'comprada',
    case when v_de = 'comprada' then 'Compra atualizada' else 'Compra registrada' end
    || case when s.pedido <> '' then ' · pedido ' || s.pedido else '' end
    || case when s.previsao is not null then ' · previsão ' || to_char(s.previsao,'DD/MM/YYYY') else '' end
    || case when btrim(coalesce(p_obs,'')) <> '' then ' — ' || btrim(p_obs) else '' end, v_de, 'comprada');
  if v_fin and v_de = 'aprovada' and s.solicitante_email <> public.fc_email() then
    perform public.fc_notificar(array[s.solicitante_email], s, 'Compra feita: ' || s.titulo, 'A compra foi feita',
      'O Financeiro registrou a compra' || case when s.previsao is not null then ', com previsão de chegada em <b>' || to_char(s.previsao,'DD/MM/YYYY') || '</b>' else '' end
      || '. Quando receber, <b>anexe o comprovante</b> na solicitação para finalizar.',
      nullif(concat_ws(E'\n', case when s.pedido <> '' then 'Pedido: ' || s.pedido end, nullif(btrim(coalesce(p_obs,'')),'')), ''), 'Abrir solicitação');
  end if;
end $$;

-- ---------- enviar comprovante (solicitante) ----------
create or replace function public.fc_enviar_comprovante(p_id bigint, p_valor_pago numeric, p_data_compra date, p_nf text default '', p_obs text default '')
returns void language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_de text;
begin
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.solicitante_email <> public.fc_email() and public.fc_papel() <> 'admin' then raise exception 'Só quem pediu a compra envia o comprovante'; end if;
  if s.status not in ('aprovada','comprada') then raise exception 'A solicitação precisa estar aprovada para receber o comprovante'; end if;
  if not exists (select 1 from fc_anexos where solicitacao_id = p_id and tipo = 'comprovante' and not recusado) then
    raise exception 'Anexe o comprovante de compra antes de enviar'; end if;
  if p_valor_pago is null or p_valor_pago <= 0 then raise exception 'Informe o valor pago'; end if;
  if p_data_compra is null then raise exception 'Informe a data da compra'; end if;
  if p_data_compra > current_date + 1 then raise exception 'A data da compra não pode ser no futuro'; end if;
  v_de := s.status;
  update fc_solicitacoes set status = 'comprovante_enviado', valor_pago = p_valor_pago, data_compra = p_data_compra,
    nf_numero = btrim(coalesce(p_nf,'')), comprovante_obs = btrim(coalesce(p_obs,'')), comprovante_em = now(), atualizado_em = now()
  where id = p_id returning * into s;
  perform public.fc_log(s.id, 'comprovante', 'Comprovante enviado · ' || public.fc_brl(s.valor_pago) || ' em ' || to_char(s.data_compra,'DD/MM/YYYY')
    || case when s.nf_numero <> '' then ' · NF ' || s.nf_numero else '' end, v_de, 'comprovante_enviado');
  perform public.fc_notificar(public.fc_fin_emails(), s, 'Comprovante para conferir: ' || s.titulo, 'Comprovante enviado',
    '<b>' || public.hd_esc(s.solicitante_nome) || '</b> anexou o comprovante de <b>' || public.fc_brl(s.valor_pago) || '</b>'
    || case when s.valor_estimado is not null and s.valor_pago > s.valor_estimado then ' (acima do estimado de ' || public.fc_brl(s.valor_estimado) || ')' else '' end || '.',
    nullif(s.comprovante_obs,''), 'Conferir e finalizar');
end $$;

-- ---------- conferir: finalizar ou devolver (Financeiro) ----------
create or replace function public.fc_conferir(p_id bigint, p_ok boolean, p_obs text default '')
returns void language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_volta text;
begin
  if not public.fc_eh_fin() then raise exception 'Somente o Financeiro confere o comprovante'; end if;
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.status <> 'comprovante_enviado' then raise exception 'Não há comprovante aguardando conferência'; end if;
  if p_ok then
    update fc_solicitacoes set status = 'finalizada', conferido_por = public.fc_email(), conferido_em = now(), devolucao_obs = '', atualizado_em = now()
    where id = p_id returning * into s;
    perform public.fc_log(s.id, 'finalizada', 'Comprovante conferido · solicitação finalizada' || case when btrim(coalesce(p_obs,'')) <> '' then ' — ' || btrim(p_obs) else '' end,
      'comprovante_enviado', 'finalizada');
    perform public.fc_notificar(array[s.solicitante_email], s, 'Finalizada: ' || s.titulo, 'Solicitação finalizada',
      'O Financeiro conferiu o comprovante e finalizou a solicitação.', nullif(btrim(coalesce(p_obs,'')),''), 'Abrir solicitação');
  else
    if btrim(coalesce(p_obs,'')) = '' then raise exception 'Explique o que precisa ser corrigido no comprovante'; end if;
    v_volta := case when s.comprado_em is not null then 'comprada' else 'aprovada' end;
    update fc_anexos set recusado = true where solicitacao_id = p_id and tipo = 'comprovante' and not recusado;
    update fc_solicitacoes set status = v_volta, devolucao_obs = btrim(p_obs), devolucoes = devolucoes + 1, comprovante_em = null, atualizado_em = now()
    where id = p_id returning * into s;
    perform public.fc_log(s.id, 'devolvida', 'Comprovante devolvido — ' || s.devolucao_obs, 'comprovante_enviado', v_volta);
    perform public.fc_notificar(array[s.solicitante_email], s, 'Comprovante devolvido: ' || s.titulo, 'Precisamos de outro comprovante',
      'O Financeiro devolveu o comprovante. Anexe um novo e envie de novo.', 'O que corrigir: ' || s.devolucao_obs, 'Anexar comprovante');
  end if;
end $$;

-- ---------- cancelar ----------
create or replace function public.fc_cancelar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_fin boolean := public.fc_eh_fin(); v_dono boolean; v_de text;
begin
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  v_dono := s.solicitante_email = public.fc_email();
  if not v_fin and not v_dono then raise exception 'Sem permissão para cancelar'; end if;
  if s.status in ('finalizada','cancelada') then raise exception 'Esta solicitação já foi encerrada'; end if;
  if not v_fin and s.status not in ('aguardando_aprovacao','reprovada','aprovada') then
    raise exception 'A compra já foi feita: peça ao Financeiro para cancelar'; end if;
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'Informe o motivo do cancelamento'; end if;
  v_de := s.status;
  update fc_solicitacoes set status = 'cancelada', cancelado_por = public.fc_email(), cancelado_em = now(), cancelado_motivo = btrim(p_motivo), atualizado_em = now()
  where id = p_id returning * into s;
  perform public.fc_log(s.id, 'cancelada', 'Cancelada — ' || s.cancelado_motivo, v_de, 'cancelada');
  if v_dono then
    if v_de in ('aprovada','aguardando_aprovacao') then
      perform public.fc_notificar(public.fc_fin_emails(), s, 'Cancelada: ' || s.titulo, 'Solicitação cancelada pelo solicitante',
        '<b>' || public.hd_esc(s.solicitante_nome) || '</b> cancelou a solicitação.', 'Motivo: ' || s.cancelado_motivo, 'Abrir solicitação');
    end if;
  else
    perform public.fc_notificar(array[s.solicitante_email], s, 'Cancelada: ' || s.titulo, 'Sua solicitação foi cancelada',
      'O Financeiro cancelou a solicitação.', 'Motivo: ' || s.cancelado_motivo, 'Abrir solicitação');
  end if;
end $$;

-- ---------- anexos (bucket privado "compras", caminho {solicitação}/{tipo}/{arquivo}) ----------
create or replace function public.fc_pode_anexar(p_sol bigint, p_tipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fc_solicitacoes s where s.id = p_sol and (
    (p_tipo = 'orcamento' and ((s.solicitante_email = public.fc_email() and s.status in ('aguardando_aprovacao','reprovada'))
                               or (public.fc_eh_fin() and s.status not in ('finalizada','cancelada'))))
    or (p_tipo = 'comprovante' and (s.solicitante_email = public.fc_email() or public.fc_papel() = 'admin') and s.status in ('aprovada','comprada')))) $$;

create or replace function public.fc_caminho_sol(p text) returns bigint language sql immutable set search_path = '' as
$$ select case when split_part(p,'/',1) ~ '^[0-9]{1,15}$' then split_part(p,'/',1)::bigint end $$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('compras', 'compras', false, 15728640) on conflict (id) do nothing;

create policy fc_storage_ler on storage.objects for select to authenticated
  using (bucket_id = 'compras' and public.fc_pode_ver(public.fc_caminho_sol(name)));
create policy fc_storage_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'compras' and public.fc_pode_anexar(public.fc_caminho_sol(name), split_part(name,'/',2)));
create policy fc_storage_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'compras' and owner_id = auth.uid()::text
         and not exists (select 1 from public.fc_anexos a where a.caminho = name));

create or replace function public.fc_anexo_registrar(p_sol bigint, p_tipo text, p_caminho text, p_nome text, p_tamanho bigint, p_mime text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_tipo not in ('orcamento','comprovante') then raise exception 'Tipo de anexo inválido'; end if;
  if not public.fc_pode_anexar(p_sol, p_tipo) then raise exception 'Não é possível anexar % nesta etapa', case when p_tipo='comprovante' then 'comprovante' else 'orçamento' end; end if;
  if split_part(p_caminho,'/',1) <> p_sol::text or split_part(p_caminho,'/',2) <> p_tipo then raise exception 'Caminho do anexo inválido'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'compras' and name = p_caminho and owner_id = auth.uid()::text) then
    raise exception 'Arquivo não encontrado. Envie de novo.'; end if;
  insert into fc_anexos (solicitacao_id, tipo, nome, caminho, tamanho, mime, enviado_por)
  values (p_sol, p_tipo, left(btrim(p_nome),200), p_caminho, p_tamanho, coalesce(p_mime,''), public.fc_email()) returning id into v_id;
  perform public.fc_log(p_sol, 'anexo', case when p_tipo = 'comprovante' then 'Comprovante anexado: ' else 'Orçamento anexado: ' end || left(btrim(p_nome),200));
  return v_id;
end $$;

-- remove o registro e devolve o caminho para o app apagar o arquivo
create or replace function public.fc_anexo_remover(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare a fc_anexos;
begin
  select * into a from fc_anexos where id = p_id for update;
  if not found then raise exception 'Anexo não encontrado'; end if;
  if a.enviado_por <> public.fc_email() then raise exception 'Só quem enviou pode remover o anexo'; end if;
  if a.recusado then raise exception 'Comprovante devolvido fica no histórico'; end if;
  if not public.fc_pode_anexar(a.solicitacao_id, a.tipo) then raise exception 'Este anexo não pode mais ser removido'; end if;
  delete from fc_anexos where id = p_id;
  perform public.fc_log(a.solicitacao_id, 'anexo', 'Anexo removido: ' || a.nome);
  return a.caminho;
end $$;

-- ---------- administração ----------
create or replace function public.fc_membro_salvar(p_email text, p_nome text, p_papel text, p_ativo boolean, p_recebe_email boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(p_email));
begin
  if public.fc_papel() <> 'admin' then raise exception 'Somente administradores'; end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido'; end if;
  if p_papel not in ('financeiro','admin') then raise exception 'Perfil inválido'; end if;
  if v = public.fc_email() and (p_papel <> 'admin' or not p_ativo) then raise exception 'Você não pode tirar o próprio acesso de administrador'; end if;
  insert into fc_membros (email, nome, papel, ativo, recebe_email) values (v, btrim(coalesce(p_nome,'')), p_papel, p_ativo, p_recebe_email)
  on conflict (email) do update set nome = excluded.nome, papel = excluded.papel, ativo = excluded.ativo, recebe_email = excluded.recebe_email;
end $$;

create or replace function public.fc_membro_remover(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.fc_papel() <> 'admin' then raise exception 'Somente administradores'; end if;
  if lower(p_email) = public.fc_email() then raise exception 'Você não pode remover a si mesmo'; end if;
  delete from fc_membros where email = lower(p_email);
end $$;

create or replace function public.fc_config_salvar(p_chave text, p_valor jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.fc_papel() <> 'admin' then raise exception 'Somente administradores'; end if;
  if p_chave not in ('empresas','setores','formas_pagamento') then raise exception 'Configuração inválida'; end if;
  if jsonb_typeof(p_valor) <> 'array' then raise exception 'Lista inválida'; end if;
  insert into fc_config values (p_chave, p_valor) on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------- permissões das funções ----------
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fc\_%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname in ('fc_eu','fc_salvar','fc_decidir','fc_registrar_compra','fc_enviar_comprovante','fc_conferir','fc_cancelar',
                     'fc_anexo_registrar','fc_anexo_remover','fc_membro_salvar','fc_membro_remover','fc_config_salvar',
                     'fc_email','fc_papel','fc_eh_fin','fc_pode_ver','fc_pode_anexar','fc_caminho_sol') then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

alter publication supabase_realtime add table public.fc_solicitacoes;
