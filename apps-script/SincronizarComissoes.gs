/**
 * Sincronização em tempo real: Supabase -> aba "Respostas Comissões"
 * Planilha: Dados Clientes
 *
 * Como funciona
 *  - Cada comissão nova (ou mudança de status) no Supabase dispara um
 *    aviso (pg_net) para este script publicado como App da Web -> doPost.
 *  - doPost busca as comissões em /api/planilha (Vercel) e:
 *      * ACRESCENTA as que ainda não estão na aba (nunca sobrescreve);
 *      * ATUALIZA só as colunas de status (K:M) das que já estão.
 *    Linhas nunca são apagadas: a aba é o histórico.
 *  - Um acionador a cada 5 minutos repete a sincronização como rede de
 *    segurança, caso algum aviso se perca.
 *
 * Instalação (uma vez) — ver README, seção "Planilha em tempo real".
 */

const PLANILHA_ID = '1H2pR9J8DZ5iCZmtx3Eg8JIRtHTxAuyHbaS6zD3DZ8m4';
const ABA = 'Respostas Comissões';
const URL_EXPORTACAO = 'https://comissoes-comerciais.vercel.app/api/planilha';

const CABECALHO = [
  'ID da comissão', 'ID da resposta', 'Data/hora do registro', 'Consultora',
  'Cliente', 'ID do cliente', 'MRR vendida (R$)', 'Tipo de projeto',
  'Tipo de variável', 'Data da apresentação da proposta', 'Status',
  'Status atualizado por', 'Última atualização',
];
const COL_STATUS = 11; // K: Status, L: atualizado por, M: última atualização

function doPost() {
  sincronizar();
  return ContentService.createTextOutput('ok');
}

function doGet() {
  sincronizar();
  return ContentService.createTextOutput('ok');
}

function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const token = PropertiesService.getScriptProperties().getProperty('PLANILHA_TOKEN');
    if (!token) throw new Error('Defina PLANILHA_TOKEN em Configurações do projeto > Propriedades do script.');

    const resp = UrlFetchApp.fetch(
      URL_EXPORTACAO + '?formato=json&token=' + encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) {
      throw new Error('Exportação falhou: HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText().slice(0, 200));
    }
    const comissoes = JSON.parse(resp.getContentText()).linhas || [];

    const aba = obterAba_();
    const ultima = aba.getLastRow();
    const qtd = Math.max(ultima - 1, 0);

    const posicao = new Map();
    let statusAtuais = [];
    if (qtd > 0) {
      aba.getRange(2, 1, qtd, 1).getValues().forEach(function (r, i) {
        if (r[0]) posicao.set(String(r[0]), i);
      });
      statusAtuais = aba.getRange(2, COL_STATUS, qtd, 3).getDisplayValues();
    }

    const novas = [];
    let statusMudou = false;
    comissoes.forEach(function (c) {
      const linha = montarLinha_(c);
      const i = posicao.get(String(c.id_comissao));
      if (i === -1) return;
      if (i === undefined) {
        novas.push(linha);
        posicao.set(String(c.id_comissao), -1);
        return;
      }
      const novo = linha.slice(COL_STATUS - 1);
      const atual = statusAtuais[i];
      if (atual[0] !== novo[0] || atual[1] !== novo[1] || normalizarData_(atual[2]) !== normalizarData_(novo[2])) {
        statusAtuais[i] = novo;
        statusMudou = true;
      }
    });

    if (statusMudou) aba.getRange(2, COL_STATUS, qtd, 3).setValues(statusAtuais);
    if (novas.length) {
      aba.getRange(ultima + 1, 1, novas.length, CABECALHO.length).setValues(novas);
    }
    if (statusMudou || novas.length) formatar_(aba);
  } finally {
    lock.releaseLock();
  }
}

/** Rode UMA vez: cria o acionador de segurança (5 min) e sincroniza. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  sincronizar();
}

function obterAba_() {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  let aba = ss.getSheetByName(ABA);
  if (!aba) aba = ss.insertSheet(ABA);
  const atual = aba.getRange(1, 1, 1, CABECALHO.length).getDisplayValues()[0];
  if (atual.join('|') !== CABECALHO.join('|')) {
    if (aba.getLastRow() > 1 && atual[0] !== '') {
      throw new Error('A linha 1 da aba "' + ABA + '" não é o cabeçalho esperado; confira antes de sincronizar.');
    }
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#CF4400');
    aba.setFrozenRows(1);
  }
  return aba;
}

function montarLinha_(c) {
  return [
    c.id_comissao,
    c.id_resposta,
    c.registrado_em || '',                 // "yyyy-MM-dd HH:mm:ss" (horário de Brasília)
    texto_(c.consultora),
    texto_(c.cliente),
    c.cliente_id || '',
    c.mrr_vendida === null ? '' : Number(c.mrr_vendida),
    c.tipo_projeto,
    c.tipo_variavel,
    dataSemFuso_(c.data_apresentacao_proposta),
    c.status,
    texto_(c.status_atualizado_por),
    c.atualizado_em || '',
  ];
}

// impede que um nome começando com = + - @ vire fórmula
function texto_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// "yyyy-MM-dd" -> Date ao meio-dia: o dia não muda em nenhum fuso horário
function dataSemFuso_(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : '';
}

function normalizarData_(v) {
  return String(v || '').replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
}

function formatar_(aba) {
  const n = aba.getLastRow() - 1;
  if (n < 1) return;
  aba.getRange(2, 3, n, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  aba.getRange(2, 7, n, 1).setNumberFormat('"R$" #,##0.00');
  aba.getRange(2, 10, n, 1).setNumberFormat('dd/mm/yyyy');
  aba.getRange(2, 13, n, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
}
