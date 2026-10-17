# CRM Rank & Rent

App interna para gerir os sites de rank & rent: sites, leads, prospeção, parceiros, faturação e calculadora de valor da lead.

- Corre na Cloudflare (Workers + base de dados D1), no plano grátis.
- Login pelo Cloudflare Access, com o teu email Google.
- Vai buscar os números do Search Console todos os dias.
- Recebe os formulários dos sites (por agora, os dos EUA).

Fase 1. A seguir: assistente de WhatsApp (fase 2) e chamadas com call tracking (fase 3).

---

## Pôr no ar (uma vez)

### 1. Base de dados

1. Cloudflare › **Storage & Databases › D1 › Create database**, com o nome `rank-rent-crm`.
2. Copia o **Database ID** e substitui o `00000000-…` em `wrangler.jsonc` (ou manda-mo e eu faço o commit).

### 2. Ligar o repositório

1. Cloudflare › **Workers & Pages › Create › Import a repository** › escolhe `rank-rent-crm`.
2. **Build command:** vazio.
3. **Deploy command:**
   ```
   npx wrangler d1 migrations apply rank-rent-crm --remote && npx wrangler deploy
   ```
4. Guarda. A partir daqui, cada commit no `main` vai para o ar sozinho. As alterações à base de dados (pasta `migrations`) também são aplicadas sozinhas.

A app fica em `https://rank-rent-crm.<a-tua-conta>.workers.dev`.

### 3. Login (Cloudflare Access)

Sem este passo a app responde "Sem acesso" a toda a gente, o que é o comportamento certo.

1. Cloudflare › **Zero Trust**. Na primeira vez, escolhe um nome de equipa e o plano **Free**.
2. **Access › Applications › Add an application › Self-hosted**:
   - Domínio: `rank-rent-crm.<a-tua-conta>.workers.dev`
   - Política **Allow** › Include › *Emails* › `lancamentoszero@gmail.com`
   - Login method: *One-time PIN* (código por email) ou Google.
3. Na mesma aplicação, acrescenta uma segunda política, **Bypass** › Include › *Everyone*, só para o caminho `/hooks/*`. É por aí que entram os formulários dos sites, e esse caminho está protegido pela chave de cada site.
4. Copia dois valores e põe-nos em `wrangler.jsonc` (ou manda-mos):
   - `ACCESS_TEAM_DOMAIN`: ex. `fabio.cloudflareaccess.com` (Zero Trust › Settings › Custom Pages)
   - `ACCESS_AUD`: o *Application Audience (AUD) Tag* da aplicação (Overview da aplicação)

### 4. Search Console (posição média e impressões automáticas)

1. Em console.cloud.google.com: cria um projeto › **APIs & Services › Library** › ativa **Google Search Console API**.
2. **IAM & Admin › Service Accounts › Create**. Não precisa de papéis. Depois: **Keys › Add key › JSON**, e descarrega o ficheiro.
3. Cloudflare › o Worker `rank-rent-crm` › **Settings › Variables and Secrets › Add** › tipo *Secret*, nome `GSC_SERVICE_ACCOUNT`, valor = o conteúdo inteiro do ficheiro JSON.
4. Em cada site do Search Console: **Definições › Utilizadores e autorizações › Adicionar utilizador** › o email da conta de serviço (acaba em `iam.gserviceaccount.com`) › autorização **Restrita**.
5. Na app: **Definições › Atualizar agora**. Isto puxa os últimos 90 dias. Daí para a frente atualiza sozinho todos os dias.

Se algum site estiver no Search Console como "prefixo de URL" e não como "domínio", muda o campo *Propriedade no Search Console* na ficha do site para `https://dominio.com/`.

### 5. Formulários dos sites dos EUA

Na ficha de cada site › **Ligar o formulário do site à app**: tem o endereço e o código para colar no site. O formulário continua a mandar o email como hoje e passa também a enviar para a app.

---

## Papéis

| | Administrador | VA |
|---|---|---|
| Sites, leads, prospeção, calculadora | Sim | Sim |
| Parceiros (dados, trabalhos) | Sim | Sim, sem valores |
| Acordos e preços | Sim | Não |
| Financeiro e Definições | Sim | Não |
| Apagar leads | Sim | Não |

Para dar acesso a uma VA: acrescentá-la em **Definições** e autorizar o email dela na política do Cloudflare Access.

## Regras de faturação

- **Um modelo por parceiro**, para todos os sites dele: por lead, mensalidade ou comissão por trabalho.
- **Cada chamada é uma lead faturável.** "Não faturável" é só para spam, enganos ou testes.
- Uma linha por parceiro e por mês. Cobra-se até dia 5 do mês seguinte, e a partir daí fica "em atraso".
- Mudar de fase fecha o acordo anterior na véspera do novo. Os meses anteriores continuam calculados com o acordo antigo.
- A mensalidade conta nos meses em que o acordo está ativo no último dia do mês.

## Desenvolvimento local

```
npm install
echo "DEV_USER=lancamentoszero@gmail.com" > .dev.vars
npx wrangler d1 migrations apply rank-rent-crm --local
npx wrangler dev
```
