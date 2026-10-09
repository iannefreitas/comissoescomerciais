# Registro de Comissões Comerciais — Segantini

Formulário web (Vercel) usado pela equipe comercial para registrar comissões.
Cada envio é gravado no Supabase **segantini-cadastro** (tabela
`comissoes_comerciais`), aparece na hora na aba **Comissões Comerciais** do
sistema de CS e é espelhado numa aba da planilha Google.

## Fluxo

```
Formulário (Vercel, public/index.html)
  └─ GET  /api/opcoes   → RPC comissoes_listar_clientes  (clientes ao vivo do Supabase)
  └─ POST /api/enviar   → RPC comissoes_registrar        (valida + grava, idempotente)
                              └─ public.comissoes_comerciais  ← sistema de CS lê daqui
Planilha Google (aba "Respostas Comissões")
  └─ =IMPORTDATA(/api/planilha?token=…) → RPC comissoes_exportar (só leitura)
```

## Campos

| Campo | Tipo | Armazenado em |
|---|---|---|
| Nome da consultora | lista fixa (11 consultoras) | `consultora_nome` |
| Nome do cliente | lista vinda de `clientes` (id + nome) | `cliente_id` + `cliente_nome` |
| Valor da MRR vendida | número ≥ 0, aceita `2.500,00` | `mrr_vendida` (numeric, 2 casas) |
| Tipo de projeto | enum `comissao_tipo_projeto` | `tipo_projeto` |
| Tipo de variável | enum `comissao_tipo_variavel` | `tipo_variavel` |
| Data da apresentação da proposta | data (`yyyy-mm-dd`, sem fuso) | `data_apresentacao_proposta` (date) |

Gerados automaticamente: `id`, `form_response_id` (`web:<uuid do envio>`),
`created_at`, `updated_at`, `status` (padrão **Em revisão**).

## Segurança

- O navegador nunca recebe chave do Supabase: só as funções em `/api` falam com o banco.
- As funções usam a chave **publishable** + um token de integração (`FORM_TOKEN`)
  guardado nas variáveis de ambiente da Vercel. O banco guarda apenas o SHA-256
  do token em `private.integracao_tokens` (schema não exposto pela API).
- As RPCs são `security definer` com `search_path` vazio, validam todos os campos
  e só permitem: listar id/nome de clientes, inserir comissão, exportar comissões.
- A planilha usa um token separado (`planilha`), apenas de leitura.
- A `service_role` não é usada em nenhum lugar deste projeto.

### Trocar um token

```bash
openssl rand -hex 32            # novo token
printf %s "<token>" | sha256sum # hash para o banco
```
```sql
update private.integracao_tokens set token_hash = '<hash>' where nome = 'formulario'; -- ou 'planilha'
```
Depois atualize `FORM_TOKEN` na Vercel (e redeploy) ou a URL da fórmula na planilha.

## Idempotência

O navegador gera um UUID por preenchimento e o reenvia em caso de nova tentativa.
`form_response_id` é `unique` e a RPC usa `on conflict do nothing`: um mesmo
envio nunca gera duas comissões.

## Variáveis de ambiente (Vercel)

Ver `.env.example`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FORM_TOKEN`.

## Banco

Migração em `supabase/migrations/20261009_comissoes_formulario_rpc.sql`
(já aplicada no projeto `segantini-cadastro`).
