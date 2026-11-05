-- =====================================================================
-- Textos de "quem compra" (aplicada em 2026-11-05)
-- "Financeiro" vira "equipe de compras" nos avisos; o e-mail de aprovação deixa
-- claro no assunto quem faz a compra.
-- =====================================================================
do $d$ declare f text; begin
  f := pg_get_functiondef('public.fc_decidir(bigint,boolean,text,text,text)'::regprocedure);
  f := replace(f, $a$' · compra feita pelo Financeiro'$a$, $a$' · compra pela equipe de compras'$a$);
  f := replace(f, $a$'O Financeiro vai fazer a compra. Quando receber,$a$, $a$'A equipe de compras vai fazer a compra. Quando receber,$a$);
  f := replace(f, $a$perform public.fc_notificar(array[s.solicitante_email], s, 'Aprovada: ' || s.titulo, 'Sua solicitação foi aprovada',$a$,
                  $a$perform public.fc_notificar(array[s.solicitante_email], s,
      case when v_qc = 'solicitante' then 'Aprovada, você faz a compra: ' else 'Aprovada, a equipe de compras vai comprar: ' end || s.titulo,
      case when v_qc = 'solicitante' then 'Aprovada: você faz a compra' else 'Aprovada: a equipe de compras vai comprar' end,$a$);
  if f not like '%equipe de compras vai fazer%' or f not like '%Aprovada, você faz a compra%' or f not like '%pela equipe de compras%' then raise exception 'patch falhou'; end if;
  execute f;
end $d$;

-- comprador registra só as compras da equipe (quem_compra = financeiro); Financeiro e admin, qualquer uma
do $d$ declare f text; begin
  f := pg_get_functiondef('public.fc_registrar_compra(bigint,text,date,text)'::regprocedure);
  f := replace(f, $a$if not v_fin and not (s.solicitante_email = public.fc_email() and s.quem_compra = 'solicitante') then$a$,
                  $a$if not (public.fc_eh_fin() or (v_fin and s.quem_compra = 'financeiro') or (s.solicitante_email = public.fc_email() and s.quem_compra = 'solicitante')) then$a$);
  if f not like '%(v_fin and s.quem_compra = ''financeiro'')%' then raise exception 'patch falhou'; end if;
  execute f;
end $d$;
