-- =====================================================================
-- Assinaturas (aplicada em 2026-11-05)
-- A solicitação pode ser compra única, assinatura mensal ou anual. Nas assinaturas,
-- o valor dos itens é por período (mês ou ano). A assinatura fica ativa a partir da
-- compra e até o Financeiro encerrar. Renovações anuais avisam o Financeiro por
-- e-mail 30 e 7 dias antes.
-- =====================================================================
alter table public.fc_solicitacoes
  add column recorrencia text not null default 'unica' check (recorrencia in ('unica','mensal','anual')),
  add column assinatura_encerrada_em date,
  add column assinatura_encerrada_por text,
  add column assinatura_encerrada_motivo text not null default '';

create or replace function public.fc_rec_label(r text) returns text language sql immutable set search_path = '' as $$
  select case r when 'mensal' then 'assinatura mensal' when 'anual' then 'assinatura anual' else 'compra única' end $$;

-- data de início da assinatura e próxima renovação
create or replace function public.fc_assinatura_inicio(s fc_solicitacoes) returns date language sql stable set search_path = public as
$$ select coalesce(s.data_compra, s.comprado_em::date, s.comprovante_em::date) $$;

create or replace function public.fc_proxima_renovacao(s fc_solicitacoes) returns date language plpgsql stable set search_path = public as $$
declare d date := public.fc_assinatura_inicio(s); passo interval;
begin
  if s.recorrencia = 'unica' or d is null then return null; end if;
  passo := case s.recorrencia when 'mensal' then interval '1 month' else interval '1 year' end;
  d := (d + passo)::date;
  while d < current_date loop d := (d + passo)::date; end loop;
  return d;
end $$;

-- salvar: guarda a recorrência
do $d$ declare f text; begin
  f := pg_get_functiondef('public.fc_salvar(bigint,jsonb)'::regprocedure);
  f := replace(f, $a$  if v_qc not in ('solicitante','financeiro') then raise exception 'Informe quem vai fazer a compra'; end if;$a$,
                  $a$  if v_qc not in ('solicitante','financeiro') then raise exception 'Informe quem vai fazer a compra'; end if;
  if coalesce(nullif(p->>'recorrencia',''),'unica') not in ('unica','mensal','anual') then raise exception 'Tipo de compra inválido'; end if;$a$);
  f := replace(f, $a$    quem_compra = v_qc, forma_pagamento = btrim(coalesce(p->>'forma_pagamento','')),$a$,
                  $a$    quem_compra = v_qc, forma_pagamento = btrim(coalesce(p->>'forma_pagamento','')),
    recorrencia = coalesce(nullif(p->>'recorrencia',''),'unica'),$a$);
  -- e-mail de nova solicitação diz se é assinatura
  f := replace(f, $a$|| ' pediu uma compra' || coalesce(' de <b>' || public.fc_brl(s.valor_estimado) || '</b>', '')$a$,
                  $a$|| case when s.recorrencia = 'unica' then ' pediu uma compra' else ' pediu uma <b>' || public.fc_rec_label(s.recorrencia) || '</b>' end
      || coalesce(' de <b>' || public.fc_brl(s.valor_estimado) || case s.recorrencia when 'mensal' then '/mês' when 'anual' then '/ano' else '' end || '</b>', '')$a$);
  if f not like '%recorrencia = coalesce%' or f not like '%fc_rec_label%' then raise exception 'patch salvar falhou'; end if;
  execute f;
end $d$;

-- encerrar assinatura (Financeiro)
create or replace function public.fc_encerrar_assinatura(p_id bigint, p_data date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes;
begin
  if not public.fc_eh_fin() then raise exception 'Somente o Financeiro encerra assinaturas'; end if;
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if s.recorrencia = 'unica' then raise exception 'Esta solicitação não é uma assinatura'; end if;
  if s.assinatura_encerrada_em is not null then raise exception 'Esta assinatura já foi encerrada'; end if;
  if s.status not in ('comprada','comprovante_enviado','finalizada') then raise exception 'A assinatura ainda não foi contratada. Para desistir, cancele a solicitação.'; end if;
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'Informe o motivo do encerramento'; end if;
  update fc_solicitacoes set assinatura_encerrada_em = coalesce(p_data, current_date), assinatura_encerrada_por = public.fc_email(),
    assinatura_encerrada_motivo = btrim(p_motivo), atualizado_em = now() where id = p_id returning * into s;
  perform public.fc_log(s.id, 'assinatura', 'Assinatura encerrada em ' || to_char(s.assinatura_encerrada_em,'DD/MM/YYYY') || ' — ' || s.assinatura_encerrada_motivo);
  perform public.fc_notificar(array[s.solicitante_email], s, 'Assinatura encerrada: ' || s.titulo, 'Assinatura encerrada',
    'O Financeiro encerrou a ' || public.fc_rec_label(s.recorrencia) || ' a partir de <b>' || to_char(s.assinatura_encerrada_em,'DD/MM/YYYY') || '</b>.',
    'Motivo: ' || s.assinatura_encerrada_motivo, 'Abrir solicitação');
end $$;
revoke execute on function public.fc_encerrar_assinatura(bigint,date,text) from public, anon;
grant execute on function public.fc_encerrar_assinatura(bigint,date,text) to authenticated;

-- aviso de renovação anual (30 e 7 dias antes), uma vez por renovação
create table public.fc_assinatura_avisos (
  solicitacao_id bigint not null references public.fc_solicitacoes(id) on delete cascade,
  renovacao date not null, dias int not null, em timestamptz not null default now(),
  primary key (solicitacao_id, renovacao, dias)
);
alter table public.fc_assinatura_avisos enable row level security;
revoke all on public.fc_assinatura_avisos from anon, authenticated;

create or replace function public.fc_assinaturas_avisar() returns int
language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_ren date; v_d int; v_dias int; n int := 0;
begin
  for s in select * from fc_solicitacoes where recorrencia = 'anual' and assinatura_encerrada_em is null
             and status in ('comprada','comprovante_enviado','finalizada') loop
    v_ren := public.fc_proxima_renovacao(s); if v_ren is null then continue; end if;
    v_d := v_ren - current_date;
    v_dias := case when v_d <= 7 then 7 when v_d <= 30 then 30 end;
    if v_dias is null then continue; end if;
    if exists (select 1 from fc_assinatura_avisos where solicitacao_id = s.id and renovacao = v_ren and dias <= v_dias) then continue; end if;
    insert into fc_assinatura_avisos (solicitacao_id, renovacao, dias) values (s.id, v_ren, v_dias);
    perform public.fc_notificar(public.fc_fin_emails(), s, 'Renovação em ' || v_d || ' dias: ' || s.titulo, 'Assinatura anual renova em ' || v_d || ' dias',
      'A assinatura de <b>' || public.hd_esc(s.solicitante_nome) || '</b>' || case when s.setor <> '' then ' (' || public.hd_esc(s.setor) || ')' else '' end
      || ' renova em <b>' || to_char(v_ren,'DD/MM/YYYY') || '</b>' || coalesce(', valor de referência <b>' || public.fc_brl(coalesce(s.valor_pago, s.valor_estimado)) || '/ano</b>', '')
      || '. Se não for mais usada, encerre antes da renovação.', public.fc_itens_texto(s.id), 'Ver assinatura');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.fc_assinaturas_avisar() from public, anon, authenticated;
revoke execute on function public.fc_rec_label(text), public.fc_assinatura_inicio(fc_solicitacoes), public.fc_proxima_renovacao(fc_solicitacoes) from public, anon;

select cron.schedule('fc-assinaturas-avisos', '7 11 * * *', 'select public.fc_assinaturas_avisar()');
