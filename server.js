import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "0.0.0.0";
const defaultProcessTypes = [
  { id: "transferencia", nome: "Transferencia", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "segunda_via_codigo_seguranca", nome: "2 via de codigo de seguranca", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "primeira_licenca", nome: "1 licenca", createdAt: "2026-01-01T00:00:00.000Z" }
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 500) console.error(error);
    sendJson(res, status, { error: status === 500 ? "Erro interno." : error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Despachante documentos em http://${host}:${port}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const store = await readStore();
    sendJson(res, 200, { ...store, summary: buildSummary(store) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/clients") {
    const store = await readStore();
    const client = normalizeClient(await readJson(req));
    if (store.clients.some((item) => item.placa === client.placa)) {
      throw new HttpError(400, "Ja existe cliente com esta placa.");
    }
    store.clients.push({ ...client, createdAt: now(), updatedAt: now() });
    await writeStore(store);
    sendJson(res, 201, { client });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/process-types") {
    const store = await readStore();
    const processType = normalizeProcessType(await readJson(req), store);
    store.processTypes.push(processType);
    await writeStore(store);
    sendJson(res, 201, { processType });
    return;
  }

  const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch) {
    const plate = normalizePlate(decodeURIComponent(clientMatch[1]));
    const store = await readStore();
    const index = store.clients.findIndex((client) => client.placa === plate);
    if (index === -1) throw new HttpError(404, "Cliente nao encontrado.");

    if (req.method === "PUT") {
      const client = normalizeClient(await readJson(req));
      if (client.placa !== plate && store.clients.some((item) => item.placa === client.placa)) {
        throw new HttpError(400, "Ja existe cliente com esta nova placa.");
      }
      const previous = store.clients[index];
      store.clients[index] = { ...previous, ...client, updatedAt: now() };
      if (client.placa !== plate) {
        store.documents.forEach((documentRecord) => {
          if (documentRecord.placa === plate) documentRecord.placa = client.placa;
        });
      }
      await writeStore(store);
      sendJson(res, 200, { client: store.clients[index] });
      return;
    }

    if (req.method === "DELETE") {
      if (store.documents.some((documentRecord) => documentRecord.placa === plate)) {
        throw new HttpError(400, "Este cliente possui processos cadastrados.");
      }
      store.clients.splice(index, 1);
      await writeStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/documents") {
    const store = await readStore();
    const documentRecord = normalizeDocument(await readJson(req), store);
    store.documents.unshift(documentRecord);
    await writeStore(store);
    sendJson(res, 201, { document: documentRecord });
    return;
  }

  const documentMatch = url.pathname.match(/^\/api\/documents\/([a-zA-Z0-9-]+)$/);
  if (documentMatch) {
    const store = await readStore();
    const index = store.documents.findIndex((documentRecord) => documentRecord.idDocumento === documentMatch[1]);
    if (index === -1) throw new HttpError(404, "Processo nao encontrado.");

    if (req.method === "PUT") {
      const next = normalizeDocument(await readJson(req), store, store.documents[index]);
      store.documents[index] = next;
      await writeStore(store);
      sendJson(res, 200, { document: next });
      return;
    }

    if (req.method === "DELETE") {
      store.documents.splice(index, 1);
      await writeStore(store);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { error: "Rota nao encontrada." });
}

function normalizeClient(input) {
  const placa = normalizePlate(input.placa);
  const nome = String(input.nome || "").trim().replace(/\s+/g, " ");
  const telefone = normalizePhone(input.telefone);
  const cpf = normalizeCpf(input.cpf);

  if (nome.length < 2) throw new HttpError(400, "Informe o nome do cliente.");
  if (!telefone) throw new HttpError(400, "Informe o telefone do cliente.");
  if (!cpf) throw new HttpError(400, "Informe um CPF com 11 numeros.");

  return { placa, nome: nome.slice(0, 120), telefone, cpf };
}

function normalizeDocument(input, store, existing = null) {
  const placa = normalizePlate(input.placa);
  if (!store.clients.some((client) => client.placa === placa)) {
    throw new HttpError(400, "Cliente nao encontrado para esta placa.");
  }

  const tipoProcessoId = String(input.tipoProcessoId || "").trim();
  if (!store.processTypes.some((type) => type.id === tipoProcessoId)) {
    throw new HttpError(400, "Escolha o tipo de processo.");
  }

  const valorRecebido = parseMoney(input.valorRecebido);
  const valorGasto = parseMoney(input.valorGasto);
  if (valorRecebido < 0 || valorGasto < 0) throw new HttpError(400, "Valores nao podem ser negativos.");

  return {
    idDocumento: existing?.idDocumento || crypto.randomUUID(),
    placa,
    tipoProcessoId,
    valorRecebido,
    valorGasto,
    lucro: roundMoney(valorRecebido - valorGasto),
    recebido: Boolean(input.recebido),
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };
}

function normalizeProcessType(input, store) {
  const nome = String(input.nome || "").trim().replace(/\s+/g, " ");
  if (nome.length < 2) throw new HttpError(400, "Informe o nome do tipo de processo.");

  const id = slugify(nome);
  if (!id) throw new HttpError(400, "Informe um tipo de processo valido.");
  if (store.processTypes.some((type) => type.id === id)) {
    throw new HttpError(400, "Este tipo de processo ja existe.");
  }

  return { id, nome: nome.slice(0, 90), createdAt: now() };
}

function normalizePlate(value) {
  const placa = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^([A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/.test(placa)) {
    throw new HttpError(400, "Informe uma placa no formato ABC1234 ou ABC1D23.");
  }
  return placa;
}

function normalizeCpf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return "";
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return "";
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return "";
}

function parseMoney(value) {
  if (typeof value === "number") return roundMoney(value);
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const clean = raw.replace(/[^\d,.-]/g, "");
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new HttpError(400, "Informe um valor valido.");
  return roundMoney(number);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildSummary(store) {
  const totalRecebido = store.documents
    .filter((documentRecord) => documentRecord.recebido)
    .reduce((total, documentRecord) => total + documentRecord.valorRecebido, 0);
  const totalAReceber = store.documents
    .filter((documentRecord) => !documentRecord.recebido)
    .reduce((total, documentRecord) => total + documentRecord.valorRecebido, 0);
  const totalGasto = store.documents.reduce((total, documentRecord) => total + documentRecord.valorGasto, 0);
  const lucroPrevisto = store.documents.reduce((total, documentRecord) => total + documentRecord.lucro, 0);
  const processTypeStats = store.processTypes
    .map((type) => {
      const documents = store.documents.filter((documentRecord) => documentRecord.tipoProcessoId === type.id);
      return {
        id: type.id,
        nome: type.nome,
        total: documents.length,
        lucro: roundMoney(documents.reduce((sum, documentRecord) => sum + documentRecord.lucro, 0))
      };
    })
    .filter((type) => type.total > 0)
    .sort((a, b) => b.total - a.total || b.lucro - a.lucro || a.nome.localeCompare(b.nome));

  return {
    clientes: store.clients.length,
    processos: store.documents.length,
    pendentes: store.documents.filter((documentRecord) => !documentRecord.recebido).length,
    totalRecebido: roundMoney(totalRecebido),
    totalAReceber: roundMoney(totalAReceber),
    totalGasto: roundMoney(totalGasto),
    lucroPrevisto: roundMoney(lucroPrevisto),
    lucroRealizado: roundMoney(totalRecebido - totalGasto),
    processTypeStats
  };
}

async function readStore() {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    const processTypes = mergeProcessTypes(parsed.processTypes);
    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      processTypes,
      documents: Array.isArray(parsed.documents) ? parsed.documents.map((item) => cleanStoredDocument(item, processTypes)) : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { clients: [], processTypes: defaultProcessTypes, documents: [] };
  }
}

async function writeStore(store) {
  await fs.mkdir(dataDir, { recursive: true });
  const ordered = {
    clients: [...store.clients].sort((a, b) => a.nome.localeCompare(b.nome) || a.placa.localeCompare(b.placa)),
    processTypes: mergeProcessTypes(store.processTypes),
    documents: [...store.documents].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  };
  await fs.writeFile(dataFile, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

function mergeProcessTypes(processTypes = []) {
  const byId = new Map(defaultProcessTypes.map((type) => [type.id, type]));
  if (Array.isArray(processTypes)) {
    processTypes.forEach((type) => {
      if (!type?.id || !type?.nome) return;
      byId.set(type.id, {
        id: String(type.id).slice(0, 70),
        nome: String(type.nome).slice(0, 90),
        createdAt: type.createdAt || now()
      });
    });
  }
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function cleanStoredDocument(documentRecord, processTypes) {
  const valorRecebido = roundMoney(documentRecord.valorRecebido);
  const valorGasto = roundMoney(documentRecord.valorGasto);
  const requestedType = String(documentRecord.tipoProcessoId || "");
  const tipoProcessoId = processTypes.some((type) => type.id === requestedType)
    ? requestedType
    : "";
  return {
    ...documentRecord,
    tipoProcessoId,
    valorRecebido,
    valorGasto,
    lucro: roundMoney(valorRecebido - valorGasto),
    recebido: Boolean(documentRecord.recebido)
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "Conteudo muito grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON invalido.");
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, decodeURIComponent(requested)));
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendText(res, 403, "Acesso negado.");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fs.readFile(path.join(publicDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(index);
      return;
    }
    throw error;
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

function now() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
