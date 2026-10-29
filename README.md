# ITN003 — Server

API NestJS com TypeScript. Requer Node.js 22.

```powershell
npm install
npm run dev
```

API em http://127.0.0.1:3000.

```powershell
npm run build
npm test
npm start
```

Os schemas oficiais locais estão em `schemas/` e devem acompanhar a aplicação compilada.
Endpoints: `POST /api/audit` e `POST /api/export`. Ambos recebem o conteúdo original como `raw`; export recebe também `excluded` com índices a remover. Limite HTTP de 50 MB. Processamento em memória, sem envio ao ONR.

Repositório independente do client, com package-lock.json e node_modules próprios.

## Exigências e campos opcionais

A auditoria aplica os schemas oficiais locais, sem incorporar bloqueios do relatório do sistema legado. A revisão distingue campos obrigatórios ausentes de valores ou formatos inválidos. Um campo opcional ausente não gera pendência; se informado, deve respeitar as restrições do schema. As condições e exceções permanecem controladas pelo schema integral, incluindo novos atos, transmissão, decisão judicial, matrícula e transcrição.

Observações de redação entre manual e schema são separadas das pendências. Para SNCR rural de 12 dígitos, a tela informa que o schema e a seção de validação de caracteres aceitam 12 ou 13, apesar de a tabela indicar tamanho 13; isso não cria um novo erro. A classificação estrutural permanece independente da decisão sobre obrigatoriedade de comunicar o ato.

## PostgreSQL do legado — infraestrutura de conexão

Configure `POSTGRES_CONNECTION_STRING` em `.env` apenas no server (veja `.env.example`). O server aceita URLs `postgres://`, `postgresql://` e `postgresql+psycopg2://`. A configuração do arquivo é relida nas próximas consultas, exceto se a variável já estiver definida no ambiente do processo, que tem precedência. As credenciais nunca são retornadas à interface.

- `GET /api/legacy/status`: testa a conexão sem ler dados dos atos.
- `GET /api/legacy/structure`: consulta nomes e tipos de colunas em `information_schema`, limitado a 1800 colunas, para definir o mapeamento.

Todas as consultas executam dentro de `BEGIN READ ONLY`, com timeout de 10 segundos e rollback ao terminar. O pool usa no máximo duas conexões. Não há endpoint de SQL livre.

`POST /api/legacy/context` recebe `{raw}` com o JSON original e consulta os atos das tabelas `public.ato`, `public.indicador_real` e `public.tipo_servico`. O vínculo usa o tipo e número da matrícula/transcrição, livro da transcrição quando informado, número e tipo do ato. O número do ato corresponde a `ato.codigo`, não a `ato.ordem`. Atos de abertura com número zero podem corresponder a `ABERTURA` no legado e são apresentados com aviso de diferença de tipo. Mais de um candidato resulta em identificação ambígua, sem escolher automaticamente.

O cruzamento está limitado a 1000 registros por consulta. Retorna título, serviço, datas de registro e selagem, classificação ITN003 e georreferenciamento declarado no legado. Não consulta o texto integral do ato nem os dados pessoais das partes. Os dados complementares são separados do JSON original e não alteram decisões, critérios documentais ou campos da remessa.

A conferência de integração com o arquivo real fornecido encontrou os 60 atos, sem ambiguidades. Títulos e cadastros do banco representam o estado consultado; podem diferir do momento da exportação do JSON.

## Estado atual: consultas pela aplicação autorizadas

O arquivo `.env` local está com `LEGACY_QUERIES_APPROVED=true`, conforme autorização do usuário. A interface oferece consulta manual pelo botão **Consultar atos do JSON**; importar o arquivo não dispara consultas ao banco. Para pausar novamente, configure `LEGACY_QUERIES_APPROVED=false`.

A aplicação usa o driver PostgreSQL no backend. As credenciais não são retornadas ao navegador; somente os campos necessários à revisão são retornados pela API. Não há envio desses dados a um serviço de IA implementado neste projeto. Os dados complementares são exibidos ao usuário na interface e no relatório de auditoria.

Os scripts do DBeaver permanecem em `sql/dbeaver/` para conferência manual. Nenhuma consulta ao banco foi executada pelas ferramentas do assistente durante esta reativação; a verificação usou builds e testes locais.

`GET /api/legacy/acts/:id/minute` busca `ato.texto` por UUID validado, em consulta parametrizada e transação somente de leitura. Não é chamado no carregamento do lote. A resposta usa `Cache-Control: no-store` e limita o texto a 2 MB; textos maiores recebem uma indicação sem retornar o conteúdo. A minuta não é persistida pela aplicação nem incluída na remessa. A validação desta funcionalidade foi realizada com dados fictícios e testes locais, sem consultar minutas reais pelas ferramentas do assistente.

## Persistência do andamento

A API salva preparações em `data/preparations/` dentro do projeto server, em arquivos JSON separados e ignorados pelo Git. Não usa o PostgreSQL legado para gravar progresso.

- `GET /api/preparations`: lista nomes, datas e contagens, sem retornar o JSON original.
- `GET /api/preparations/:id`: retorna uma preparação para retomada.
- `POST /api/preparations`: recebe `{preparation, id?, revision?}`. Sem `id`, cria uma nova auditoria; com `id`, exige a revisão atual. Uma revisão desatualizada recebe HTTP 409.

A preparação contém somente o formato versionado, nome, conteúdo original, decisões e anotações. Campos adicionais, incluindo minutas, não são persistidos. O original de uma auditoria salva é imutável; outro original exige criar uma nova auditoria. IDs UUID validados são usados como nomes de arquivos; o nome enviado pelo usuário não define caminhos.

O salvamento é manual e funciona antes da exportação final. A escrita é serializada dentro do processo e usa arquivo temporário seguido de renomeação. Esta persistência destina-se a uma única instância local do backend. Preserve a pasta de dados nos backups e ao atualizar/reimplantar o server.

## Alterações de classificação

`POST /api/audit` e `POST /api/export` aceitam `classifications`, um objeto com índice original do imóvel e código do campo `ato` entre 1 e 6, por exemplo `{"0":5}`. Campos e índices inválidos são rejeitados. A preparação persiste essas alterações separadamente de `raw`; o JSON original continua imutável. Preparações anteriores sem esse campo são compatíveis.

A aplicação das alterações usa edição por posições do JSON, sem reserializar os demais valores, preservando números longos e a representação dos campos não alterados. A auditoria valida os valores editados pelo schema integral; a exportação aplica as alterações e as exclusões por índices originais. O relatório registra os códigos original e final.
