-- =====================================================================
-- Excluir solicitação (aplicada em 2026-11-04)
-- Só administradores. Para testes ou solicitações lançadas por engano: apaga a
-- solicitação com itens, anexos e histórico. Fica um registro em fc_exclusoes
-- (quem, quando, motivo). Os arquivos são apagados pelo app (o caminho volta na resposta).
-- Se a excluída era a última, a numeração volta para depois da maior que restou.
-- =====================================================================
create table public.fc_exclusoes (
  id bigint generated always as identity primary key,
  solicitacao_id bigint not null,
  titulo text not null,
  solicitante_email text not null,
  status text not null,
  valor numeric(12,2),
  motivo text not null,
  excluido_por text not null,
  excluido_em timestamptz not null default now()
);
alter table public.fc_exclusoes enable row level security;
create policy fc_exclusoes_ler on public.fc_exclusoes for select to authenticated using (public.fc_papel() = 'admin');
revoke insert, update, delete, truncate on public.fc_exclusoes from anon, authenticated;
revoke all on public.fc_exclusoes from anon;

-- administrador pode apagar arquivos que não estão mais ligados a nenhum anexo
alter policy fc_storage_apagar on storage.objects
  using (bucket_id = 'compras' and (owner_id = auth.uid()::text or public.fc_papel() = 'admin')
         and not exists (select 1 from public.fc_anexos a where a.caminho = name));

create or replace function public.fc_excluir(p_id bigint, p_motivo text) returns text[]
language plpgsql security definer set search_path = public as $$
declare s fc_solicitacoes; v_arqs text[];
begin
  if public.fc_papel() <> 'admin' then raise exception 'Somente administradores podem excluir'; end if;
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'Informe o motivo da exclusão'; end if;
  select * into s from fc_solicitacoes where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  select coalesce(array_agg(caminho), '{}') into v_arqs from fc_anexos where solicitacao_id = p_id;
  insert into fc_exclusoes (solicitacao_id, titulo, solicitante_email, status, valor, motivo, excluido_por)
  values (s.id, s.titulo, s.solicitante_email, s.status, coalesce(s.valor_pago, s.valor_estimado), btrim(p_motivo), public.fc_email());
  delete from fc_solicitacoes where id = p_id;   -- itens, anexos e histórico saem em cascata
  -- e-mails ainda não enviados desta solicitação não saem mais
  update hd_notificacoes set status = 'ignorado', erro = 'solicitação excluída'
   where tipo = 'fc_compras' and status = 'pendente' and assunto like '[Compras ' || public.fc_cod(p_id) || ']%';
  perform setval(pg_get_serial_sequence('public.fc_solicitacoes','id'), (select coalesce(max(id),0) + 1 from fc_solicitacoes), false);
  return v_arqs;
end $$;
revoke execute on function public.fc_excluir(bigint,text) from public, anon;
grant execute on function public.fc_excluir(bigint,text) to authenticated;
