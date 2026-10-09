-- Planilha em tempo real: a cada comissão nova ou alterada, o banco avisa
-- (via pg_net, assíncrono) o Apps Script publicado como App da Web, que
-- sincroniza a aba "Respostas Comissões". Ver apps-script/SincronizarComissoes.gs

create extension if not exists pg_net with schema extensions;

create table if not exists private.integracao_config (
  chave      text primary key,
  valor      text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.integracao_config from public, anon, authenticated;

-- Uso (SQL Editor): select private.definir_webhook_planilha('https://script.google.com/macros/s/.../exec');
create or replace function private.definir_webhook_planilha(p_url text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'URL inválida: use a URL do App da Web do Apps Script (termina em /exec)';
  end if;
  insert into private.integracao_config (chave, valor) values ('webhook_planilha', p_url)
  on conflict (chave) do update set valor = excluded.valor, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function private.definir_webhook_planilha(text) from public, anon, authenticated;

-- Nunca bloqueia nem desfaz a gravação: falha no aviso vira só um warning.
create or replace function private.avisar_planilha_comissoes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select valor into v_url from private.integracao_config where chave = 'webhook_planilha';
  if v_url is not null then
    begin
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('evento', tg_op, 'id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'aviso para a planilha falhou: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.avisar_planilha_comissoes() from public, anon, authenticated;

create trigger trg_comissoes_avisar_planilha
after insert or update on public.comissoes_comerciais
for each row execute function private.avisar_planilha_comissoes();
