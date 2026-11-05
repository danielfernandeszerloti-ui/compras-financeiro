-- =====================================================================
-- "Equipe de compras" passa a ser "Financeiro/Compras" (aplicada em 2026-11-05)
-- Quem compra é o setor Financeiro ou o setor Compras, ou o próprio solicitante.
-- =====================================================================
do $d$ declare f text; begin
  f := pg_get_functiondef('public.fc_decidir(bigint,boolean,text,text,text)'::regprocedure);
  f := replace(f, $a$' · compra pela equipe de compras'$a$, $a$' · compra pelo Financeiro/Compras'$a$);
  f := replace(f, $a$'A equipe de compras vai fazer a compra. Quando receber,$a$, $a$'O Financeiro/Compras vai fazer a compra. Quando receber,$a$);
  f := replace(f, $a$'Aprovada, a equipe de compras vai comprar: '$a$, $a$'Aprovada, o Financeiro/Compras vai comprar: '$a$);
  f := replace(f, $a$'Aprovada: a equipe de compras vai comprar'$a$, $a$'Aprovada: o Financeiro/Compras vai comprar'$a$);
  if f like '%equipe de compras%' then raise exception 'patch falhou'; end if;
  execute f;
end $d$;
