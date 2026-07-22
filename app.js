        // Variáveis Globais
        let supabaseClient = null;
        let currentUser = null;
        let authModalInstance = null;

        // Referências do DOM
        const form = document.getElementById('ats-form');
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        
        // Inicialização
        document.addEventListener('DOMContentLoaded', () => {
            authModalInstance = new bootstrap.Modal(document.getElementById('authModal'));
            loadConfig();
        });

        // ----------------------------------------------------
        // SISTEMA DE ALERTAS / UI HELPERS
        // ----------------------------------------------------
        function showMessage(message, type = 'danger') {
            const container = document.getElementById('message-container');
            container.innerHTML = `
                <div class="alert alert-${type} alert-dismissible fade show shadow-sm" role="alert">
                    ${message}
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function showLoading(show, text = "A processar...") {
            loadingOverlay.style.display = show ? 'flex' : 'none';
            if (show) loadingText.textContent = text;
        }

        function showSection(sectionId) {
            document.getElementById('input-section').style.display = 'none';
            document.getElementById('results-section').style.display = 'none';
            document.getElementById('history-section').style.display = 'none';
            document.getElementById('hero-header').style.display = sectionId === 'input-section' ? 'block' : 'none';
            document.getElementById(sectionId).style.display = 'block';
        }

        // ----------------------------------------------------
        // CONFIGURAÇÃO E INICIALIZAÇÃO SUPABASE
        // ----------------------------------------------------
        function loadConfig() {
            const savedGemini = localStorage.getItem('gemini_key') || '';
            const savedSupUrl = localStorage.getItem('supabase_url') || '';
            const savedSupKey = localStorage.getItem('supabase_key') || '';

            document.getElementById('api-key-input').value = savedGemini;
            document.getElementById('supabase-url-input').value = savedSupUrl;
            document.getElementById('supabase-key-input').value = savedSupKey;

            if (savedSupUrl && savedSupKey) {
                initSupabase(savedSupUrl, savedSupKey);
            }
            updateNavbarUI();
        }

        document.getElementById('save-config-btn').addEventListener('click', () => {
            const gemini = document.getElementById('api-key-input').value.trim();
            const supUrl = document.getElementById('supabase-url-input').value.trim();
            const supKey = document.getElementById('supabase-key-input').value.trim();
            
            localStorage.setItem('gemini_key', gemini);
            localStorage.setItem('supabase_url', supUrl);
            localStorage.setItem('supabase_key', supKey);
            
            if (supUrl && supKey) {
                initSupabase(supUrl, supKey);
            }
            showMessage('Configurações guardadas com sucesso!', 'success');
        });

        function initSupabase(url, key) {
            try {
                supabaseClient = window.supabase.createClient(url, key);
                
                // Subscrever às alterações de autenticação
                supabaseClient.auth.onAuthStateChange((event, session) => {
                    currentUser = session?.user || null;
                    updateNavbarUI();
                });
                
                // Verificar sessão atual
                supabaseClient.auth.getSession().then(({ data: { session } }) => {
                    currentUser = session?.user || null;
                    updateNavbarUI();
                });
            } catch (err) {
                console.error("Erro ao inicializar Supabase:", err);
                showMessage("Erro ao ligar ao Supabase. Verifique a URL e a Chave.", "danger");
            }
        }

        // ----------------------------------------------------
        // AUTENTICAÇÃO
        // ----------------------------------------------------
        function updateNavbarUI() {
            const nav = document.getElementById('nav-actions');
            nav.innerHTML = '';

            if (currentUser) {
                nav.innerHTML = `
                    <li class="nav-item me-3"><span class="nav-link text-white"><i class="bi bi-person"></i> ${currentUser.email}</span></li>
                    <li class="nav-item"><button class="btn btn-light btn-sm me-2" onclick="loadHistory()">Histórico</button></li>
                    <li class="nav-item"><button class="btn btn-outline-light btn-sm" onclick="handleLogout()">Sair</button></li>
                `;
            } else {
                nav.innerHTML = `
                    <li class="nav-item"><button class="btn btn-light btn-sm" onclick="authModalInstance.show()">Entrar / Registar</button></li>
                `;
            }
        }

        async function handleAuth(action) {
            if (!supabaseClient) return showMessage("Configure o Supabase primeiro nas Configurações.", "warning");
            
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const alertContainer = document.getElementById('auth-alert-container');
            
            if (!email || password.length < 6) {
                alertContainer.innerHTML = `<div class="alert alert-warning py-2">Preencha o email e uma palavra-passe (mínimo 6 caracteres).</div>`;
                return;
            }

            try {
                let error;
                if (action === 'login') {
                    const res = await supabaseClient.auth.signInWithPassword({ email, password });
                    error = res.error;
                } else {
                    const res = await supabaseClient.auth.signUp({ email, password });
                    error = res.error;
                    if(!error) alertContainer.innerHTML = `<div class="alert alert-success py-2">Registo feito! Se o seu projeto exige confirmação, verifique o email.</div>`;
                }

                if (error) throw error;

                if(action === 'login') {
                    authModalInstance.hide();
                    showMessage("Sessão iniciada com sucesso!", "success");
                }
            } catch (err) {
                alertContainer.innerHTML = `<div class="alert alert-danger py-2">${err.message}</div>`;
            }
        }

        document.getElementById('btn-login').addEventListener('click', () => handleAuth('login'));
        document.getElementById('btn-register').addEventListener('click', () => handleAuth('register'));

        async function handleLogout() {
            if(supabaseClient) await supabaseClient.auth.signOut();
            showSection('input-section');
            showMessage("Sessão terminada.", "info");
        }

        // ----------------------------------------------------
        // OPERAÇÕES DE DADOS (HISTORY & SAVE)
        // ----------------------------------------------------
        async function saveAnalysisToSupabase(jobUrl, analysisData) {
            if (!supabaseClient || !currentUser) return; // Só guarda se estiver logado
            
            try {
                const { error } = await supabaseClient
                    .from('analyses')
                    .insert([{
                        user_id: currentUser.id,
                        job_url: jobUrl,
                        score: analysisData.score,
                        score_feedback: analysisData.scoreFeedback,
                        // Pode expandir a base de dados para guardar o JSON completo se desejar
                    }]);
                
                if (error) throw error;
            } catch (err) {
                console.error("Erro ao guardar histórico:", err);
                // Falhar silenciosamente para o utilizador, já que a análise funcionou
            }
        }

        async function loadHistory() {
            if (!supabaseClient || !currentUser) {
                showMessage("Inicie sessão para ver o histórico.", "warning");
                return;
            }

            showSection('history-section');
            const historyList = document.getElementById('history-list');
            historyList.innerHTML = '<div class="text-center w-100"><div class="spinner-border text-primary"></div></div>';

            try {
                const { data, error } = await supabaseClient
                    .from('analyses')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (error) throw error;

                if (!data || data.length === 0) {
                    historyList.innerHTML = '<div class="col-12 text-center text-muted"><p>Ainda não tem análises guardadas.</p></div>';
                    return;
                }

                historyList.innerHTML = data.map(item => `
                    <div class="col-md-6 mb-3">
                        <div class="card p-3 h-100">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="badge ${item.score >= 80 ? 'bg-success' : (item.score >= 50 ? 'bg-warning text-dark' : 'bg-danger')}">
                                    Score: ${item.score}%
                                </span>
                                <small class="text-muted">${new Date(item.created_at).toLocaleDateString('pt-PT')}</small>
                            </div>
                            <p class="mb-1 text-truncate" title="${item.job_url}"><strong>Vaga:</strong> <a href="${item.job_url}" target="_blank">${item.job_url}</a></p>
                            <p class="text-muted small m-0">${item.score_feedback}</p>
                        </div>
                    </div>
                `).join('');

            } catch (err) {
                historyList.innerHTML = `<div class="alert alert-danger w-100">Erro ao carregar histórico: ${err.message}</div>`;
            }
        }

        // ----------------------------------------------------
        // LÓGICA CORE (EXTRAÇÃO & GEMINI IA)
        // ----------------------------------------------------
        async function fetchJobDescription(url) {
            try {
                const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
                if (!response.ok) throw new Error("Erro na rede.");
                const data = await response.json();
                
                const parser = new DOMParser();
                const doc = parser.parseFromString(data.contents, 'text/html');
                doc.querySelectorAll('script, style, nav, footer, header, noscript, svg').forEach(el => el.remove());
                
                const text = doc.body.innerText.replace(/\s+/g, ' ').trim();
                if (!text || text.length < 50) throw new Error("Texto insuficiente extraído da página.");
                return text;
            } catch (e) {
                throw new Error("Não foi possível extrair o texto da URL. O site pode estar a bloquear o acesso.");
            }
        }

        async function extractTextFromFile(file) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (['md', 'html', 'htm', 'txt'].includes(ext)) return await file.text();
            
            if (ext === 'docx') {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                return result.value;
            }

            if (ext === 'doc') {
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

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const jobUrl = document.getElementById('job-url').value;
            const resumeFile = document.getElementById('resume-file').files[0];
            const geminiKey = localStorage.getItem('gemini_key');

            if (!geminiKey) {
                showMessage("Falta a chave da API do Gemini. Insira a chave nas 'Configurações de API'.", "warning");
                document.getElementById('configCollapse').classList.add('show');
                return;
            }

            showLoading(true, "A extrair dados da vaga...");

            try {
                const jobDescription = await fetchJobDescription(jobUrl);
                showLoading(true, "A ler o currículo...");
                const resumeText = await extractTextFromFile(resumeFile);
                
                showLoading(true, "A IA está a analisar o perfil...");
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiKey}`;
                const analysisResult = await callGeminiAI(jobDescription, resumeText, apiUrl);
                
                populateResults(analysisResult);
                showLoading(false);
                showSection('results-section');
                
                // Gravar na Base de Dados se o utilizador tiver sessão iniciada
                saveAnalysisToSupabase(jobUrl, analysisResult);

            } catch (error) {
                showLoading(false);
                showMessage(error.message || "Ocorreu um erro na análise. Tente novamente.", "danger");
            }
        });

        async function callGeminiAI(jobDescription, resumeText, apiUrl, retries = 3) {
            const systemPrompt = `
                Você é um especialista em Recrutamento e Seleção ATS.
                Sua tarefa é analisar o currículo em relação à descrição da vaga e retornar APENAS um JSON estrito.
                {
                    "score": <número de 0 a 100>,
                    "scoreFeedback": "<frase curta resumindo o score>",
                    "keywordsFound": ["palavra1"],
                    "keywordsMissing": ["palavra1"],
                    "strengths": ["ponto 1"],
                    "weaknesses": ["melhoria 1"],
                    "restructuredResume": "<Texto do currículo otimizado>"
                }
            `;

            const payload = {
                contents: [{ parts: [{ text: `VAGA:\n${jobDescription}\n\nCURRÍCULO:\n${resumeText}` }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { responseMimeType: "application/json" }
            };

            let delay = 1000;
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    return JSON.parse(data.candidates[0].content.parts[0].text);
                } catch (err) {
                    if (i === retries - 1) throw new Error("A Inteligência Artificial não conseguiu processar o pedido. Verifique a sua chave de API.");
                    await new Promise(r => setTimeout(r, delay));
                    delay *= 2;
                }
            }
        }

        function populateResults(data) {
            const scoreCircle = document.getElementById('score-circle');
            scoreCircle.textContent = `${data.score}%`;
            scoreCircle.className = 'score-circle ' + (data.score >= 80 ? 'score-high' : (data.score >= 50 ? 'score-medium' : 'score-low'));
            
            document.getElementById('score-feedback').textContent = data.scoreFeedback;

            const makeBadges = (arr, type) => arr?.length ? arr.map(w => `<span class="badge bg-${type} keyword-badge">${w}</span>`).join('') : '<span class="text-muted">Nenhuma encontrada.</span>';
            document.getElementById('keywords-found').innerHTML = makeBadges(data.keywordsFound, 'success');
            document.getElementById('keywords-missing').innerHTML = makeBadges(data.keywordsMissing, 'danger');

            const makeList = (arr, icon, color) => arr.map(i => `<li class="list-group-item"><i class="bi ${icon} text-${color} me-2"></i> ${i}</li>`).join('');
            document.getElementById('strengths-list').innerHTML = makeList(data.strengths, 'bi-check2', 'success');
            document.getElementById('weaknesses-list').innerHTML = makeList(data.weaknesses, 'bi-arrow-right-short', 'warning');

            document.getElementById('restructured-resume').textContent = data.restructuredResume;
        }

        document.getElementById('copy-btn').addEventListener('click', () => {
            const text = document.getElementById('restructured-resume').innerText;
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            const btn = document.getElementById('copy-btn');
            btn.innerHTML = '<i class="bi bi-check"></i> Copiado!';
            btn.className = 'btn btn-success btn-sm';
            setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i> Copiar'; btn.className = 'btn btn-outline-secondary btn-sm'; }, 2000);
        });