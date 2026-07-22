import streamlit as st
import google.generativeai as genai
import requests
from bs4 import BeautifulSoup
import pypdf
import docx
import json
from supabase import create_client, Client
import io

# Importações para geração de PDF com ReportLab
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# --- CONFIGURAÇÃO DA PÁGINA ---
st.set_page_config(page_title="Analista ATS Pro", page_icon="📄", layout="wide")

# --- CARREGAMENTO DE SEGREDOS (ENVIRONMENT VARIABLES) ---
try:
    SUPABASE_URL = st.secrets["SUPABASE_URL"]
    SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
    GEMINI_API_KEY = st.secrets["GEMINI_API_KEY"]
except Exception:
    st.error("⚠️ Erro crítico: Ficheiro de segredos não encontrado ou incompleto.")
    st.info("Configure o ficheiro `.streamlit/secrets.toml` localmente ou os 'Secrets' no Streamlit Cloud.")
    st.stop()

# --- INICIALIZAÇÃO DE ESTADO ---
if "user" not in st.session_state:
    st.session_state.user = None
    
if "supabase" not in st.session_state:
    try:
        st.session_state.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        st.error(f"Erro ao ligar à base de dados: {e}")
        st.stop()

# --- FUNÇÕES DE EXTRAÇÃO DE TEXTO ---
def fetch_job_description(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.extract()
            
        text = soup.get_text(separator=' ', strip=True)
        if len(text) < 50:
            raise ValueError("Texto insuficiente extraído. A página pode requerer login.")
        return text
    except Exception as e:
        raise Exception(f"Erro ao extrair da URL: {str(e)}")

def extract_text_from_file(uploaded_file):
    ext = uploaded_file.name.split('.')[-1].lower()
    text = ""
    try:
        if ext == 'pdf':
            pdf_reader = pypdf.PdfReader(uploaded_file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        elif ext == 'docx':
            doc = docx.Document(uploaded_file)
            for para in doc.paragraphs:
                text += para.text + "\n"
        elif ext in ['txt', 'md']:
            text = uploaded_file.read().decode('utf-8')
        else:
            raise ValueError(f"Formato .{ext} não suportado.")
        return text
    except Exception as e:
        raise Exception(f"Erro ao ler o ficheiro: {str(e)}")

# --- FUNÇÃO DE GERAÇÃO DE PDF ---
def generate_pdf_resume(resume_text):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=54, leftMargin=54, topMargin=54, bottomMargin=54)
    story = []
    
    styles = getSampleStyleSheet()
    
    # Estilo otimizado para ATS (Limpo, sem elementos gráficos complexos)
    body_style = ParagraphStyle(
        'ATSBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#333333')
    )
    
    # Processar o texto linha por linha para manter quebras de linha e formatação básica
    for line in resume_text.split('\n'):
        line = line.strip()
        if not line:
            story.append(Spacer(1, 8))
            continue
            
        # Detetar se aparenta ser um cabeçalho/título de secção
        if line.isupper() or line.endswith(':'):
            header_style = ParagraphStyle(
                'ATSHeader',
                parent=styles['Heading2'],
                fontName='Helvetica-Bold',
                fontSize=12,
                leading=16,
                textColor=colors.HexColor('#0d6efd'),
                spaceBefore=10,
                spaceAfter=4
            )
            story.append(Paragraph(line, header_style))
        else:
            story.append(Paragraph(line, body_style))
            
    doc.build(story)
    buffer.seek(0)
    return buffer

# --- FUNÇÃO DA IA (GEMINI) ---
def call_gemini_ai(job_desc, resume_text):
    genai.configure(api_key=GEMINI_API_KEY)
    
    system_prompt = """
    Você é um especialista em Recrutamento e Seleção ATS.
    Analise o currículo em relação à vaga e retorne APENAS um objeto JSON com esta estrutura exata:
    {
        "score": <numero de 0 a 100>,
        "scoreFeedback": "<frase curta resumindo o score>",
        "keywordsFound": ["palavra1", "palavra2"],
        "keywordsMissing": ["palavra1", "palavra2"],
        "strengths": ["ponto 1", "ponto 2"],
        "weaknesses": ["melhoria 1", "melhoria 2"],
        "restructuredResume": "<Texto do currículo otimizado com quebras de linha>"
    }
    """
    
    model = genai.GenerativeModel(
        model_name='gemini-3.5-flash', 
        generation_config={"response_mime_type": "application/json"},
        system_instruction=system_prompt
    )
    
    prompt = f"VAGA:\n{job_desc}\n\nCURRÍCULO:\n{resume_text}"
    
    try:
        response = model.generate_content(prompt)
        return json.loads(response.text)
    except Exception as e:
        raise Exception(f"Erro na IA Gemini: {str(e)}")

# --- BARRA LATERAL (AUTENTICAÇÃO) ---
with st.sidebar:
    st.image("https://cdn-icons-png.flaticon.com/512/942/942799.png", width=80)
    st.header("Área Pessoal")
    
    if st.session_state.user is None:
        st.write("Aceda para guardar o seu histórico de análises.")
        auth_email = st.text_input("E-mail")
        auth_pass = st.text_input("Palavra-passe", type="password")
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Entrar", use_container_width=True):
                try:
                    res = st.session_state.supabase.auth.sign_in_with_password({"email": auth_email, "password": auth_pass})
                    st.session_state.user = res.user
                    st.rerun()
                except Exception as e:
                    st.error("Erro no Login.")
        with col2:
            if st.button("Registar", use_container_width=True):
                try:
                    st.session_state.supabase.auth.sign_up({"email": auth_email, "password": auth_pass})
                    st.success("Registo efetuado!")
                except Exception as e:
                    st.error("Erro no Registo.")
    else:
        st.success(f"Sessão iniciada:\n{st.session_state.user.email}")
        if st.button("Terminar Sessão", use_container_width=True):
            st.session_state.supabase.auth.sign_out()
            st.session_state.user = None
            st.rerun()

# --- INTERFACE PRINCIPAL ---
st.title("📄 Analista de Currículos ATS Pro")
st.markdown("Otimize o seu Currículo com Inteligência Artificial para passar nos filtros das empresas.")

tab1, tab2 = st.tabs(["Nova Análise", "O Meu Histórico"])

with tab1:
    with st.form("ats_form"):
        st.subheader("Dados para Análise")
        
        job_url = st.text_input("URL da Vaga (Ex: LinkedIn, Indeed)", placeholder="https://...")
        uploaded_resume = st.file_uploader("O seu Currículo Atual", type=['pdf', 'docx', 'txt', 'md'])
        
        submit_btn = st.form_submit_button("Analisar Currículo", type="primary")

    if submit_btn:
        if not job_url or not uploaded_resume:
            st.warning("⚠️ Preencha a URL da vaga e anexe o currículo.")
        else:
            try:
                with st.spinner('A extrair dados da vaga da URL...'):
                    job_desc = fetch_job_description(job_url)
                    
                with st.spinner('A ler o conteúdo do currículo...'):
                    resume_text = extract_text_from_file(uploaded_resume)
                    
                with st.spinner('A Inteligência Artificial está a analisar o perfil...'):
                    result = call_gemini_ai(job_desc, resume_text)
                
                # Exibir Resultados
                st.divider()
                st.header("🎯 Resultado da Análise ATS")
                
                col1, col2 = st.columns([1, 2])
                with col1:
                    score = result.get('score', 0)
                    color = "#198754" if score >= 80 else "#ffc107" if score >= 50 else "#dc3545"
                    st.markdown(f"""
                        <div style="text-align: center; padding: 20px; border-radius: 15px; border: 2px solid {color};">
                            <h1 style="color: {color}; margin: 0; font-size: 3rem;">{score}%</h1>
                            <p style="margin: 0; color: gray;">Match Score</p>
                        </div>
                    """, unsafe_allow_html=True)
                    st.caption(result.get('scoreFeedback', ''))

                with col2:
                    st.subheader("🔑 Palavras-chave")
                    found = result.get('keywordsFound', [])
                    missing = result.get('keywordsMissing', [])
                    
                    st.write("**Encontradas:**")
                    if found:
                        badges_f = " ".join([f"<span style='background-color: #d1e7dd; color: #0f5132; padding: 4px 8px; border-radius: 12px; margin: 2px; display: inline-block;'>{k}</span>" for k in found])
                        st.markdown(badges_f, unsafe_allow_html=True)
                    else:
                        st.write("-")

                    st.write("**Em Falta:**")
                    if missing:
                        badges_m = " ".join([f"<span style='background-color: #f8d7da; color: #842029; padding: 4px 8px; border-radius: 12px; margin: 2px; display: inline-block;'>{k}</span>" for k in missing])
                        st.markdown(badges_m, unsafe_allow_html=True)
                    else:
                        st.write("-")

                col_s, col_w = st.columns(2)
                with col_s:
                    st.success("**Pontos Fortes:**\n" + "\n".join([f"- {s}" for s in result.get('strengths', [])]))
                with col_w:
                    st.warning("**A Melhorar:**\n" + "\n".join([f"- {w}" for w in result.get('weaknesses', [])]))

                st.subheader("📝 Sugestão de Reestruturação")
                
                optimized_text = result.get('restructuredResume', '')
                st.text_area("Pré-visualização do texto:", value=optimized_text, height=300)
                
                # Botão de Download em PDF
                pdf_bytes = generate_pdf_resume(optimized_text)
                st.download_button(
                    label="📥 Descarregar Currículo Otimizado (PDF)",
                    data=pdf_bytes,
                    file_name="curriculo_otimizado_ats.pdf",
                    mime="application/pdf",
                    type="primary"
                )
                
                # Gravar na Base de Dados (Se Logado)
                if st.session_state.user:
                    try:
                        st.session_state.supabase.table("analyses").insert({
                            "user_id": st.session_state.user.id,
                            "job_url": job_url,
                            "score": score,
                            "score_feedback": result.get('scoreFeedback', '')
                        }).execute()
                        st.toast("Análise guardada no histórico!", icon="✅")
                    except Exception as e:
                        st.toast("Não foi possível guardar no histórico.", icon="⚠️")

            except Exception as e:
                st.error(f"Erro no processamento: {str(e)}")

with tab2:
    st.subheader("Histórico de Análises")
    if not st.session_state.user:
        st.info("Inicie sessão na barra lateral para ver o seu histórico.")
    else:
        if st.button("🔄 Atualizar Histórico"):
            st.rerun()
            
        try:
            response = st.session_state.supabase.table("analyses").select("*").eq("user_id", st.session_state.user.id).order("created_at", desc=True).execute()
            
            if not response.data:
                st.write("Ainda não tem análises guardadas.")
            else:
                for item in response.data:
                    score = item['score']
                    color = "🟢" if score >= 80 else "🟡" if score >= 50 else "🔴"
                    with st.expander(f"{color} Score: {score}% - {item['job_url'][:50]}..."):
                        st.write(f"**Data:** {item['created_at'][:10]}")
                        st.write(f"**Vaga:** {item['job_url']}")
                        st.write(f"**Feedback:** {item['score_feedback']}")
        except Exception as e:
            st.error(f"Erro ao carregar histórico: {e}")