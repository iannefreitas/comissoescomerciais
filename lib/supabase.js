// Chamada às RPCs do Supabase (projeto segantini-cadastro), sempre do lado
// do servidor. Usa só a chave publishable + o token de integração guardado
// nas variáveis de ambiente da Vercel; nenhuma credencial vai ao navegador.

export class RpcError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function rpc(nome, params) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new RpcError("Supabase não configurado", 500, "config");

  const resp = await fetch(`${url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(params),
  });

  const texto = await resp.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = null;
  }

  if (!resp.ok) {
    const code = corpo?.code ?? "";
    // 22023 = erro de validação levantado pela própria RPC
    if (code === "22023") throw new RpcError(corpo.message, 400, code);
    if (code === "42501") throw new RpcError("Não autorizado", 401, code);
    console.error(`RPC ${nome} falhou`, resp.status, texto.slice(0, 500));
    throw new RpcError("Falha ao comunicar com o banco de dados", 502, code);
  }
  return corpo;
}
