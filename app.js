const apiKey = "AQ.Ab8RN6JoHtC3SijSLeE7YGnkKvRIZ9tF1z8imFBZjByevnhDtA"; 
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        // Elementos do DOM
        const form = document.getElementById('ats-form');
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        const resultsSection = document.getElementById('results-section');
        const inputSection = document.getElementById('input-section');

        // Função para extrair texto da URL usando um proxy CORS
        async function fetchJobDescription(url) {
            try {
                const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
                if (!response.ok) throw new Error("Erro na rede.");
                const data = await response.json();
                
                const parser = new DOMParser();
                const doc = parser.parseFromString(data.contents, 'text/html');
                
                // Limpar elementos desnecessários do site alvo
                doc.querySelectorAll('script, style, nav, footer, header, noscript, svg').forEach(el => el.remove());
                
                const text = doc.body.innerText.replace(/\s+/g, ' ').trim();
                if (!text || text.length < 50) throw new Error("Texto insuficiente extraído da página.");
                return text;
            } catch (e) {
                console.error(e);
                throw new Error("Não foi possível extrair o texto da URL. O site pode estar a bloquear o acesso automatizado.");
            }
        }

        // Função para ler ficheiros (PDF, DOC, DOCX, MD, HTML)
        async function extractTextFromFile(file) {
            const ext = file.name.split('.').pop().toLowerCase();
            
            if (['md', 'html', 'htm', 'txt'].includes(ext)) {
                return await file.text();
            }
            
            if (ext === 'docx') {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                return result.value;
            }

            if (ext === 'doc') {
                // Leitura básica para tentar salvar o texto de ficheiros binários antigos .doc
                const buffer = await file.arrayBuffer();
                return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
                       .replace(/[^\x20-\x7E\xA0-\xFF\u0100-\u017F\u0180-\u024F\n\r\t]/g, " ");
            }
            
            if (ext === 'pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let text = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(item => item.str).join(' ') + "\n";
                }
                return text;
            }
            
            throw new Error(`Formato de ficheiro não suportado: ${ext}.`);
        }

        // Função principal de submissão do formulário
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const jobUrl = document.getElementById('job-url').value;
            const resumeFile = document.getElementById('resume-file').files[0];

            if (!jobUrl || !resumeFile) {
                alert("Por favor, preencha a URL e anexe o ficheiro.");
                return;
            }

            showLoading(true, "A extrair dados da vaga a partir da URL...");
            resultsSection.style.display = 'none';

            try {
                const jobDescription = await fetchJobDescription(jobUrl);
                
                showLoading(true, "A processar o seu currículo...");
                const resumeText = await extractTextFromFile(resumeFile);

                showLoading(true, "A IA está a analisar a aderência do perfil...");
                const analysisResult = await callGeminiAI(jobDescription, resumeText);
                
                populateResults(analysisResult);
                showLoading(false);
                resultsSection.style.display = 'block';
                inputSection.scrollIntoView({ behavior: 'smooth' });
                window.scrollTo({ top: document.getElementById('results-section').offsetTop - 20, behavior: 'smooth' });

            } catch (error) {
                console.error("Erro na análise:", error);
                showLoading(false);
                alert(error.message || "Ocorreu um erro ao processar a análise. Tente novamente mais tarde.");
            }
        });

        // Função para chamar a API do Gemini com Retry Logic (Backoff Exponencial)
        async function callGeminiAI(jobDescription, resumeText, retries = 5) {
            const systemPrompt = `
                Você é um especialista em Recrutamento e Seleção, e um Analista de Sistemas ATS (Applicant Tracking System).
                Sua tarefa é analisar o currículo do candidato em relação à descrição da vaga fornecida e retornar um JSON estrito.
                Não inclua formatação markdown como \`\`\`json no início ou no fim. Retorne APENAS um objeto JSON válido.
                
                Estrutura obrigatória do JSON:
                {
                    "score": <número de 0 a 100 representando a aderência do currículo à vaga>,
                    "scoreFeedback": "<uma frase curta resumindo o score>",
                    "keywordsFound": ["palavra1", "palavra2", ...],
                    "keywordsMissing": ["palavra1", "palavra2", ...],
                    "strengths": ["ponto forte 1", "ponto forte 2", ...],
                    "weaknesses": ["ponto de melhoria 1", "ponto de melhoria 2", ...],
                    "restructuredResume": "<O texto do currículo reescrito, otimizado para ATS, usando verbos de ação, quantificando resultados e incluindo as palavras-chave necessárias. Formate em texto limpo com quebras de linha (\\n).>"
                }
            `;

            const userPrompt = `
                DESCRIÇÃO DA VAGA:
                ${jobDescription}

                CURRÍCULO DO CANDIDATO:
                ${resumeText}
            `;

            const payload = {
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    responseMimeType: "application/json"
                }
            };

            // Implementação de Retry
            let delay = 1000;
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const data = await response.json();
                    const jsonString = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    
                    if (!jsonString) throw new Error("Resposta da IA vazia ou mal formatada.");
                    
                    return JSON.parse(jsonString);

                } catch (err) {
                    if (i === retries - 1) throw err; // Falhou na última tentativa
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Backoff exponencial
                }
            }
        }

        // Atualizar o DOM com os resultados da IA
        function populateResults(data) {
            // Score
            const scoreCircle = document.getElementById('score-circle');
            scoreCircle.textContent = `${data.score}%`;
            
            // Remover classes de cor anteriores
            scoreCircle.classList.remove('score-high', 'score-medium', 'score-low');
            
            if (data.score >= 80) {
                scoreCircle.classList.add('score-high');
            } else if (data.score >= 50) {
                scoreCircle.classList.add('score-medium');
            } else {
                scoreCircle.classList.add('score-low');
            }

            document.getElementById('score-feedback').textContent = data.scoreFeedback;

            // Palavras-chave Encontradas
            const keywordsFoundContainer = document.getElementById('keywords-found');
            keywordsFoundContainer.innerHTML = '';
            if (data.keywordsFound && data.keywordsFound.length > 0) {
                data.keywordsFound.forEach(kw => {
                    const span = document.createElement('span');
                    span.className = 'badge bg-success keyword-badge';
                    span.textContent = kw;
                    keywordsFoundContainer.appendChild(span);
                });
            } else {
                keywordsFoundContainer.innerHTML = '<span class="text-muted">Nenhuma palavra-chave principal identificada.</span>';
            }

            // Palavras-chave Faltando
            const keywordsMissingContainer = document.getElementById('keywords-missing');
            keywordsMissingContainer.innerHTML = '';
            if (data.keywordsMissing && data.keywordsMissing.length > 0) {
                data.keywordsMissing.forEach(kw => {
                    const span = document.createElement('span');
                    span.className = 'badge bg-danger keyword-badge';
                    span.textContent = kw;
                    keywordsMissingContainer.appendChild(span);
                });
            } else {
                keywordsMissingContainer.innerHTML = '<span class="text-muted">Excelente! Seu currículo cobre as palavras-chave principais.</span>';
            }

            // Pontos Fortes
            const strengthsList = document.getElementById('strengths-list');
            strengthsList.innerHTML = '';
            data.strengths.forEach(strength => {
                const li = document.createElement('li');
                li.className = 'list-group-item';
                li.innerHTML = `<i class="bi bi-check2 text-success me-2"></i> ${strength}`;
                strengthsList.appendChild(li);
            });

            // Pontos de Melhoria
            const weaknessesList = document.getElementById('weaknesses-list');
            weaknessesList.innerHTML = '';
            data.weaknesses.forEach(weakness => {
                const li = document.createElement('li');
                li.className = 'list-group-item';
                li.innerHTML = `<i class="bi bi-arrow-right-short text-warning me-2"></i> ${weakness}`;
                weaknessesList.appendChild(li);
            });

            // Currículo Reestruturado
            const restructuredResume = document.getElementById('restructured-resume');
            restructuredResume.textContent = data.restructuredResume;
        }

        // Loader helper
        function showLoading(show, text = "A IA está a analisar o seu currículo...") {
            loadingOverlay.style.display = show ? 'flex' : 'none';
            if (show) loadingText.textContent = text;
        }

        // Copiar texto reestruturado para o clipboard
        document.getElementById('copy-btn').addEventListener('click', () => {
            const textToCopy = document.getElementById('restructured-resume').innerText;
            
            // Tratamento para iframe fallback caso navigator.clipboard falhe
            try {
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                const copyBtn = document.getElementById('copy-btn');
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="bi bi-check"></i> Copiado!';
                copyBtn.classList.replace('btn-outline-secondary', 'btn-success');
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.classList.replace('btn-success', 'btn-outline-secondary');
                }, 2000);
            } catch (err) {
                console.error("Falha ao copiar: ", err);
            }
        });
