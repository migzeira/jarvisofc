import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import logoEscrita from "@/assets/logo_escrita.png";

export default function PoliticaPrivacidade() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-[#03030a]/90 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/">
            <img src={logoEscrita} alt="Minha Maya" className="h-7 w-auto" />
          </Link>
          <Link to="/" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-extrabold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Política de Privacidade</h1>
        <p className="text-sm text-gray-500 mb-10">Última atualização: 06 de abril de 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-lg font-bold text-white">1. Informações que Coletamos</h2>
            <p>Coletamos as seguintes informações quando você utiliza o Serviço:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Dados de cadastro:</strong> nome, email e senha</li>
              <li><strong>Número de telefone:</strong> para vinculação com o WhatsApp</li>
              <li><strong>Mensagens:</strong> textos, áudios e imagens enviados ao assistente</li>
              <li><strong>Dados financeiros:</strong> transações registradas por você</li>
              <li><strong>Dados de agenda:</strong> eventos e compromissos criados</li>
              <li><strong>Dados de uso:</strong> interações com o dashboard e funcionalidades</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">2. Como Utilizamos seus Dados</h2>
            <p>Seus dados são utilizados exclusivamente para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fornecer e melhorar o Serviço</li>
              <li>Processar suas mensagens e comandos via IA</li>
              <li>Enviar lembretes e notificações solicitados por você</li>
              <li>Gerar relatórios financeiros e de produtividade</li>
              <li>Sincronizar com integrações autorizadas (Google, Notion)</li>
              <li>Comunicações sobre o Serviço e atualizações</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">3. Armazenamento e Segurança</h2>
            <p>Seus dados são armazenados em servidores seguros com criptografia AES-256. Utilizamos o Supabase como infraestrutura de banco de dados, com políticas de segurança em nível de linha (RLS) para garantir que apenas você acesse seus próprios dados.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">4. Compartilhamento de Dados</h2>
            <p>Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros, exceto:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Integrações autorizadas:</strong> quando você conecta Google Calendar, Sheets ou Notion</li>
              <li><strong>Processamento de IA:</strong> mensagens são processadas via OpenAI para gerar respostas</li>
              <li><strong>Processamento de pagamentos:</strong> dados de pagamento são processados pela Kirvano</li>
              <li><strong>Obrigações legais:</strong> quando exigido por lei ou ordem judicial</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">5. Processamento por IA</h2>
            <p>Suas mensagens são processadas por modelos de inteligência artificial (OpenAI) para interpretação e geração de respostas. Não utilizamos seus dados para treinar modelos de IA. As mensagens são processadas em tempo real e os dados de contexto são mantidos apenas enquanto necessário para o funcionamento do Serviço.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">6. Seus Direitos (LGPD)</h2>
            <p>Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem direito a:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Acessar seus dados pessoais</li>
              <li>Corrigir dados incompletos ou incorretos</li>
              <li>Solicitar a exclusão dos seus dados</li>
              <li>Revogar o consentimento a qualquer momento</li>
              <li>Solicitar portabilidade dos dados</li>
              <li>Obter informações sobre com quem seus dados foram compartilhados</li>
            </ul>
            <p>Para exercer seus direitos, entre em contato pelo email: <a href="mailto:suporte@minhamaya.com.br" className="text-violet-400 hover:text-violet-300">suporte@minhamaya.com.br</a></p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">7. Cookies e Armazenamento Local</h2>
            <p>Utilizamos localStorage para manter sua sessão de autenticação e preferências. Não utilizamos cookies de rastreamento de terceiros.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">8. Retenção de Dados</h2>
            <p>Seus dados são mantidos enquanto sua conta estiver ativa. Após o encerramento da conta, seus dados serão excluídos em até 30 dias, exceto quando a retenção for necessária para cumprimento de obrigações legais.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">9. Menores de Idade</h2>
            <p>O Serviço não é destinado a menores de 18 anos. Não coletamos intencionalmente dados de menores. Se tomarmos conhecimento de que coletamos dados de um menor, excluiremos imediatamente.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">10. Alterações nesta Política</h2>
            <p>Podemos atualizar esta Política periodicamente. Alterações significativas serão comunicadas por email ou pelo Serviço. Recomendamos a revisão periódica desta página.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-white">11. Contato</h2>
            <p>Para dúvidas sobre esta Política de Privacidade ou sobre o tratamento dos seus dados, entre em contato:</p>
            <p>Email: <a href="mailto:suporte@minhamaya.com.br" className="text-violet-400 hover:text-violet-300">suporte@minhamaya.com.br</a></p>
            <p>Responsável: MayaHub · <a href="https://mayahub.ai" className="text-violet-400 hover:text-violet-300" target="_blank" rel="noreferrer">mayahub.ai</a></p>
          </section>
        </div>
      </main>
    </div>
  );
}
