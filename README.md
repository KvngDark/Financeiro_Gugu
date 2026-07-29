# Despachante Digital

Site separado para controlar clientes e processos de documentos recebidos pelo WhatsApp.

## Como abrir

```bash
npm start
```

Depois acesse `http://localhost:3100`.

Sem credenciais do TiDB, o app usa `data/store.json` apenas para teste local. Quando o `.env` estiver preenchido com os dados do TiDB, clientes, tipos e processos passam a ser salvos no banco.

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

O lucro e sempre calculado automaticamente pelo sistema e tambem fica como coluna calculada no TiDB:

```text
lucro = valor_recebido - valor_gasto
```

O topo da tela mostra `TiDB conectado` quando o banco esta em uso. Se aparecer `Modo local`, falta configurar as credenciais do banco.

Tipos iniciais:

- Transferencia
- 2 via de codigo de seguranca
- 1 licenca

Novos tipos podem ser criados pela tela de processos. Eles aparecem no filtro e no resumo de recorrencia.

## SQL para TiDB

O schema para criar as tabelas no TiDB fica em `sql/tidb-schema.sql`.

## Ligar ao TiDB

1. Rode `npm install`.
2. Copie `.env.example` para `.env`.
3. Preencha `TIDB_HOST`, `TIDB_USER`, `TIDB_PASSWORD` e `TIDB_DATABASE`.
4. Rode `npm start`.

O servidor tenta criar as tabelas automaticamente. Se o TiDB negar permissao de criacao, crie manualmente pelo console usando `sql/tidb-schema.sql` e coloque isto no `.env`:

```env
TIDB_AUTO_SCHEMA=false
```

Tambem e possivel usar uma URL unica:

```env
DATABASE_URL=mysql://usuario:senha@host:4000/financeiro_gugu
```
