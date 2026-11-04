-- =====================================================================
-- Perfil "comprador" (aplicada em 2026-11-04)
-- Faz só a compra: vê todas as solicitações e registra a compra (pedido e previsão)
-- das aprovadas. Não aprova, não confere comprovante, não cancela e não configura.
-- Recebe e-mail quando uma solicitação é aprovada para o Financeiro comprar.
-- =====================================================================
alter table public.fc_membros drop constraint if exists fc_membros_papel_check;
alter table public.fc_membros add constraint fc_membros_papel_check check (papel in ('comprador','financeiro','admin'));

-- quem vê todas as solicitações (Financeiro, administrador e comprador)
create or replace function public.fc_ve_tudo() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.fc_papel() in ('comprador','financeiro','admin'), false) $$;
revoke execute on function public.fc_ve_tudo() from public, anon;
grant execute on function public.fc_ve_tudo() to authenticated;

create or replace function public.fc_pode_ver(p_id bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.fc_ve_tudo() or exists (select 1 from fc_solicitacoes where id = p_id and solicitante_email = public.fc_email()) $$;

alter policy fc_sol_ler on public.fc_solicitacoes using (public.fc_ve_tudo() or solicitante_email = public.fc_email());
alter policy fc_membros_ler on public.fc_membros using (public.fc_ve_tudo());

create or replace function public.fc_compradores_emails() returns text[] language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(email order by email), '{}') from fc_membros where ativo and recebe_email and papel = 'comprador' $$;
revoke execute on function public.fc_compradores_emails() from public, anon, authenticated;

do $d$ declare f text; begin
  -- registrar compra: comprador, Financeiro ou o solicitante quando é ele quem compra
  f := pg_get_functiondef('public.fc_registrar_compra(bigint,text,date,text)'::regprocedure);
  f := replace(f, 'v_fin boolean := public.fc_eh_fin();', 'v_fin boolean := public.fc_ve_tudo();');
  f := replace(f, $a$'O Financeiro registrou a compra'$a$, $a$'A compra foi registrada'$a$);
  if f not like '%fc_ve_tudo()%' or f not like '%A compra foi registrada%' then raise exception 'patch registrar falhou'; end if;
  execute f;

  -- aprovação com compra pelo Financeiro avisa os compradores
  f := pg_get_functiondef('public.fc_decidir(bigint,boolean,text,text,text)'::regprocedure);
  f := replace(f, $a$      nullif(s.decisao_obs,''), 'Abrir solicitação');
  else$a$, $a$      nullif(s.decisao_obs,''), 'Abrir solicitação');
    if v_qc = 'financeiro' then
      perform public.fc_notificar(public.fc_compradores_emails(), s, 'Para comprar: ' || s.titulo, 'Nova compra aprovada',
        'O Financeiro aprovou a solicitação de <b>' || public.hd_esc(s.solicitante_nome) || '</b>'
        || coalesce(' (' || public.fc_brl(s.valor_estimado) || ')', '') || case when s.urgente then ' · <b style="color:#c62828">urgente</b>' else '' end
        || '. Faça a compra e registre o pedido e a previsão de chegada.',
        s.titulo || E'\n\n' || public.fc_itens_texto(s.id) || case when s.forma_pagamento <> '' then E'\n\nForma de pagamento: ' || s.forma_pagamento else '' end
        || case when s.decisao_obs <> '' then E'\nObservação: ' || s.decisao_obs else '' end, 'Abrir para registrar a compra');
    end if;
  else$a$);
  if f not like '%fc_compradores_emails()%' then raise exception 'patch decidir falhou'; end if;
  execute f;

  f := pg_get_functiondef('public.fc_membro_salvar(text,text,text,boolean,boolean)'::regprocedure);
  f := replace(f, $a$if p_papel not in ('financeiro','admin')$a$, $a$if p_papel not in ('comprador','financeiro','admin')$a$);
  if f not like '%''comprador'',''financeiro'',''admin''%' then raise exception 'patch membro falhou'; end if;
  execute f;
end $d$;

-- e-mails de nova solicitação e de comprovante vão só para Financeiro e administradores
create or replace function public.fc_fin_emails() returns text[] language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(email order by email), '{}') from fc_membros where ativo and recebe_email and papel in ('financeiro','admin') $$;
