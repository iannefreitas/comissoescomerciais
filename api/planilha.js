// GET /api/planilha?token=...[&formato=json] -> todas as comissões, lidas
// pelo Apps Script que mantém a aba da planilha Google (JSON) ou por
// =IMPORTDATA() (CSV). Usa um token próprio, só leitura, diferente do
// token do formulário.

import { rpc, RpcError } from "../lib/supabase.js";

const COLUNAS = [
  ["id_comissao", "ID da comissão"],
  ["id_resposta", "ID da resposta"],
  ["registrado_em", "Data/hora do registro"],
  ["consultora", "Consultora"],
  ["cliente", "Cliente"],
  ["cliente_id", "ID do cliente"],
  ["mrr_vendida", "MRR vendida (R$)"],
  ["tipo_projeto", "Tipo de projeto"],
  ["tipo_variavel", "Tipo de variável"],
  ["data_apresentacao_proposta", "Data da apresentação da proposta"],
  ["status", "Status"],
  ["status_atualizado_por", "Status atualizado por"],
  ["atualizado_em", "Última atualização"],
];

function celula(valor) {
  if (valor === null || valor === undefined) return "";
  const s = String(valor);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req, res) {
  const token = String(req.query?.token ?? "");
  // vírgula decimal para planilhas em pt-BR (padrão); ?decimal=ponto para en-US
  const decimalPonto = req.query?.decimal === "ponto";

  try {
    const linhas = await rpc("comissoes_exportar", { p_token: token });

    // ?formato=json -> usado pelo Apps Script de sincronização em tempo real
    if (req.query?.formato === "json") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, colunas: COLUNAS, linhas: linhas ?? [] });
    }

    const csv = [COLUNAS.map(([, titulo]) => celula(titulo)).join(",")];
    for (const l of linhas ?? []) {
      csv.push(
        COLUNAS.map(([k]) => {
          let v = l[k];
          if (k === "mrr_vendida" && v !== null) {
            v = Number(v).toFixed(2);
            if (!decimalPonto) v = v.replace(".", ",");
          }
          return celula(v);
        }).join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv.join("\r\n") + "\r\n");
  } catch (err) {
    const status = err instanceof RpcError ? err.status : 500;
    return res.status(status).send(`erro: ${err.message}`);
  }
}
