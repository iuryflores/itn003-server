-- Etapa 2: validar um ato conhecido.
-- Exemplo: identificadores fictícios de matrícula 12345, averbação 1.
-- Para transcrição, ajustar tipo_registro, numero_registro e livro_transcricao.
-- numero_ato corresponde a ato.codigo; ato.ordem é retornado apenas para comparação.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

WITH parametros AS (
  SELECT
    'MATRICULA'::text AS tipo_registro,
    12345::bigint AS numero_registro,
    ''::text AS livro_transcricao,
    1::bigint AS numero_ato,
    'AVERBACAO'::text AS tipo_ato
)
SELECT
  COUNT(*) OVER () AS total_candidatos,
  ir.id AS imovel_id,
  ir.livro AS tipo_registro,
  ir.codigo AS numero_registro,
  ir.livro_numero,
  ir.livro_transcricao,
  a.id AS ato_id,
  a.codigo AS numero_ato,
  a.ordem AS ordem_interna,
  a.tipo AS tipo_ato,
  a.titulo AS titulo_ato,
  ts.nome AS nome_servico,
  a.classificacao_ato_itn003,
  a.alteracao_imovel_itn003,
  a.transmissao_itn003,
  a.registro AS data_registro,
  a.selado AS data_selagem,
  a.cancelamento AS data_cancelamento,
  ir.possui_georreferenciamento,
  ir.numero_poligono
FROM parametros p
JOIN public.indicador_real ir
  ON ir.codigo = p.numero_registro AND ir.livro = p.tipo_registro
JOIN public.ato a ON a.indicador_real_id = ir.id
LEFT JOIN public.tipo_servico ts ON ts.id = a.tipo_servico_id
WHERE a.codigo = p.numero_ato AND a.tipo = p.tipo_ato
  AND (p.tipo_registro <> 'TRANSCRICAO' OR p.livro_transcricao = ''
       OR ir.livro_numero = p.livro_transcricao
       OR ir.livro_transcricao = p.livro_transcricao)
ORDER BY ir.id, a.id
LIMIT 50;

ROLLBACK;
