CREATE TABLE IF NOT EXISTS dispatch_clients (
  placa VARCHAR(7) PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  telefone VARCHAR(15) NOT NULL,
  cpf VARCHAR(14) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dispatch_clients_cpf (cpf),
  INDEX idx_dispatch_clients_nome (nome)
);

CREATE TABLE IF NOT EXISTS dispatch_process_types (
  id VARCHAR(70) PRIMARY KEY,
  nome VARCHAR(90) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dispatch_process_types_nome (nome)
);

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
);

INSERT INTO dispatch_process_types (id, nome) VALUES
  ('transferencia', 'Transferencia'),
  ('segunda_via_codigo_seguranca', '2 via de codigo de seguranca'),
  ('primeira_licenca', '1 licenca')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);
