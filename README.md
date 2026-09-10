# Firme — guia de publicação

Este é o app **Firme** pronto para rodar como um site de verdade, com login
próprio e os dados guardados num banco de dados real (Firebase, gratuito).

Siga os passos na ordem. Não precisa saber programar — é só copiar e colar.

---

## 0. Pré-requisito: Node.js

Se você ainda não tem, baixe e instale a versão LTS em https://nodejs.org
(clique em "Download", instale como qualquer programa).

---

## 1. Criar o projeto no Firebase (gratuito)

1. Acesse https://console.firebase.google.com e entre com uma conta Google.
2. Clique em **"Criar projeto"**, dê um nome (ex: `firme-app`) e siga o assistente
   (pode desativar o Google Analytics, não é necessário).
3. Dentro do projeto criado, clique no ícone **"</>"** (Web) para registrar um
   app. Dê um apelido (ex: `firme-web`) e clique em "Registrar app".
4. O Firebase vai mostrar um bloco de código com `firebaseConfig = {...}`.
   **Copie esse bloco** — você vai usá-lo no passo 4.

---

## 2. Ativar o login (Authentication)

1. No menu à esquerda do console Firebase, clique em **"Authentication"**.
2. Clique em **"Vamos começar"** (ou "Get started").
3. Na lista de provedores, clique em **"E-mail/senha"** e ative a primeira opção.
   Salve.

---

## 3. Criar o banco de dados (Firestore)

1. No menu à esquerda, clique em **"Firestore Database"**.
2. Clique em **"Criar banco de dados"**.
3. Escolha **"Iniciar no modo de produção"** e a localização mais próxima
   (ex: `southamerica-east1` para o Brasil). Concluir.
4. Depois de criado, vá na aba **"Regras"** dentro do Firestore e substitua
   todo o conteúdo pelo que está no arquivo `firestore.rules` deste projeto.
   Clique em **"Publicar"**.

Isso garante que cada profissional só enxerga os próprios pacientes.

---

## 4. Conectar o app ao seu Firebase

1. Abra o arquivo `src/firebase.js` neste projeto.
2. Substitua o objeto `firebaseConfig` pelo que você copiou no passo 1.

---

## 5. Rodar no seu computador (para testar antes de publicar)

Abra um terminal dentro da pasta do projeto e rode, em sequência:

```
npm install
npm run dev
```

Vai aparecer um endereço tipo `http://localhost:5173` — abra no navegador.
Crie sua conta (e-mail/senha) na tela de login e teste o app normalmente.

---

## 6. Publicar de graça (Vercel)

1. Crie uma conta em https://vercel.com (pode entrar com GitHub ou e-mail).
2. Se ainda não tiver, crie uma conta em https://github.com e suba esta pasta
   do projeto como um novo repositório (o próprio site do GitHub tem um botão
   de "upload de arquivos" — não precisa saber usar git por linha de comando).
3. Na Vercel, clique em **"Add New" → "Project"**, escolha o repositório que
   você acabou de criar, e clique em **"Deploy"**. Não precisa mudar nenhuma
   configuração — a Vercel detecta que é um projeto Vite automaticamente.
4. Em 1–2 minutos, a Vercel te dá um link público (algo como
   `firme-app.vercel.app`). É esse link que você vai usar no dia a dia, e pode
   compartilhar com colegas se quiser (cada um cria a própria conta e só vê os
   próprios pacientes).

**Alternativa sem GitHub:** rode `npm run build` localmente (isso cria uma
pasta `dist`), depois arraste essa pasta `dist` diretamente para
https://app.netlify.com/drop — publica na hora, sem precisar de GitHub.

---

## 7. Usar no celular

Abra o link publicado no navegador do celular, entre com seu e-mail/senha, e
use o menu do navegador → **"Adicionar à tela inicial"**. Fica com ícone
próprio, como um app instalado.

---

## Sobre privacidade (LGPD)

Como o app guarda dados de saúde de pacientes reais, vale:
- Nunca compartilhar seu e-mail/senha de acesso;
- Ter uma política de privacidade simples se for usar com colegas/clínica;
- Lembrar que os dados ficam nos servidores do Firebase (Google) — para uso
  clínico mais formal, vale revisar os termos do Firebase e considerar um
  termo de consentimento com os pacientes.

---

## Se quiser ir para a Play Store depois

Com o site já publicado (passo 6), dá para "embrulhar" o mesmo link como um
app Android usando uma ferramenta chamada **Bubblewrap** (gratuita, da
própria Google) — nesse momento, é só voltar e pedir esse próximo passo.
