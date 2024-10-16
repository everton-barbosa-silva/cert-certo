const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Página 1: Nome do certificado
app.get('/', (req, res) => {
    res.send(`
        <form action="/create-dir" method="post">
            Nome do certificado: <input type="text" name="certName">
            <button type="submit">Criar Diretório</button>
        </form>
    `);
});

// Cria diretório
app.post('/create-dir', (req, res) => {
    const certName = req.body.certName;
    const certDir = path.join(process.env.HOME, 'certificados', certName);
    
    fs.mkdir(certDir, { recursive: true }, (err) => {
        if (err) throw err;
        res.send(`
            Diretório criado! Cole o conteúdo do seu body:
            <form action="/upload-body" method="post">
                <input type="hidden" name="certName" value="${certName}">
                Conteúdo do body: <textarea name="body"></textarea>
                <button type="submit">Salvar Body</button>
            </form>
        `);
    });
});

// Página 2: Cole o conteúdo do body
app.post('/upload-body', (req, res) => {
    const certName = req.body.certName;
    const bodyContent = req.body.body;
    const certPath = path.join(process.env.HOME, 'certificados', certName, `${certName}.cer`);
    
    fs.writeFile(certPath, bodyContent, (err) => {
        if (err) throw err;
        res.send(`
            Body salvo! Cole suas CA:
            <form action="/upload-ca" method="post">
                <input type="hidden" name="certName" value="${certName}">
                Conteúdo da CA: <textarea name="ca"></textarea>
                <button type="submit">Salvar CA</button>
            </form>
        `);
    });
});

// Página 3: Cole o conteúdo da CA
app.post('/upload-ca', (req, res) => {
    const certName = req.body.certName;
    const caContent = req.body.ca;
    const caPath = path.join(process.env.HOME, 'certificados', certName, `ca.cer`);
    
    fs.writeFile(caPath, caContent, (err) => {
        if (err) throw err;
        res.send(`
            CA salva! Cole sua Key:
            <form action="/upload-key" method="post">
                <input type="hidden" name="certName" value="${certName}">
                Conteúdo da Key: <textarea name="key"></textarea>
                <button type="submit">Salvar Key</button>
            </form>
        `);
    });
});

// Página 4: Cole o conteúdo da Key
app.post('/upload-key', (req, res) => {
    const certName = req.body.certName;
    const keyContent = req.body.key;
    const keyPath = path.join(process.env.HOME, 'certificados', certName, `${certName}.key`);
    
    fs.writeFile(keyPath, keyContent, (err) => {
        if (err) throw err;
        res.send(`
            Key salva! <button onclick="window.location.href='/validate?certName=${certName}'">Validar Certificado</button>
        `);
    });
});

// Página 5: Validação do Certificado
app.get('/validate', (req, res) => {
    const certName = req.query.certName;
    const certDir = path.join(process.env.HOME, 'certificados', certName);
    const validationScript = `
#!/bin/bash
echo "Compatibilidade entre chain e body"
openssl verify -verbose -CAfile ${certDir}/${certName}.cer ${certDir}/ca.cer
echo ""

echo "checksum da key e body"
openssl pkey -in ${certDir}/${certName}.key -pubout -outform pem | sha256sum
openssl x509 -in ${certDir}/${certName}.cer -pubkey -noout -outform pem | sha256sum
echo ""

echo "Data inicio e fim do certificado"
openssl x509 -noout -dates -in ${certDir}/${certName}.cer
echo ""
`;

    // Executa o script de validação
    exec(validationScript, (error, stdout, stderr) => {
        if (error) {
            res.send(`Erro na validação: ${stderr}`);
            return;
        }
        res.send(`
            Resultado da validação:<br><pre>${stdout}</pre>
            Escolha uma opção:<br>
            <form action="/download-zip" method="post">
                <input type="hidden" name="certName" value="${certName}">
                <button type="submit">Baixar Certificados (ZIP)</button>
            </form>
            <form action="/base64-k8s" method="post">
                <input type="hidden" name="certName" value="${certName}">
                <button type="submit">Configurar no Kubernetes</button>
            </form>
            <form action="/completed" method="post">
                <input type="hidden" name="certName" value="${certName}">
                <button type="submit">Concluído</button>
            </form>
        `);
    });
});

// Função para baixar certificados como ZIP
app.post('/download-zip', (req, res) => {
    const certName = req.body.certName;
    const certDir = path.join(process.env.HOME, 'certificados', certName);
    const zipFile = path.join(certDir, `${certName}.zip`);

    // Cria o arquivo ZIP
    const output = fs.createWriteStream(zipFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        res.download(zipFile, `${certName}.zip`, (err) => {
            if (err) throw err;
            fs.unlinkSync(zipFile); // Deleta o ZIP após o download
        });
    });

    archive.pipe(output);
    archive.directory(certDir, false);
    archive.finalize();
});

// Função para configurar Base64 e Kubernetes
app.post('/base64-k8s', (req, res) => {
    const certName = req.body.certName;
    const certDir = path.join(process.env.HOME, 'certificados', certName);
    const certPath = path.join(certDir, `${certName}.cer`);
    const keyPath = path.join(certDir, `${certName}.key`);
    
    // Leitura dos arquivos e conversão para Base64
    try {
        const certBase64 = fs.readFileSync(certPath, 'base64');
        const keyBase64 = fs.readFileSync(keyPath, 'base64');

        const kubernetesScript = `
        kubectl config use-context kubernetes-dev-gt
        kubectl create secret tls my-tls-secret --cert=${certPath} --key=${keyPath} --dry-run=client -o yaml
        `;

        exec(kubernetesScript, (error, stdout, stderr) => {
            if (error) {
                res.send(`Erro ao configurar no Kubernetes: ${stderr}`);
                return;
            }
            res.send(`
                Certificado em Base64:<br><pre>${certBase64}</pre><br>
                Chave em Base64:<br><pre>${keyBase64}</pre><br>
                Saída do Kubernetes:<br><pre>${stdout}</pre>
            `);
        });
    } catch (error) {
        res.send(`Erro ao gerar Base64: ${error.message}`);
    }
});

// Exibir o diretório dos certificados
app.post('/completed', (req, res) => {
    const certName = req.body.certName;
    const certDir = path.join(process.env.HOME, 'certificados', certName);
    res.send(`Certificados salvos em: ${certDir}`);
});

app.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});
