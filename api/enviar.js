// POST /api/enviar -> registra uma comissão no Supabase.
// Idempotente: o navegador gera um `submissionId` (UUID) por preenchimento
// e o reenvia em caso de nova tentativa; o banco nunca cria duas comissões
// para o mesmo id.

import { rpc, RpcError } from "../lib/supabase.js";
import { CONSULTORAS, TIPOS_PROJETO, TIPOS_VARIAVEL } from "../lib/opcoes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function validar(b) {
  const erros = [];
  if (!UUID.test(String(b.submissionId ?? ""))) erros.push("Identificador do envio inválido.");
  if (!CONSULTORAS.includes(b.consultora)) erros.push("Selecione a consultora.");
  if (!UUID.test(String(b.clienteId ?? ""))) erros.push("Selecione o cliente.");
  const mrr = typeof b.mrr === "number" ? b.mrr : Number.NaN;
  if (!Number.isFinite(mrr) || mrr < 0 || mrr > 10_000_000) {
    erros.push("Informe um valor de MRR válido (número maior ou igual a zero).");
  }
  if (!TIPOS_PROJETO.includes(b.tipoProjeto)) erros.push("Selecione o tipo de projeto.");
  if (!TIPOS_VARIAVEL.includes(b.tipoVariavel)) erros.push("Selecione o tipo de variável.");
  if (!DATA.test(String(b.dataApresentacao ?? "")) || Number.isNaN(Date.parse(b.dataApresentacao))) {
    erros.push("Informe a data da apresentação da proposta.");
  }
  return { erros, mrr };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  const { erros, mrr } = validar(body);
  if (erros.length) return res.status(400).json({ ok: false, error: erros.join(" ") });

  try {
    const resultado = await rpc("comissoes_registrar", {
      p_token: process.env.FORM_TOKEN,
      p_submission_id: body.submissionId,
      p_consultora: body.consultora,
      p_cliente_id: body.clienteId,
      p_mrr: Math.round(mrr * 100) / 100,
      p_tipo_projeto: body.tipoProjeto,
      p_tipo_variavel: body.tipoVariavel,
      p_data_apresentacao: body.dataApresentacao,
    });
    return res.status(200).json(resultado);
  } catch (err) {
    const status = err instanceof RpcError ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
}
