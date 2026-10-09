// GET /api/opcoes -> opções de todos os campos do formulário.
// A lista de clientes vem ao vivo da tabela `clientes` do Supabase a cada
// carregamento da página: novo cliente cadastrado aparece na hora, sem
// editar o formulário.

import { rpc, RpcError } from "../lib/supabase.js";
import { CONSULTORAS, TIPOS_PROJETO, TIPOS_VARIAVEL } from "../lib/opcoes.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Método não permitido" });
  }

  try {
    const linhas = await rpc("comissoes_listar_clientes", {
      p_token: process.env.FORM_TOKEN,
    });

    // um item por id; se dois clientes tiverem o mesmo nome, o rótulo
    // ganha um sufixo para que a consultora saiba qual está escolhendo
    const vistos = new Map();
    for (const { id, nome } of linhas ?? []) {
      if (!vistos.has(id)) vistos.set(id, nome);
    }
    const contagem = {};
    for (const nome of vistos.values()) {
      const k = nome.toLocaleLowerCase("pt-BR");
      contagem[k] = (contagem[k] ?? 0) + 1;
    }
    const clientes = [...vistos].map(([id, nome]) => ({
      id,
      nome:
        contagem[nome.toLocaleLowerCase("pt-BR")] > 1
          ? `${nome} (${id.slice(0, 8)})`
          : nome,
    }));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      consultoras: CONSULTORAS,
      clientes,
      tiposProjeto: TIPOS_PROJETO,
      tiposVariavel: TIPOS_VARIAVEL,
    });
  } catch (err) {
    const status = err instanceof RpcError ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
}
