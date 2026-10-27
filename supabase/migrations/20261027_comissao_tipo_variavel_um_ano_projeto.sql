-- Nova opção de "Tipo de variável" no formulário de comissões.
alter type public.comissao_tipo_variavel add value if not exists 'Comissão por um ano de projeto';
