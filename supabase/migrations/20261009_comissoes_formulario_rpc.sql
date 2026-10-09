-- Formulário de Comissões Comerciais (Vercel) -> Supabase segantini-cadastro
--
-- O formulário roda na Vercel; as funções serverless chamam estas RPCs
-- com a chave publishable + um token de integração que só existe nas
-- variáveis de ambiente da Vercel. Nenhuma service_role sai do Supabase.
-- Os tokens são guardados apenas como hash SHA-256 no schema `private`,
-- que não é exposto pela API REST.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.integracao_tokens (
  nome        text primary key,          -- 'formulario' | 'planilha'
  token_hash  text not null,             -- sha256 hex do token
  created_at  timestamptz not null default now()
);
revoke all on private.integracao_tokens from public, anon, authenticated;

create or replace function private.token_valido(p_nome text, p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.integracao_tokens t
    where t.nome = p_nome
      and p_token is not null
      and length(p_token) >= 32
      and t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  );
$$;

-- Lista de clientes para o dropdown (somente id + nome, sem dados sensíveis)
create or replace function public.comissoes_listar_clientes(p_token text)
returns table (id uuid, nome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.token_valido('formulario', p_token) then
    raise exception 'nao_autorizado' using errcode = '42501';
  end if;
  return query
    select c.id, trim(c.nome_empresa)
    from public.clientes c
    where coalesce(trim(c.nome_empresa), '') <> ''
    order by public.unaccent(lower(trim(c.nome_empresa)));
end;
$$;

-- Registro idempotente de uma comissão (p_submission_id = UUID do envio)
create or replace function public.comissoes_registrar(
  p_token                 text,
  p_submission_id         text,
  p_consultora            text,
  p_cliente_id            uuid,
  p_mrr                   numeric,
  p_tipo_projeto          text,
  p_tipo_variavel         text,
  p_data_apresentacao     date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cliente_nome text;
  v_id uuid;
  v_status text;
  v_consultoras text[] := array[
    'Maria Clara','Maria Luiza','Maria Mori','Amanda Terra','Cecilia Capistrano',
    'Lara','Laís','Manuela Carvalho','Juliana','Larissa','Ana Julia'
  ];
begin
  if not private.token_valido('formulario', p_token) then
    raise exception 'nao_autorizado' using errcode = '42501';
  end if;

  if p_submission_id is null or p_submission_id !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'submission_id inválido' using errcode = '22023';
  end if;
  if p_consultora is null or not (p_consultora = any (v_consultoras)) then
    raise exception 'Consultora inválida' using errcode = '22023';
  end if;
  if p_mrr is null or p_mrr < 0 or p_mrr > 10000000 then
    raise exception 'Valor de MRR inválido' using errcode = '22023';
  end if;
  if p_tipo_projeto is null
     or not (p_tipo_projeto = any (enum_range(null::public.comissao_tipo_projeto)::text[])) then
    raise exception 'Tipo de projeto inválido' using errcode = '22023';
  end if;
  if p_tipo_variavel is null
     or not (p_tipo_variavel = any (enum_range(null::public.comissao_tipo_variavel)::text[])) then
    raise exception 'Tipo de variável inválido' using errcode = '22023';
  end if;
  if p_data_apresentacao is null
     or p_data_apresentacao < date '2020-01-01'
     or p_data_apresentacao > (now() at time zone 'America/Sao_Paulo')::date + 365 then
    raise exception 'Data da apresentação inválida' using errcode = '22023';
  end if;

  select trim(c.nome_empresa) into v_cliente_nome
  from public.clientes c where c.id = p_cliente_id;
  if v_cliente_nome is null then
    raise exception 'Cliente não encontrado' using errcode = '22023';
  end if;

  insert into public.comissoes_comerciais (
    form_response_id, consultora_nome, cliente_id, cliente_nome, mrr_vendida,
    tipo_projeto, tipo_variavel, data_apresentacao_proposta
  ) values (
    'web:' || lower(p_submission_id), p_consultora, p_cliente_id, v_cliente_nome,
    round(p_mrr, 2),
    p_tipo_projeto::public.comissao_tipo_projeto,
    p_tipo_variavel::public.comissao_tipo_variavel,
    p_data_apresentacao
  )
  on conflict (form_response_id) do nothing
  returning id into v_id;

  if v_id is null then
    select cc.id, cc.status::text into v_id, v_status
    from public.comissoes_comerciais cc
    where cc.form_response_id = 'web:' || lower(p_submission_id);
    return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true, 'status', v_status);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
end;
$$;

-- Exportação para a planilha Google (IMPORTDATA), token próprio e só leitura
create or replace function public.comissoes_exportar(p_token text)
returns table (
  id_comissao uuid,
  id_resposta text,
  registrado_em text,
  consultora text,
  cliente text,
  cliente_id uuid,
  mrr_vendida numeric,
  tipo_projeto text,
  tipo_variavel text,
  data_apresentacao_proposta date,
  status text,
  status_atualizado_por text,
  atualizado_em text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.token_valido('planilha', p_token) then
    raise exception 'nao_autorizado' using errcode = '42501';
  end if;
  return query
    select cc.id, cc.form_response_id,
           to_char(cc.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS'),
           cc.consultora_nome, cc.cliente_nome, cc.cliente_id, cc.mrr_vendida,
           cc.tipo_projeto::text, cc.tipo_variavel::text, cc.data_apresentacao_proposta,
           cc.status::text, cc.status_atualizado_por,
           to_char(cc.updated_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS')
    from public.comissoes_comerciais cc
    order by cc.created_at asc, cc.id asc;
end;
$$;

revoke all on function private.token_valido(text, text) from public, anon, authenticated;
revoke all on function public.comissoes_listar_clientes(text) from public, authenticated;
revoke all on function public.comissoes_registrar(text, text, text, uuid, numeric, text, text, date) from public, authenticated;
revoke all on function public.comissoes_exportar(text) from public, authenticated;
grant execute on function public.comissoes_listar_clientes(text) to anon;
grant execute on function public.comissoes_registrar(text, text, text, uuid, numeric, text, text, date) to anon;
grant execute on function public.comissoes_exportar(text) to anon;
