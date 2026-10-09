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
Planilha Google (aba "Respostas Comissões") — tempo real
  comissoes_comerciais (insert/update) → trigger pg_net → Apps Script (App da Web)
  └─ Apps Script → GET /api/planilha?formato=json → RPC comissoes_exportar (só leitura)
     acrescenta linhas novas e atualiza status; nunca apaga (acionador de 5 min como rede de segurança)
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

### Gerar / trocar um token

No SQL Editor do Supabase (projeto segantini-cadastro):

```sql
select private.gerar_token('formulario');  -- copie para FORM_TOKEN na Vercel e faça redeploy
select private.gerar_token('planilha');    -- copie para a propriedade PLANILHA_TOKEN do Apps Script
```

O valor aparece só nessa consulta; o banco guarda apenas o hash. Rodar de novo
invalida o token anterior.

## Planilha em tempo real (instalação única)

1. Planilha **Dados Clientes** → **Extensões → Apps Script** → cole `apps-script/SincronizarComissoes.gs`.
2. ⚙ **Configurações do projeto** → **Propriedades do script** → `PLANILHA_TOKEN` = token da planilha.
3. Rode a função **`instalar`** e autorize (cria o acionador de 5 min e sincroniza).
4. **Implantar → Nova implantação → App da Web** (Executar como: *Eu*; Acesso: *Qualquer pessoa*) → copie a URL `/exec`.
5. No SQL Editor do Supabase: `select private.definir_webhook_planilha('<URL /exec>');`

## Idempotência

O navegador gera um UUID por preenchimento e o reenvia em caso de nova tentativa.
`form_response_id` é `unique` e a RPC usa `on conflict do nothing`: um mesmo
envio nunca gera duas comissões.

## Variáveis de ambiente (Vercel)

Ver `.env.example`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FORM_TOKEN`.

## Banco

Migração em `supabase/migrations/20261009_comissoes_formulario_rpc.sql`
(já aplicada no projeto `segantini-cadastro`).
