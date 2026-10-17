-- Dados reais importados da folha "RANK AND RENT WEBSITES" (Drive) a 17/10/2026.
-- O que a folha não tinha (preços, custos, nome da parceira) fica vazio para preencher na app.

INSERT INTO users (email, name, role) VALUES ('lancamentoszero@gmail.com', 'Fábio', 'admin');

INSERT INTO partners (id, name, country, currency, notes)
VALUES (1, 'Parceira detalhe automóvel', 'PT', 'EUR',
        'Serviço ao domicílio com recolha e entrega. Bate-chapa e pintura: subcontrata. Preencher nome e contacto.');

-- Fase 1, pagamento por lead. Preço por definir (preencher na ficha do parceiro).
INSERT INTO agreements (partner_id, phase, model, amount, start_on)
VALUES (1, 1, 'per_lead', NULL, '2026-09-03');

INSERT INTO sites (domain, niche, city, country, status, partner_id, created_on, gsc_property, form_key, tracking_number, notes) VALUES
 ('detalheautomovelseixal.pt',     'Detalhe automóvel', 'Seixal',          'PT', 'alugado',    1,    '2026-07-14', 'sc-domain:detalheautomovelseixal.pt',     lower(hex(randomblob(16))), NULL, NULL),
 ('detalheautomovelalmada.pt',     'Detalhe automóvel', 'Almada',          'PT', 'alugado',    1,    '2026-08-01', 'sc-domain:detalheautomovelalmada.pt',     lower(hex(randomblob(16))), NULL, NULL),
 ('wallboxseixal.pt',              'Wallbox',           'Seixal',          'PT', 'construcao', NULL, NULL,         'sc-domain:wallboxseixal.pt',              lower(hex(randomblob(16))), NULL, NULL),
 ('wallboxalmada.pt',              'Wallbox',           'Almada',          'PT', 'pausado',    NULL, '2026-08-01', 'sc-domain:wallboxalmada.pt',              lower(hex(randomblob(16))), NULL, NULL),
 ('epoxyflooringbirmingham.com',   'Epoxy flooring',    'Birmingham',      'US', 'pausado',    NULL, '2026-08-03', 'sc-domain:epoxyflooringbirmingham.com',   lower(hex(randomblob(16))), '+1 205 946 3725', 'Encaminhamento por TwiML Bin (whisper-birmingham / forward-birmingham).'),
 ('collegestationmoldremoval.com', 'Mold removal',      'College Station', 'US', 'pausado',    NULL, '2026-08-05', 'sc-domain:collegestationmoldremoval.com', lower(hex(randomblob(16))), '+1 979 977 1641', NULL),
 ('brownsvillemoldremoval.com',    'Mold removal',      'Brownsville',     'US', 'construcao',    NULL, NULL,         'sc-domain:brownsvillemoldremoval.com',    lower(hex(randomblob(16))), NULL, 'Parado desde 05/08/2026. Precisa de número Twilio 956 antes de ir para o ar.');

-- Posições médias registadas à mão na folha (colunas "14 AGOSTO" e "21 SETEMBRO")
INSERT INTO seo_daily (site_id, date, position, source)
SELECT id, '2026-08-14', p, 'manual' FROM (
  SELECT id, CASE domain
    WHEN 'detalheautomovelseixal.pt' THEN 9.5
    WHEN 'detalheautomovelalmada.pt' THEN 11.7
    WHEN 'wallboxalmada.pt' THEN 16.2
    WHEN 'epoxyflooringbirmingham.com' THEN 59.5
    WHEN 'collegestationmoldremoval.com' THEN 46
  END AS p FROM sites) WHERE p IS NOT NULL;

INSERT INTO seo_daily (site_id, date, position, source)
SELECT id, '2026-09-21', p, 'manual' FROM (
  SELECT id, CASE domain
    WHEN 'detalheautomovelseixal.pt' THEN 9
    WHEN 'detalheautomovelalmada.pt' THEN 8.5
    WHEN 'wallboxalmada.pt' THEN 8
    WHEN 'epoxyflooringbirmingham.com' THEN 38.6
    WHEN 'collegestationmoldremoval.com' THEN 50.4
  END AS p FROM sites) WHERE p IS NOT NULL;
