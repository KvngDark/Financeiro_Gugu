# Despachante Digital

Site separado para controlar clientes e processos de documentos recebidos pelo WhatsApp.

## Como abrir

```bash
npm start
```

Depois acesse `http://localhost:3100`.

## O que o sistema controla

Cliente:

- `placa`
- `nome`
- `telefone`
- `cpf`

Documento:

- `id_documento`
- `placa`
- `tipoProcessoId`
- `valor_recebido`
- `valor_gasto`
- `lucro`
- `recebido`

O lucro e sempre calculado automaticamente:

```text
lucro = valor_recebido - valor_gasto
```

Os dados ficam salvos em `data/store.json`, dentro desta pasta, sem misturar com o site antigo.

Tipos iniciais:

- Transferencia
- 2 via de codigo de seguranca
- 1 licenca

Novos tipos podem ser criados pela tela de processos. Eles aparecem no filtro e no resumo de recorrencia.

## SQL para TiDB

O schema para criar as tabelas no TiDB fica em `sql/tidb-schema.sql`.
