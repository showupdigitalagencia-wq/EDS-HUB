# CHECKLIST DE VALIDAÇÃO EM PRODUÇÃO
## Validação Pós-Deploy da Integração `/register` → EDS HUB

Este checklist deve ser executado no navegador após a publicação das alterações no site `https://www.expdentalsolutions.com/register`.

---

### TESTE 1: Captura de Inscrição Incompleta (Abandono de Carrinho)

- [ ] **1.1** Abrir uma janela anônima no navegador.
- [ ] **1.2** Acessar a página: `https://www.expdentalsolutions.com/register`.
- [ ] **1.3** Preencher apenas os campos:
  - **Name:** `Dr. Teste Abandono Incompleto`
  - **Email:** `teste.abandono.eds@gmail.com`
  - **Phone:** `+1 (941) 555-0188`
  - **Course:** Selecionar `Zygomatic Implant Course - November 7-10, 2026 | Tuition: $17,500`
- [ ] **1.4** **NÃO CLICAR EM SUBMIT.** Aguardar 3 segundos.
- [ ] **1.5** Fechar a aba do navegador.
- [ ] **1.6** Acessar o EDS HUB (`https://xogcexclqiornuscsdmn.supabase.co` ou aplicativo web):
  - [ ] Verificar se o lead `Dr. Teste Abandono Incompleto` foi criado na etapa **"Novo Lead"**.
  - [ ] Verificar se existe uma tarefa pendente: `Retomar inscrição: Zygomatic Implant Training`.
  - [ ] Verificar se a notificação push foi gerada: `"Inscrição não concluída — Dr. Teste Abandono Incompleto tentou se inscrever em Zygomatic Implant Training."`

---

### TESTE 2: Captura de Falha de Envio (Erro no Formulário)

- [ ] **2.1** Acessar `https://www.expdentalsolutions.com/register`.
- [ ] **2.2** Preencher Nome, E-mail, Telefone e Curso.
- [ ] **2.3** Deixar de marcar o reCAPTCHA ou deixar o campo obrigatório de telefone de emergência em branco.
- [ ] **2.4** Clicar no botão **Submit**.
- [ ] **2.5** Confirmar que o site exibe a mensagem de validação amigável ao usuário.
- [ ] **2.6** No EDS HUB:
  - [ ] Confirmar que a tentativa foi registrada com status `submission_failed`.
  - [ ] A equipe tem visibilidade de que o dentista tentou se matricular e encontrou um erro no preenchimento.

---

### TESTE 3: Inscrição Concluída com Sucesso (Lead Novo)

- [ ] **3.1** Acessar `https://www.expdentalsolutions.com/register`.
- [ ] **3.2** Preencher **todos os campos obrigatórios** com dados de teste:
  - **Name:** `Dr. Novo Aluno Teste`
  - **Email:** `novo.aluno.teste@gmail.com`
  - **Email Confirmation:** `novo.aluno.teste@gmail.com`
  - **Phone:** `+1 (941) 555-0122`
  - **Emergency Phone:** `+1 (941) 555-0999`
  - **Specialty:** `General Practitioner`
  - **Years in Practice:** `5-9 years`
  - **Surgical Experience:** `Moderate surgical experience`
  - **Coat Size:** `M`
  - **Course:** `Wisdom Teeth Training - November 7-10, 2026 | Tuition: $8,200`
  - **Terms & Conditions:** Marcar checkbox
  - **Date:** Preencher data atual
  - **Signature:** `Dr. Novo Aluno Teste`
  - **Passport / Dental License:** Anexar arquivos de teste (PDF ou imagem < 5MB)
  - **reCAPTCHA:** Resolver checkbox "Não sou um robô"
- [ ] **3.3** Clicar no botão **Submit**.
- [ ] **3.4** Confirmar que o site exibe estado de carregamento (`Submitting...`) e redireciona com sucesso para `https://www.expdentalsolutions.com/thank-you`.
- [ ] **3.5** No EDS HUB:
  - [ ] Confirmar que o lead `Dr. Novo Aluno Teste` aparece no Pipeline.
  - [ ] Clicar no lead e abrir a aba **"Formulário do Lead"**.
  - [ ] Verificar se todos os campos comerciais foram gravados: Especialidade, Anos de prática, Experiência cirúrgica, Tamanho de jaleco, Como conheceu a empresa, Código promocional.
  - [ ] Verificar se qualquer tarefa de tentativa incompleta anterior foi automaticamente marcada como **concluída**.

---

### TESTE 4: Lead Retornando com Curso Diferente (Resurfacing)

- [ ] **4.1** Utilizando o mesmo e-mail do teste anterior (`novo.aluno.teste@gmail.com`):
- [ ] **4.2** Acessar novamente `https://www.expdentalsolutions.com/register`.
- [ ] **4.3** Preencher o formulário selecionando um **curso diferente**:
  - **Course:** `Intensive Molar Endodontics Training - April 26-29, 2027 | Tuition: $9,600`
- [ ] **4.4** Enviar o formulário.
- [ ] **4.5** No EDS HUB:
  - [ ] Confirmar que **NÃO foi criado um novo lead duplicado**. O lead existente mantém o mesmo ID.
  - [ ] Na ficha do lead, confirmar que os dois cursos estão registrados nos interesses: `Wisdom Teeth Training` e `Endodontics Training`.
  - [ ] Confirmar que o card do lead **subiu para o topo da coluna** no Pipeline (`last_inbound_activity_at`).
  - [ ] Confirmar que o indicador de `"Novo formulário"` está ativo no card.
  - [ ] Na aba **"Formulário do Lead"**, confirmar que a nova submissão aparece no histórico (ordenada da mais recente para a mais antiga).

---

### TESTE 5: Verificação de Privacidade e Segurança

- [ ] **5.1** No EDS HUB, inspecionar os dados recebidos do formulário do lead.
- [ ] **5.2** Confirmar que **NENHUM** arquivo físico (`passport` ou `dental_license`) foi enviado para o EDS HUB (permanecem apenas no armazenamento seguro do servidor do site).
- [ ] **5.3** Confirmar que anotações médicas (`medical_conditions`) e restrições alimentares (`dietary`) **NÃO** constam nos registros do EDS HUB.
- [ ] **5.4** Confirmar que nenhuma chave privada (`service_role`, credenciais de banco de dados ou senhas) está exposta no código-fonte JavaScript da página.
