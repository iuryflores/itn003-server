# Validação manual das consultas no DBeaver

Nesta etapa, as queries devem ser executadas pelo usuário no DBeaver e seus resultados validados antes de habilitar consultas pela aplicação. Estes scripts foram preparados para revisão; não foram executados nesta etapa.

1. `01-estrutura.sql`: confira as colunas das três tabelas usadas no vínculo.
2. `02-validar-ato.sql`: comece pela exemplo fictício de matrícula **12345**, **averbação 1**. O exemplo é editável no CTE `parametros`. Confira título, serviço, número do ato e datas. A consulta mantém candidatos repetidos e mostra `total_candidatos`.
3. `03-conferir-lote-json.sql`: contém identificadores fictícios que devem ser substituídos pelos atos do JSON a conferir. O índice começa em zero. Retorna `UNICO`, `NAO_LOCALIZADO` ou `AMBIGUO`, com os candidatos para conferência. Este script é um modelo e não importa o JSON automaticamente.

Execute cada script completo para incluir a transação `READ ONLY` e o `ROLLBACK`. São consultas SELECT; não há atualização ou exclusão de registros. O timeout de consulta é de 10 segundos.

Pontos a validar antes da integração:

- Se o número sequencial do ato corresponde a `ato.codigo`, separadamente de `ato.ordem`.
- Se o vínculo por `ato.indicador_real_id` identifica o imóvel correto.
- Como distinguir matrícula de transcrição e usar `livro_numero` / `livro_transcricao`.
- Como tratar atos de abertura de número zero. O lote usa tipo exato: `ABERTURA` não é associado automaticamente a `REGISTRO` ou `AVERBACAO`.
- Se `ato.titulo` e `tipo_servico.nome` atendem à descrição desejada para “Outro”.
- Qual data usar: `ato.registro` e `ato.selado` aparecem separadamente, sem substituir a data do JSON.
- Como tratar candidatos repetidos, atos cancelados e eventual diferença de cadastro entre a data da exportação e a consulta atual.

Os scripts não buscam o texto integral do ato nem os dados das partes. As consultas pela API estão bloqueadas por padrão, e os botões de consulta foram retirados da interface. `LEGACY_QUERIES_APPROVED` permanece desativado enquanto fazemos esta validação; não altere para `true` antes de concluir essa etapa.
