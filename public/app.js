const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const state = {
  clients: [],
  processTypes: [],
  documents: [],
  summary: {},
  editingClient: null,
  editingDocument: null,
  filter: "todos",
  typeFilter: "todos",
  search: "",
  saving: false
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  refreshButton: document.querySelector("#refreshButton"),
  storageBadge: document.querySelector("#storageBadge"),
  lucroPrevisto: document.querySelector("#lucroPrevisto"),
  processosResumo: document.querySelector("#processosResumo"),
  totalRecebido: document.querySelector("#totalRecebido"),
  totalAReceber: document.querySelector("#totalAReceber"),
  pendentesResumo: document.querySelector("#pendentesResumo"),
  totalGasto: document.querySelector("#totalGasto"),
  lucroRealizado: document.querySelector("#lucroRealizado"),
  clientesBadge: document.querySelector("#clientesBadge"),
  clientesResumo: document.querySelector("#clientesResumo"),
  tiposBadge: document.querySelector("#tiposBadge"),
  tiposResumo: document.querySelector("#tiposResumo"),
  recentesLista: document.querySelector("#recentesLista"),
  clienteForm: document.querySelector("#clienteForm"),
  placaInput: document.querySelector("#placaInput"),
  cpfInput: document.querySelector("#cpfInput"),
  nomeInput: document.querySelector("#nomeInput"),
  telefoneInput: document.querySelector("#telefoneInput"),
  clienteSubmit: document.querySelector("#clienteSubmit"),
  cancelClienteEdit: document.querySelector("#cancelClienteEdit"),
  clienteMessage: document.querySelector("#clienteMessage"),
  totalClientesBadge: document.querySelector("#totalClientesBadge"),
  clientesLista: document.querySelector("#clientesLista"),
  documentoForm: document.querySelector("#documentoForm"),
  clienteSelect: document.querySelector("#clienteSelect"),
  tipoProcessoSelect: document.querySelector("#tipoProcessoSelect"),
  valorRecebidoInput: document.querySelector("#valorRecebidoInput"),
  valorGastoInput: document.querySelector("#valorGastoInput"),
  recebidoInput: document.querySelector("#recebidoInput"),
  documentoSubmit: document.querySelector("#documentoSubmit"),
  cancelDocumentoEdit: document.querySelector("#cancelDocumentoEdit"),
  documentoMessage: document.querySelector("#documentoMessage"),
  tipoProcessoForm: document.querySelector("#tipoProcessoForm"),
  tipoProcessoInput: document.querySelector("#tipoProcessoInput"),
  tipoProcessoMessage: document.querySelector("#tipoProcessoMessage"),
  buscaInput: document.querySelector("#buscaInput"),
  filtroTipo: document.querySelector("#filtroTipo"),
  filtroRecebido: document.querySelector("#filtroRecebido"),
  documentosLista: document.querySelector("#documentosLista")
};

bootstrap();

async function bootstrap() {
  bindEvents();
  await refreshAll();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", refreshAll);
  els.clienteForm.addEventListener("submit", saveClient);
  els.documentoForm.addEventListener("submit", saveDocument);
  els.tipoProcessoForm.addEventListener("submit", saveProcessType);
  els.cancelClienteEdit.addEventListener("click", resetClientForm);
  els.cancelDocumentoEdit.addEventListener("click", resetDocumentForm);

  els.tabs.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  els.placaInput.addEventListener("input", () => {
    els.placaInput.value = maskPlate(els.placaInput.value);
  });

  els.cpfInput.addEventListener("input", () => {
    els.cpfInput.value = maskCpf(els.cpfInput.value);
  });

  els.telefoneInput.addEventListener("input", () => {
    els.telefoneInput.value = maskPhone(els.telefoneInput.value);
  });

  els.buscaInput.addEventListener("input", () => {
    state.search = els.buscaInput.value;
    renderDocuments();
  });

  els.filtroTipo.addEventListener("change", () => {
    state.typeFilter = els.filtroTipo.value;
    renderDocuments();
  });

  els.filtroRecebido.addEventListener("change", () => {
    state.filter = els.filtroRecebido.value;
    renderDocuments();
  });
}

async function refreshAll() {
  setMessage(els.documentoMessage, "Atualizando...");
  try {
    const payload = await fetchJson("/api/bootstrap");
    state.clients = payload.clients || [];
    state.processTypes = payload.processTypes || [];
    state.documents = payload.documents || [];
    state.summary = payload.summary || {};
    renderStorageStatus(payload.config);
    setMessage(els.documentoMessage, "");
    renderAll();
  } catch (error) {
    setMessage(els.documentoMessage, error.message || "Nao foi possivel carregar.", true);
  }
}

function renderStorageStatus(config = {}) {
  const databaseConfigured = Boolean(config.databaseConfigured);
  els.storageBadge.textContent = databaseConfigured ? "TiDB conectado" : "Modo local";
  els.storageBadge.classList.toggle("connected", databaseConfigured);
  els.storageBadge.title = databaseConfigured
    ? "Dados salvos no TiDB."
    : "Sem credenciais do TiDB, os dados ficam no arquivo local.";
}

function renderAll() {
  renderMetrics();
  renderClientSelect();
  renderProcessTypeSelects();
  renderPortfolio();
  renderProcessTypeStats();
  renderRecent();
  renderClients();
  renderDocuments();
}

function showView(viewId) {
  els.views.forEach((view) => view.classList.toggle("active", view.id === viewId));
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
}

async function saveClient(event) {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  setMessage(els.clienteMessage, "Salvando...");

  const payload = {
    placa: els.placaInput.value,
    nome: els.nomeInput.value,
    telefone: els.telefoneInput.value,
    cpf: els.cpfInput.value
  };

  try {
    const editing = Boolean(state.editingClient);
    await fetchJson(editing ? `/api/clients/${encodeURIComponent(state.editingClient)}` : "/api/clients", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    resetClientForm();
    await refreshAll();
    setMessage(els.clienteMessage, editing ? "Cliente atualizado." : "Cliente cadastrado.");
  } catch (error) {
    setMessage(els.clienteMessage, error.message || "Nao foi possivel salvar.", true);
  } finally {
    state.saving = false;
  }
}

async function saveDocument(event) {
  event.preventDefault();
  if (state.saving) return;
  if (!state.clients.length) {
    setMessage(els.documentoMessage, "Cadastre um cliente antes de criar processo.", true);
    showView("clientes");
    return;
  }

  state.saving = true;
  setMessage(els.documentoMessage, "Salvando...");

  const payload = {
    placa: els.clienteSelect.value,
    tipoProcessoId: els.tipoProcessoSelect.value,
    valorRecebido: els.valorRecebidoInput.value,
    valorGasto: els.valorGastoInput.value,
    recebido: els.recebidoInput.checked
  };

  try {
    const editing = Boolean(state.editingDocument);
    await fetchJson(editing ? `/api/documents/${state.editingDocument}` : "/api/documents", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    resetDocumentForm();
    await refreshAll();
    setMessage(els.documentoMessage, editing ? "Processo atualizado." : "Processo cadastrado.");
  } catch (error) {
    setMessage(els.documentoMessage, error.message || "Nao foi possivel salvar.", true);
  } finally {
    state.saving = false;
  }
}

async function saveProcessType(event) {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  setMessage(els.tipoProcessoMessage, "Salvando...");

  try {
    await fetchJson("/api/process-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: els.tipoProcessoInput.value })
    });
    els.tipoProcessoForm.reset();
    await refreshAll();
    setMessage(els.tipoProcessoMessage, "Tipo criado.");
  } catch (error) {
    setMessage(els.tipoProcessoMessage, error.message || "Nao foi possivel criar o tipo.", true);
  } finally {
    state.saving = false;
  }
}

function editClient(plate) {
  const client = findClient(plate);
  if (!client) return;
  state.editingClient = client.placa;
  els.placaInput.value = client.placa;
  els.cpfInput.value = client.cpf;
  els.nomeInput.value = client.nome;
  els.telefoneInput.value = client.telefone;
  els.clienteSubmit.textContent = "Salvar edicao";
  els.cancelClienteEdit.hidden = false;
  showView("clientes");
}

function editDocument(id) {
  const documentRecord = state.documents.find((item) => item.idDocumento === id);
  if (!documentRecord) return;
  state.editingDocument = id;
  els.clienteSelect.value = documentRecord.placa;
  els.tipoProcessoSelect.value = documentRecord.tipoProcessoId || "";
  els.valorRecebidoInput.value = inputMoney(documentRecord.valorRecebido);
  els.valorGastoInput.value = inputMoney(documentRecord.valorGasto);
  els.recebidoInput.checked = documentRecord.recebido;
  els.documentoSubmit.textContent = "Salvar edicao";
  els.cancelDocumentoEdit.hidden = false;
  showView("processos");
}

async function removeClient(plate) {
  const client = findClient(plate);
  if (!client || !window.confirm(`Remover ${client.nome}?`)) return;
  try {
    await fetchJson(`/api/clients/${encodeURIComponent(plate)}`, { method: "DELETE" });
    await refreshAll();
    setMessage(els.clienteMessage, "Cliente removido.");
  } catch (error) {
    setMessage(els.clienteMessage, error.message || "Nao foi possivel remover.", true);
  }
}

async function removeDocument(id) {
  if (!window.confirm("Remover este processo?")) return;
  try {
    await fetchJson(`/api/documents/${id}`, { method: "DELETE" });
    await refreshAll();
    setMessage(els.documentoMessage, "Processo removido.");
  } catch (error) {
    setMessage(els.documentoMessage, error.message || "Nao foi possivel remover.", true);
  }
}

function resetClientForm() {
  state.editingClient = null;
  els.clienteForm.reset();
  els.clienteSubmit.textContent = "Salvar cliente";
  els.cancelClienteEdit.hidden = true;
  setMessage(els.clienteMessage, "");
}

function resetDocumentForm() {
  state.editingDocument = null;
  els.documentoForm.reset();
  els.documentoSubmit.textContent = "Salvar processo";
  els.cancelDocumentoEdit.hidden = true;
  renderClientSelect();
  renderProcessTypeSelects();
  setMessage(els.documentoMessage, "");
}

function renderMetrics() {
  const summary = state.summary;
  els.lucroPrevisto.textContent = money.format(summary.lucroPrevisto || 0);
  els.lucroPrevisto.className = (summary.lucroPrevisto || 0) >= 0 ? "positive" : "negative";
  els.processosResumo.textContent = `${summary.processos || 0} processos`;
  els.totalRecebido.textContent = money.format(summary.totalRecebido || 0);
  els.totalAReceber.textContent = money.format(summary.totalAReceber || 0);
  els.pendentesResumo.textContent = `${summary.pendentes || 0} pendentes`;
  els.totalGasto.textContent = money.format(summary.totalGasto || 0);
  els.lucroRealizado.textContent = `Lucro realizado: ${money.format(summary.lucroRealizado || 0)}`;
  els.clientesBadge.textContent = `${summary.clientes || 0} clientes`;
  els.totalClientesBadge.textContent = `${summary.clientes || 0} clientes`;
}

function renderClientSelect() {
  els.clienteSelect.innerHTML = state.clients.length
    ? state.clients.map((client) => `<option value="${escapeHtml(client.placa)}">${escapeHtml(client.cpf)} - ${escapeHtml(client.placa)} - ${escapeHtml(client.nome)}</option>`).join("")
    : '<option value="">Cadastre um cliente</option>';
  els.clienteSelect.disabled = !state.clients.length;
}

function renderProcessTypeSelects() {
  const options = state.processTypes
    .map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.nome)}</option>`)
    .join("");
  els.tipoProcessoSelect.innerHTML = state.processTypes.length
    ? `<option value="">Escolha o tipo</option>${options}`
    : '<option value="">Crie um tipo</option>';
  els.tipoProcessoSelect.disabled = !state.processTypes.length;
  els.filtroTipo.innerHTML = `<option value="todos">Todos os tipos</option>${options}`;
  els.filtroTipo.value = state.typeFilter;
  if (els.filtroTipo.value !== state.typeFilter) {
    state.typeFilter = "todos";
    els.filtroTipo.value = "todos";
  }
}

function renderPortfolio() {
  if (!state.clients.length) {
    els.clientesResumo.innerHTML = '<div class="empty-state">Nenhum cliente cadastrado.</div>';
    return;
  }

  const rows = state.clients.map((client) => {
    const documents = state.documents.filter((item) => item.placa === client.placa);
    return {
      client,
      count: documents.length,
      profit: documents.reduce((sum, item) => sum + item.lucro, 0),
      pending: documents.filter((item) => !item.recebido).length
    };
  }).sort((a, b) => b.profit - a.profit || a.client.nome.localeCompare(b.client.nome));

  els.clientesResumo.innerHTML = rows.slice(0, 6).map((row) => `
    <article class="summary-row">
      <div>
        <strong>${escapeHtml(row.client.nome)}</strong>
        <span>${escapeHtml(row.client.cpf)} - ${escapeHtml(row.client.placa)}</span>
      </div>
      <div class="summary-values">
        <strong class="${row.profit >= 0 ? "positive" : "negative"}">${money.format(row.profit)}</strong>
        <span>${row.count} processos - ${row.pending} a receber</span>
      </div>
    </article>
  `).join("");
}

function renderProcessTypeStats() {
  const stats = state.summary.processTypeStats || [];
  els.tiposBadge.textContent = `${state.processTypes.length} ${state.processTypes.length === 1 ? "tipo" : "tipos"}`;

  if (!stats.length) {
    els.tiposResumo.innerHTML = '<div class="empty-state">Os tipos mais feitos aparecem depois dos primeiros processos.</div>';
    return;
  }

  const max = stats[0].total || 1;
  els.tiposResumo.innerHTML = stats.slice(0, 6).map((type) => {
    const width = Math.max(8, (type.total / max) * 100);
    return `
      <article class="type-row">
        <div class="type-row-top">
          <strong>${escapeHtml(type.nome)}</strong>
          <span>${type.total} ${type.total === 1 ? "processo" : "processos"}</span>
        </div>
        <div class="type-bar"><span style="width:${width}%"></span></div>
        <small>Lucro previsto: ${money.format(type.lucro)}</small>
      </article>
    `;
  }).join("");
}

function renderRecent() {
  renderDocumentList(els.recentesLista, state.documents.slice(0, 5), true);
}

function renderClients() {
  if (!state.clients.length) {
    els.clientesLista.innerHTML = '<div class="empty-state">Cadastre o primeiro cliente.</div>';
    return;
  }

  els.clientesLista.innerHTML = state.clients.map((client) => {
    const documents = state.documents.filter((item) => item.placa === client.placa);
    const profit = documents.reduce((sum, item) => sum + item.lucro, 0);
    return `
      <article class="client-card">
        <div class="card-top">
          <div>
            <span class="plate">${escapeHtml(client.placa)}</span>
            <h3>${escapeHtml(client.nome)}</h3>
          </div>
          <strong class="${profit >= 0 ? "positive" : "negative"}">${money.format(profit)}</strong>
        </div>
        <dl>
          <div><dt>CPF</dt><dd>${escapeHtml(client.cpf)}</dd></div>
          <div><dt>Telefone</dt><dd>${escapeHtml(client.telefone)}</dd></div>
          <div><dt>Processos</dt><dd>${documents.length}</dd></div>
        </dl>
        <div class="actions">
          <button type="button" class="small-button" data-edit-client="${escapeHtml(client.placa)}">Editar</button>
          <button type="button" class="danger-button" data-remove-client="${escapeHtml(client.placa)}">Remover</button>
        </div>
      </article>
    `;
  }).join("");

  els.clientesLista.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => editClient(button.dataset.editClient));
  });
  els.clientesLista.querySelectorAll("[data-remove-client]").forEach((button) => {
    button.addEventListener("click", () => removeClient(button.dataset.removeClient));
  });
}

function renderDocuments() {
  renderDocumentList(els.documentosLista, filteredDocuments(), false);
}

function renderDocumentList(container, documents, compact) {
  if (!documents.length) {
    container.innerHTML = '<div class="empty-state">Nenhum processo encontrado.</div>';
    return;
  }

  container.innerHTML = documents.map((documentRecord) => {
    const client = findClient(documentRecord.placa);
    const processType = findProcessType(documentRecord.tipoProcessoId);
    const status = documentRecord.recebido ? "Recebido" : "A receber";
    return `
      <article class="document-card">
        <div class="card-top">
          <div>
            <span class="plate">${escapeHtml(documentRecord.placa)}</span>
            <h3>${escapeHtml(client?.nome || "Cliente removido")}</h3>
            <p>${escapeHtml(client?.cpf || "")} ${client?.telefone ? "- " + escapeHtml(client.telefone) : ""}</p>
          </div>
          <div class="status-stack">
            <span class="process-type-pill">${escapeHtml(processType?.nome || "Sem tipo")}</span>
            <span class="status ${documentRecord.recebido ? "ok" : "wait"}">${status}</span>
          </div>
        </div>
        <div class="money-grid">
          <div><span>Recebido</span><strong class="positive">${money.format(documentRecord.valorRecebido)}</strong></div>
          <div><span>Gasto</span><strong class="negative">${money.format(documentRecord.valorGasto)}</strong></div>
          <div><span>Lucro</span><strong class="${documentRecord.lucro >= 0 ? "positive" : "negative"}">${money.format(documentRecord.lucro)}</strong></div>
        </div>
        <div class="document-meta">
          <span>ID ${escapeHtml(documentRecord.idDocumento.slice(0, 8).toUpperCase())}</span>
          <span>${formatDate(documentRecord.createdAt)}</span>
        </div>
        ${compact ? "" : `
          <div class="actions">
            <button type="button" class="small-button" data-edit-document="${escapeHtml(documentRecord.idDocumento)}">Editar</button>
            <button type="button" class="danger-button" data-remove-document="${escapeHtml(documentRecord.idDocumento)}">Remover</button>
          </div>
        `}
      </article>
    `;
  }).join("");

  if (compact) return;
  container.querySelectorAll("[data-edit-document]").forEach((button) => {
    button.addEventListener("click", () => editDocument(button.dataset.editDocument));
  });
  container.querySelectorAll("[data-remove-document]").forEach((button) => {
    button.addEventListener("click", () => removeDocument(button.dataset.removeDocument));
  });
}

function filteredDocuments() {
  const query = normalize(state.search);
  return state.documents.filter((documentRecord) => {
    if (state.filter === "recebidos" && !documentRecord.recebido) return false;
    if (state.filter === "pendentes" && documentRecord.recebido) return false;
    if (state.typeFilter !== "todos" && documentRecord.tipoProcessoId !== state.typeFilter) return false;
    if (!query) return true;
    const client = findClient(documentRecord.placa);
    const processType = findProcessType(documentRecord.tipoProcessoId);
    const text = normalize([
      documentRecord.idDocumento,
      documentRecord.placa,
      processType?.nome,
      client?.cpf,
      client?.nome,
      client?.telefone
    ].join(" "));
    return text.includes(query);
  });
}

function findClient(plate) {
  return state.clients.find((client) => client.placa === plate);
}

function findProcessType(id) {
  return state.processTypes.find((type) => type.id === id);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Erro no servidor.");
  return payload;
}

function setMessage(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("negative", error);
}

function inputMoney(value) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

function maskPlate(value) {
  const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let output = "";

  for (const char of raw) {
    const index = output.length;
    if (index < 3 && /[A-Z]/.test(char)) output += char;
    if (index === 3 && /\d/.test(char)) output += char;
    if (index === 4 && /[A-Z0-9]/.test(char)) output += char;
    if ((index === 5 || index === 6) && /\d/.test(char)) output += char;
    if (output.length === 7) break;
  }

  return output;
}

function maskCpf(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
