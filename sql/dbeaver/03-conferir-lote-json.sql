-- Etapa 3: modelo para conferir um lote de atos.
-- Os identificadores abaixo são fictícios. Substitua pelos registros do seu JSON.
-- Índice JSON começa em zero. Consulta estrita: sem associação automática de ABERTURA.
-- Não retorna texto integral dos atos nem dados pessoais das partes.
-- Preserva candidatos repetidos para identificar ambiguidades; não usa LIMIT por ato.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

WITH entrada(indice_json, tipo_registro, numero_registro, livro_transcricao, numero_ato, tipo_ato, data_ato_json) AS (
  VALUES
    (0, 'MATRICULA', 12345, '', 1, 'AVERBACAO', ''),
    (1, 'TRANSCRICAO', 6789, 'A', 2, 'REGISTRO', '')
), candidatos AS (
  SELECT e.*,ir.id AS imovel_id,ir.livro_numero AS livro_numero_legado,
    ir.livro_transcricao AS livro_transcricao_legado,
    a.id AS ato_id,a.codigo AS numero_ato_legado,a.tipo AS tipo_ato_legado,
    a.titulo AS titulo_ato,ts.nome AS nome_servico,
    a.classificacao_ato_itn003,a.registro AS data_registro,a.selado AS data_selagem,
    a.cancelamento AS data_cancelamento,
    ir.possui_georreferenciamento,ir.numero_poligono,
    COUNT(a.id) OVER (PARTITION BY e.indice_json) AS total_candidatos
  FROM entrada e
  LEFT JOIN public.indicador_real ir
    ON ir.codigo=e.numero_registro AND ir.livro=e.tipo_registro
    AND (e.tipo_registro<>'TRANSCRICAO' OR e.livro_transcricao=''
         OR ir.livro_numero=e.livro_transcricao OR ir.livro_transcricao=e.livro_transcricao)
  LEFT JOIN public.ato a ON a.indicador_real_id=ir.id
    AND a.codigo=e.numero_ato AND a.tipo=e.tipo_ato
  LEFT JOIN public.tipo_servico ts ON ts.id=a.tipo_servico_id
)
SELECT *,CASE WHEN total_candidatos=0 THEN 'NAO_LOCALIZADO'
              WHEN total_candidatos=1 THEN 'UNICO' ELSE 'AMBIGUO' END AS resultado
FROM candidatos
ORDER BY indice_json,imovel_id,ato_id;

ROLLBACK;
