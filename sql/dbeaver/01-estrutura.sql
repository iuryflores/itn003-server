-- Etapa 1: conferir estrutura, sem consultar o conteúdo dos atos.
-- Executar o script completo. Nenhuma alteração é realizada.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('ato', 'indicador_real', 'tipo_servico')
ORDER BY table_name, ordinal_position;

ROLLBACK;
