/**
 * Vistoria Elétrica – servidor de arquivos da equipe (Google Apps Script)
 *
 * Recebe do app as fotos, os áudios, o relatório .docx e o arquivo de dados e grava tudo numa pasta central
 * do Google Drive desta conta: "Vistorias Elétricas (equipe)" › uma pasta por vistoria.
 * Quem pode enviar: só quem está logado no app com um e-mail da lista da equipe no Firebase
 * (Firestore › acesso › equipe › emails). Não há senha nem chave neste código.
 *
 * Publicar: Implantar › Nova implantação › App da Web › Executar como: Eu › Quem pode acessar: Qualquer pessoa.
 */
const PROJETO = 'vistoria-eletrica';           // ID do projeto Firebase
const RAIZ_NOME = 'Vistorias Elétricas (equipe)';
const VERSAO = 3;

function doGet() { return saida({ ok: true, app: 'vistoria-eletrica', versao: VERSAO }); }

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const usuario = autenticar(d.idToken);
    const acao = ACOES[d.acao];
    if (!acao) throw erro('ação desconhecida: ' + d.acao);
    return saida(Object.assign({ ok: true }, acao(d, usuario)));
  } catch (err) {
    return saida({ ok: false, erro: String((err && err.message) || err), codigo: (err && err.codigo) || '' });
  }
}

function saida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function erro(msg, codigo) { const e = new Error(msg); e.codigo = codigo || ''; return e; }

/* O login do app é do Firebase. O Firestore só aceita a leitura da lista da equipe com um login válido deste projeto;
   aceito o login, o e-mail é conferido contra a lista. O resultado fica guardado por até 50 minutos. */
function autenticar(tok) {
  if (!tok) throw erro('entre na equipe no app para enviar ao Drive', 'auth');
  const cache = CacheService.getScriptCache();
  const chave = 't' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok)).slice(0, 40);
  const guardado = cache.get(chave);
  if (guardado) return JSON.parse(guardado);
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJETO + '/databases/(default)/documents/acesso/equipe',
    { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw erro('login da equipe expirado ou inválido; abra o app com internet', 'auth');
  const lista = (((JSON.parse(r.getContentText()).fields || {}).emails || {}).arrayValue || {}).values || [];
  const emails = lista.map(function (x) { return String(x.stringValue || '').trim().toLowerCase(); });
  const p = lerToken(tok);
  const email = String(p.email || '').toLowerCase();
  if (!email || p.email_verified !== true || emails.indexOf(email) < 0) throw erro('o e-mail ' + email + ' não está na lista da equipe', 'acesso');
  const u = { email: email, nome: p.name || email };
  const seg = Math.max(60, Math.min(3000, (p.exp || 0) - Math.floor(Date.now() / 1000) - 60));
  cache.put(chave, JSON.stringify(u), seg);
  return u;
}
function lerToken(tok) {
  let s = String(tok).split('.')[1] || '';
  while (s.length % 4) s += '=';
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString());
}

const ACOES = {
  quem: function (d, u) { return { email: u.email, versao: VERSAO }; },
  pasta: function (d) { const f = pastaVistoria(d.vid, d.nome); return { id: f.getId(), url: f.getUrl() }; },
  /* d: vid, nomePasta, nome, mime, base64, descricao; chave (opcional): substitui o arquivo anterior com a mesma chave (relatório, dados) */
  enviar: function (d, u) {
    const pasta = pastaVistoria(d.vid, d.nomePasta);
    const blob = Utilities.newBlob(Utilities.base64Decode(d.base64 || ''), d.mime || 'application/octet-stream', String(d.nome || 'arquivo').slice(0, 200));
    const props = PropertiesService.getScriptProperties();
    const k = d.chave ? 'k_' + d.vid + '_' + d.chave : '';
    let antigo = null;
    if (k) { const id = props.getProperty(k); if (id) { try { antigo = DriveApp.getFileById(id); } catch (e) { antigo = null; } } }
    const f = pasta.createFile(blob);
    f.setDescription(String((d.mid ? '[m:' + d.mid + '] ' : '') + (d.descricao || '') + ' — enviado por ' + u.email).slice(0, 1000));
    if (antigo) { try { antigo.setTrashed(true); } catch (e) { } }
    if (k) props.setProperty(k, f.getId());
    return { id: f.getId(), size: f.getSize() };
  },
  /* Foto ou áudio excluído no app sai da pasta (vai para a lixeira do Drive, recuperável por 30 dias).
     d.manter: {id da foto/áudio: nome atual}; d.lixo: ids de arquivos do Drive excluídos neste aparelho;
     d.mapa: {id da foto/áudio: id do arquivo} enviados por este aparelho (marca arquivos antigos, sem a marca [m:]).
     Arquivo marcado que não está em "manter" vai para a lixeira, se tiver mais de 10 minutos (evita apagar o que um
     colega acabou de enviar e ainda não chegou a este aparelho). Nomes são acertados quando a numeração muda. */
  limpar: function (d) {
    if (!d.vid || typeof d.manter !== 'object' || d.manter === null) throw erro('pedido de limpeza incompleto');
    const pid = PropertiesService.getScriptProperties().getProperty('p_' + d.vid);
    if (!pid) return { semPasta: true };
    let pasta = null; try { pasta = DriveApp.getFolderById(pid); } catch (e) { pasta = null; }
    if (!pasta || pasta.isTrashed()) return { semPasta: true };
    const manter = d.manter, mapa = d.mapa || {}, lixo = d.lixo || [];
    const vazia = Object.keys(manter).length === 0;
    if (vazia && d.vazia !== true) return { ignorado: true };
    const naPasta = function (f) { const ps = f.getParents(); while (ps.hasNext()) { if (ps.next().getId() === pid) return true; } return false; };
    let lix = 0, ren = 0, marc = 0, adiados = 0;
    lixo.forEach(function (fid) { try { const f = DriveApp.getFileById(fid); if (!f.isTrashed() && naPasta(f)) { f.setTrashed(true); lix++; } } catch (e) { } });
    Object.keys(mapa).forEach(function (mid) {
      try { const f = DriveApp.getFileById(mapa[mid]); const ds = f.getDescription() || '';
        if (!f.isTrashed() && naPasta(f) && !/^\[m:/.test(ds)) { f.setDescription(('[m:' + mid + '] ' + ds).slice(0, 1000)); marc++; } } catch (e) { }
    });
    const limite = Date.now() - 10 * 60 * 1000;
    const it = pasta.getFiles();
    while (it.hasNext()) {
      const f = it.next(); const m = /^\[m:([^\]]+)\]/.exec(f.getDescription() || ''); if (!m) continue;
      const mid = m[1];
      if (!Object.prototype.hasOwnProperty.call(manter, mid)) {
        if (f.getDateCreated().getTime() < limite) { f.setTrashed(true); lix++; } else adiados++;
      } else {
        const nome = String(manter[mid] || '').slice(0, 200);
        if (nome && f.getName() !== nome) { f.setName(nome); ren++; }
      }
    }
    return { lixeira: lix, renomeados: ren, marcados: marc, adiados: adiados };
  },
  info: function (d) {
    try { const f = DriveApp.getFileById(d.id); return { size: f.getSize(), trashed: f.isTrashed() }; }
    catch (e) { return { size: 0, trashed: true }; }
  },
  /* vistoria excluída no app: a pasta dela vai para "Excluídas", dentro da pasta da equipe (dá para recuperar de lá) */
  excluir: function (d, u) {
    if (!d.vid) throw erro('vistoria sem identificação');
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('p_' + d.vid);
    if (!id) return { movida: false };
    let f = null; try { f = DriveApp.getFolderById(id); } catch (e) { f = null; }
    if (!f || f.isTrashed()) return { movida: false };
    const r = raiz(); const it = r.getFoldersByName('Excluídas');
    const destino = it.hasNext() ? it.next() : r.createFolder('Excluídas');
    f.moveTo(destino);
    f.setDescription(String('Excluída no app por ' + u.email + ' em ' + new Date().toLocaleString('pt-BR')).slice(0, 1000));
    return { movida: true };
  },
  baixar: function (d) {
    const f = DriveApp.getFileById(d.id);
    if (f.getSize() > 25 * 1024 * 1024) throw erro('arquivo grande demais para baixar pelo app');
    return { mime: f.getMimeType(), base64: Utilities.base64Encode(f.getBlob().getBytes()) };
  }
};

function raiz() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('raiz');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const it = DriveApp.getRootFolder().getFoldersByName(RAIZ_NOME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(RAIZ_NOME);
  props.setProperty('raiz', f.getId());
  return f;
}
/* uma pasta por vistoria, achada pelo id da vistoria (o nome acompanha a escola e a data) */
function pastaVistoria(vid, nome) {
  if (!vid) throw erro('vistoria sem identificação');
  nome = String(nome || vid).slice(0, 120);
  const props = PropertiesService.getScriptProperties();
  const k = 'p_' + vid;
  const achar = function () { const id = props.getProperty(k); if (!id) return null; try { const f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; } };
  let f = achar();
  if (!f) {
    const trava = LockService.getScriptLock(); trava.waitLock(20000);
    try { f = achar(); if (!f) { f = raiz().createFolder(nome); props.setProperty(k, f.getId()); } } finally { trava.releaseLock(); }
  } else if (f.getName() !== nome) f.setName(nome);
  return f;
}

/* Rode uma vez pelo editor (botão Executar) para autorizar o acesso ao Drive e criar a pasta central. */
function preparar() { const f = raiz(); Logger.log('Pasta central: ' + f.getUrl()); }
