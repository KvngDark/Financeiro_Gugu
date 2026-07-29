import http from "node:http";
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile();

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

let poolPromise;
let schemaReady = false;

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
  const storage = hasDatabaseConfig() ? "TiDB" : "arquivo local";
  console.log(`Despachante documentos em http://${host}:${port} usando ${storage}.`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, storage: hasDatabaseConfig() ? "tidb" : "local-json" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const store = await readStore();
    sendJson(res, 200, {
      config: {
        storage: hasDatabaseConfig() ? "tidb" : "local-json",
        databaseConfigured: hasDatabaseConfig()
      },
      ...store,
      summary: buildSummary(store)
    });
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
  if (hasDatabaseConfig()) return readDatabaseStore();
  return readLocalStore();
}

async function writeStore(store) {
  if (hasDatabaseConfig()) {
    await writeDatabaseStore(store);
    return;
  }
  await writeLocalStore(store);
}

async function readLocalStore() {
  try {
    const raw = await fsp.readFile(dataFile, "utf8");
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

async function writeLocalStore(store) {
  await fsp.mkdir(dataDir, { recursive: true });
  const ordered = {
    clients: [...store.clients].sort((a, b) => a.nome.localeCompare(b.nome) || a.placa.localeCompare(b.placa)),
    processTypes: mergeProcessTypes(store.processTypes),
    documents: [...store.documents].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  };
  await fsp.writeFile(dataFile, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

async function readDatabaseStore() {
  const pool = await getPool();
  const [clientRows] = await pool.query(`
    SELECT
      placa,
      nome,
      telefone,
      cpf,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt
    FROM dispatch_clients
    ORDER BY nome ASC, placa ASC
  `);
  const [typeRows] = await pool.query(`
    SELECT
      id,
      nome,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') AS createdAt
    FROM dispatch_process_types
    ORDER BY created_at ASC, nome ASC
  `);
  const processTypes = mergeProcessTypes(typeRows.map(mapProcessTypeRow));
  const [documentRows] = await pool.query(`
    SELECT
      id_documento AS idDocumento,
      placa,
      tipo_processo_id AS tipoProcessoId,
      valor_recebido AS valorRecebido,
      valor_gasto AS valorGasto,
      lucro,
      recebido,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.000Z') AS createdAt,
      DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt
    FROM dispatch_documents
    ORDER BY created_at DESC
  `);

  return {
    clients: clientRows.map(mapClientRow),
    processTypes,
    documents: documentRows.map((row) => cleanStoredDocument(mapDocumentRow(row), processTypes))
  };
}

async function writeDatabaseStore(store) {
  const pool = await getPool();
  const ordered = orderStoreForWrite(store);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM dispatch_documents");
    await connection.execute("DELETE FROM dispatch_process_types");
    await connection.execute("DELETE FROM dispatch_clients");

    for (const client of ordered.clients) {
      await connection.execute(
        `
          INSERT INTO dispatch_clients
            (placa, nome, telefone, cpf, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          client.placa,
          client.nome,
          client.telefone,
          client.cpf,
          toMysqlDateTime(client.createdAt),
          toMysqlDateTime(client.updatedAt || client.createdAt)
        ]
      );
    }

    for (const processType of ordered.processTypes) {
      await connection.execute(
        "INSERT INTO dispatch_process_types (id, nome, created_at) VALUES (?, ?, ?)",
        [processType.id, processType.nome, toMysqlDateTime(processType.createdAt)]
      );
    }

    for (const documentRecord of ordered.documents) {
      await connection.execute(
        `
          INSERT INTO dispatch_documents
            (id_documento, placa, tipo_processo_id, valor_recebido, valor_gasto, recebido, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          documentRecord.idDocumento,
          documentRecord.placa,
          documentRecord.tipoProcessoId,
          documentRecord.valorRecebido,
          documentRecord.valorGasto,
          documentRecord.recebido ? 1 : 0,
          toMysqlDateTime(documentRecord.createdAt),
          toMysqlDateTime(documentRecord.updatedAt || documentRecord.createdAt)
        ]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function orderStoreForWrite(store) {
  const processTypes = mergeProcessTypes(store.processTypes);
  return {
    clients: [...store.clients].sort((a, b) => a.nome.localeCompare(b.nome) || a.placa.localeCompare(b.placa)),
    processTypes,
    documents: [...store.documents]
      .map((documentRecord) => cleanStoredDocument(documentRecord, processTypes))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  };
}

function mapClientRow(row) {
  return {
    placa: row.placa,
    nome: row.nome,
    telefone: row.telefone,
    cpf: row.cpf,
    createdAt: row.createdAt || now(),
    updatedAt: row.updatedAt || row.createdAt || now()
  };
}

function mapProcessTypeRow(row) {
  return {
    id: row.id,
    nome: row.nome,
    createdAt: row.createdAt || now()
  };
}

function mapDocumentRow(row) {
  return {
    idDocumento: row.idDocumento,
    placa: row.placa,
    tipoProcessoId: row.tipoProcessoId,
    valorRecebido: Number(row.valorRecebido || 0),
    valorGasto: Number(row.valorGasto || 0),
    lucro: Number(row.lucro || 0),
    recebido: Boolean(row.recebido),
    createdAt: row.createdAt || now(),
    updatedAt: row.updatedAt || row.createdAt || now()
  };
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

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      let mysql;
      try {
        mysql = await import("mysql2/promise");
      } catch {
        throw new HttpError(500, "O pacote mysql2 nao esta instalado. Rode npm install antes de usar o TiDB.");
      }

      const pool = mysql.createPool(await buildMysqlConfig());
      if (!schemaReady && shouldAutoCreateSchema()) {
        await ensureSchema(pool);
        schemaReady = true;
      }
      return pool;
    })();
  }
  return poolPromise;
}

async function buildMysqlConfig() {
  const base = process.env.DATABASE_URL ? configFromDatabaseUrl() : configFromTidbEnv();
  const ssl = await getSslConfig();

  return {
    ...base,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 8),
    queueLimit: 0,
    decimalNumbers: true,
    dateStrings: true,
    ...(ssl ? { ssl } : {})
  };
}

function configFromDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, ""))
  };
}

function configFromTidbEnv() {
  return {
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE
  };
}

async function getSslConfig() {
  if (String(process.env.TIDB_SSL || "true").toLowerCase() === "false") return null;

  const ssl = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: String(process.env.TIDB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false"
  };

  if (process.env.TIDB_CA_CERT) {
    ssl.ca = await fsp.readFile(process.env.TIDB_CA_CERT, "utf8");
  }

  return ssl;
}

async function ensureSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dispatch_clients (
      placa VARCHAR(7) PRIMARY KEY,
      nome VARCHAR(120) NOT NULL,
      telefone VARCHAR(15) NOT NULL,
      cpf VARCHAR(14) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dispatch_clients_cpf (cpf),
      INDEX idx_dispatch_clients_nome (nome)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dispatch_process_types (
      id VARCHAR(70) PRIMARY KEY,
      nome VARCHAR(90) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_dispatch_process_types_nome (nome)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dispatch_documents (
      id_documento VARCHAR(36) PRIMARY KEY,
      placa VARCHAR(7) NOT NULL,
      tipo_processo_id VARCHAR(70) NOT NULL,
      valor_recebido DECIMAL(12, 2) NOT NULL DEFAULT 0,
      valor_gasto DECIMAL(12, 2) NOT NULL DEFAULT 0,
      lucro DECIMAL(12, 2) AS (valor_recebido - valor_gasto) STORED,
      recebido TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dispatch_documents_placa (placa),
      INDEX idx_dispatch_documents_tipo (tipo_processo_id),
      INDEX idx_dispatch_documents_recebido (recebido),
      CONSTRAINT fk_dispatch_documents_client
        FOREIGN KEY (placa) REFERENCES dispatch_clients (placa),
      CONSTRAINT fk_dispatch_documents_process_type
        FOREIGN KEY (tipo_processo_id) REFERENCES dispatch_process_types (id)
    )
  `);

  await seedDefaultProcessTypes(pool);
}

async function seedDefaultProcessTypes(pool) {
  for (const processType of defaultProcessTypes) {
    await pool.execute(
      "INSERT IGNORE INTO dispatch_process_types (id, nome, created_at) VALUES (?, ?, ?)",
      [processType.id, processType.nome, toMysqlDateTime(processType.createdAt)]
    );
  }
}

function hasDatabaseConfig() {
  if (process.env.DATABASE_URL) return true;
  return Boolean(process.env.TIDB_HOST && process.env.TIDB_USER && process.env.TIDB_DATABASE);
}

function shouldAutoCreateSchema() {
  return String(process.env.TIDB_AUTO_SCHEMA || "true").toLowerCase() !== "false";
}

function toMysqlDateTime(value) {
  const date = new Date(value || now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 19).replace("T", " ");
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
    const file = await fsp.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fsp.readFile(path.join(publicDir, "index.html"));
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

function loadEnvFile() {
  const envPaths = [path.join(__dirname, ".env"), path.join(process.cwd(), ".env")];
  const loaded = new Set();

  for (const envPath of envPaths) {
    if (loaded.has(envPath) || !fsSync.existsSync(envPath)) continue;
    loaded.add(envPath);

    const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
